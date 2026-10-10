import Foundation

/// Fallback snapshots read from the Claude desktop client's data folder.
/// ClaudeQuota provides live queries; these local records keep the panel useful when a query fails.
///
/// Two places: newest usage wins; an older event can supply a reset only for the same window cycle.
/// - `plan-usage-history.json`: samples the client appends when it fetches usage (5h `fh`, weekly `sd`, in
///   percent). No reset times, so a 5-hour value older than 5 hours is dropped.
/// - The `claude.ai` IndexedDB blob files: cached conversation events, including Claude Code's
///   `rate_limit_event` with both windows' utilization (0…1) and reset times. Blobs are Chromium-wrapped:
///   `FF 11 02` followed by raw Snappy, then V8-serialized values.
public enum ClaudeQuotaCache {
    public static func latest(dataDir: URL, now: Date = Date()) -> CachedQuota? {
        let candidates = [history(dataDir.appendingPathComponent("plan-usage-history.json"), now: now),
                          events(dataDir.appendingPathComponent("IndexedDB/https_claude.ai_0.indexeddb.blob"), now: now)]
        return combining(candidates.compactMap { $0 })
    }

    /// History samples omit resets. Retain an event's reset when the newest observation falls inside
    /// that cycle, but never attach a previous cycle's reset to newer usage (or revive stale usage).
    static func combining(_ candidates: [CachedQuota]) -> CachedQuota? {
        guard let newest = candidates.max(by: { $0.observedAt < $1.observedAt }) else { return nil }
        let windows = newest.windows.map { window -> QuotaWindow in
            guard window.resetsAt == nil else { return window }
            let reset = candidates.sorted { $0.observedAt > $1.observedAt }.compactMap { candidate -> Date? in
                guard let date = candidate.windows.first(where: { $0.minutes == window.minutes })?.resetsAt,
                      date > newest.observedAt,
                      date.timeIntervalSince(newest.observedAt) <= Double(window.minutes * 60) else { return nil }
                return date
            }.first
            return QuotaWindow(minutes: window.minutes, usedPercent: window.usedPercent, resetsAt: reset)
        }
        return CachedQuota(windows: windows, observedAt: newest.observedAt)
    }

    // MARK: plan-usage-history.json

    static func history(_ url: URL, now: Date) -> CachedQuota? {
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let samples = object["samples"] as? [[String: Any]] else { return nil }
        let newest = samples.compactMap { sample -> (Date, [String: Any])? in
            guard let t = QuotaParser.number(sample["t"]), let usage = sample["u"] as? [String: Any] else { return nil }
            return (Date(timeIntervalSince1970: t / 1000), usage)
        }.max { $0.0 < $1.0 }
        guard let (observed, usage) = newest else { return nil }
        var windows: [QuotaWindow] = []
        if let fh = QuotaParser.number(usage["fh"]), now.timeIntervalSince(observed) < 5 * 3600 {
            windows.append(QuotaWindow(minutes: 300, usedPercent: fh, resetsAt: nil))
        }
        if let sd = QuotaParser.number(usage["sd"]), now.timeIntervalSince(observed) < 7 * 86400 {
            windows.append(QuotaWindow(minutes: 10080, usedPercent: sd, resetsAt: nil))
        }
        return windows.isEmpty ? nil : CachedQuota(windows: windows, observedAt: observed)
    }

    // MARK: IndexedDB rate_limit_event

    /// Scans the most recently written blob files (at most 12, each under 32 MB, written in the last 8 days).
    static func events(_ directory: URL, now: Date) -> CachedQuota? {
        let keys: [URLResourceKey] = [.isRegularFileKey, .contentModificationDateKey, .fileSizeKey]
        guard let walker = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: keys) else { return nil }
        var files: [(URL, Date)] = []
        for case let url as URL in walker {
            guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true,
                  let modified = values.contentModificationDate, now.timeIntervalSince(modified) < 8 * 86400,
                  (values.fileSize ?? 0) < 32 << 20 else { continue }
            files.append((url, modified))
        }
        var best: CachedQuota?
        for (url, _) in files.sorted(by: { $0.1 > $1.1 }).prefix(12) {
            guard let raw = try? Data(contentsOf: url), let found = latestEvent(inBlob: [UInt8](raw)) else { continue }
            if best.map({ found.observedAt > $0.observedAt }) ?? true { best = found }
        }
        return best
    }

    static func latestEvent(inBlob raw: [UInt8]) -> CachedQuota? {
        let bytes: [UInt8]
        if raw.count > 3, raw[0] == 0xFF, raw[1] == 0x11, raw[2] == 0x02 {
            guard let plain = Snappy.decompress(raw, from: 3) else { return nil }
            bytes = plain
        } else {
            bytes = raw
        }
        return latestEvent(inValue: bytes)
    }

    /// Finds every `rate_limit_info` object in V8-serialized bytes and keeps the newest event's windows.
    static func latestEvent(inValue bytes: [UInt8]) -> CachedQuota? {
        let marker = Array("rate_limit_info".utf8)
        var best: CachedQuota?
        var start = 0
        while let hit = find(marker, in: bytes, from: start) {
            let next = find(marker, in: bytes, from: hit + marker.count) ?? bytes.count
            let end = min(next, hit + 4096)
            if let event = parseEvent(bytes, hit, end), best.map({ event.observedAt > $0.observedAt }) ?? true {
                best = event
            }
            start = hit + marker.count
        }
        return best
    }

    private static func parseEvent(_ bytes: [UInt8], _ lower: Int, _ upper: Int) -> CachedQuota? {
        guard let unified = findKey("unifiedWindows", bytes, lower, upper) else { return nil }
        var windows: [QuotaWindow] = []
        for (name, minutes) in [("five_hour", 300), ("seven_day", 10080)] {
            guard let at = findKey(name, bytes, unified, upper) else { continue }
            // Each window object holds only resetsAt and utilization; stop before the next window starts.
            let stop = min(upper, at + 64)
            guard let utilization = numberAfterKey("utilization", bytes, at, stop) else { continue }
            let resets = numberAfterKey("resetsAt", bytes, at, stop).map { Date(timeIntervalSince1970: $0) }
            windows.append(QuotaWindow(minutes: minutes, usedPercent: utilization * 100, resetsAt: resets))
        }
        guard !windows.isEmpty, let observed = createdAt(bytes, lower, upper) else { return nil }
        return CachedQuota(windows: windows, observedAt: observed)
    }

    private static func createdAt(_ bytes: [UInt8], _ lower: Int, _ upper: Int) -> Date? {
        guard let at = findKey("created_at", bytes, lower, upper), at < upper, bytes[at] == 0x22 else { return nil }
        guard let (length, body) = varint(bytes, at + 1), body + length <= bytes.count, length < 64 else { return nil }
        guard let text = String(bytes: bytes[body..<body + length], encoding: .ascii) else { return nil }
        // Microsecond fractions are not always accepted; whole seconds are precise enough here.
        return ISO8601.parse(text) ?? ISO8601.parse(text.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression))
    }

    /// Position just after a one-byte V8 string `"<len><name>`, searching lower..<upper.
    private static func findKey(_ name: String, _ bytes: [UInt8], _ lower: Int, _ upper: Int) -> Int? {
        let utf8 = Array(name.utf8)
        let pattern = [0x22, UInt8(utf8.count)] + utf8
        guard let hit = find(pattern, in: bytes, from: lower), hit + pattern.count <= upper else { return nil }
        return hit + pattern.count
    }

    /// A V8 double (`N` + 8 bytes) or small integer (`I` + zigzag varint) right after the key.
    private static func numberAfterKey(_ name: String, _ bytes: [UInt8], _ lower: Int, _ upper: Int) -> Double? {
        guard let at = findKey(name, bytes, lower, upper), at < bytes.count else { return nil }
        switch bytes[at] {
        case 0x4E where at + 9 <= bytes.count:
            var bits: UInt64 = 0
            for index in 0..<8 { bits |= UInt64(bytes[at + 1 + index]) << (8 * index) }
            let value = Double(bitPattern: bits)
            return value.isFinite ? value : nil
        case 0x49:
            guard let (zigzag, _) = varint(bytes, at + 1) else { return nil }
            return Double((zigzag >> 1) ^ -(zigzag & 1))
        default:
            return nil
        }
    }

    private static func varint(_ bytes: [UInt8], _ start: Int) -> (Int, Int)? {
        var result = 0, shift = 0, index = start
        while index < bytes.count, shift < 35 {
            let byte = bytes[index]; index += 1
            result |= Int(byte & 0x7F) << shift
            if byte < 0x80 { return (result, index) }
            shift += 7
        }
        return nil
    }

    private static func find(_ pattern: [UInt8], in bytes: [UInt8], from start: Int) -> Int? {
        guard let first = pattern.first, pattern.count <= bytes.count else { return nil }
        var index = max(start, 0)
        let last = bytes.count - pattern.count
        while index <= last {
            if bytes[index] == first {
                var matched = true
                for offset in 1..<pattern.count where bytes[index + offset] != pattern[offset] { matched = false; break }
                if matched { return index }
            }
            index += 1
        }
        return nil
    }
}

/// Raw Snappy block decompression (no framing), as Chromium uses for large IndexedDB values.
enum Snappy {
    static func decompress(_ input: [UInt8], from start: Int, limit: Int = 256 << 20) -> [UInt8]? {
        var index = start
        var length = 0, shift = 0
        while true {
            guard index < input.count, shift < 35 else { return nil }
            let byte = input[index]; index += 1
            length |= Int(byte & 0x7F) << shift
            if byte < 0x80 { break }
            shift += 7
        }
        guard length <= limit else { return nil }
        var output = [UInt8](); output.reserveCapacity(length)
        while index < input.count, output.count < length {
            let tag = input[index]; index += 1
            switch tag & 3 {
            case 0:
                var literal = Int(tag >> 2)
                if literal >= 60 {
                    let extra = literal - 59
                    guard index + extra <= input.count else { return nil }
                    literal = 0
                    for offset in 0..<extra { literal |= Int(input[index + offset]) << (8 * offset) }
                    index += extra
                }
                literal += 1
                guard index + literal <= input.count else { return nil }
                output.append(contentsOf: input[index..<index + literal]); index += literal
            default:
                let copy: Int, distance: Int
                switch tag & 3 {
                case 1:
                    guard index < input.count else { return nil }
                    copy = Int((tag >> 2) & 7) + 4
                    distance = Int(tag >> 5) << 8 | Int(input[index]); index += 1
                case 2:
                    guard index + 2 <= input.count else { return nil }
                    copy = Int(tag >> 2) + 1
                    distance = Int(input[index]) | Int(input[index + 1]) << 8; index += 2
                default:
                    guard index + 4 <= input.count else { return nil }
                    copy = Int(tag >> 2) + 1
                    distance = (0..<4).reduce(0) { $0 | Int(input[index + $1]) << (8 * $1) }; index += 4
                }
                guard distance > 0, distance <= output.count else { return nil }
                let from = output.count - distance
                for offset in 0..<copy { output.append(output[from + offset]) }
            }
        }
        return output.count == length ? output : nil
    }
}
