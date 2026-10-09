import Foundation

/// Rate-limit windows last recorded in a local session log.
public struct CachedQuota: Equatable {
    public let windows: [QuotaWindow]
    public let observedAt: Date
    public init(windows: [QuotaWindow], observedAt: Date) { self.windows = windows; self.observedAt = observedAt }
}

public enum QuotaCache {
    /// The newest `token_count` event that has windows, searching the given rollout files in order (newest first).
    public static func latest(rollouts: [String]) -> CachedQuota? {
        for path in rollouts {
            if let found = latest(inRollout: URL(fileURLWithPath: path)) { return found }
        }
        return nil
    }

    /// Reads only the file's last 256 KB and keeps only the window numbers and the event time.
    public static func latest(inRollout url: URL) -> CachedQuota? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let size = try? handle.seekToEnd() else { return nil }
        let tail: UInt64 = 256 * 1024
        try? handle.seek(toOffset: size > tail ? size - tail : 0)
        guard let data = try? handle.readToEnd() else { return nil }
        let marker = Data("\"token_count\"".utf8)
        for line in data.split(separator: UInt8(ascii: "\n")).reversed() where line.range(of: marker) != nil {
            // The first line can be cut in half because only the tail is read; it simply fails to parse.
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let payload = object["payload"] as? [String: Any],
                  payload["type"] as? String == "token_count" else { continue }
            let windows = QuotaParser.windows((payload["rate_limits"] ?? payload["rateLimits"]) as? [String: Any])
            guard !windows.isEmpty else { continue }
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            guard let observed = (object["timestamp"] as? String).flatMap(ISO8601.parse) ?? modified else { continue }
            return CachedQuota(windows: windows, observedAt: observed)
        }
        return nil
    }
}
