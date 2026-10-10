import Foundation

/// Reads only this desktop profile's session metadata and structured audit lifecycle.
/// Global Claude Code history cannot be attributed to a desktop account and is not used here.
/// Use one reader on one serial queue.
public final class ClaudeDesktopSessionReader {
    public let profileRoot: URL
    private struct Entry {
        let id: String
        let title: String
        let cwd: String?
        let updated: Date
        let status: TaskStatus
    }
    private struct Stamp: Equatable {
        let modified: Date?
        let size: UInt64?
        init(_ url: URL) {
            let values = try? FileManager.default.attributesOfItem(atPath: url.path)
            modified = values?[.modificationDate] as? Date
            size = (values?[.size] as? NSNumber)?.uint64Value
        }
    }
    private var metadata: [String: (Stamp, Entry?)] = [:]
    private var audits: [String: (Stamp, TaskStatus?)] = [:]

    public init(profileRoot: URL) { self.profileRoot = profileRoot }

    public func recent(limit: Int = 15, appRunning: Bool, now: Date = Date()) -> [ClaudeSession] {
        let root = profileRoot.appendingPathComponent("local-agent-mode-sessions")
        let keys: [URLResourceKey] = [.isRegularFileKey, .contentModificationDateKey]
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys,
                                                        options: [.skipsHiddenFiles]) else { return [] }
        let candidates = files.compactMap { value -> (URL, Date)? in
            guard let url = value as? URL, url.pathExtension == "json",
                  let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { return nil }
            return (url, values.contentModificationDate ?? .distantPast)
        }.sorted { $0.1 > $1.1 }.prefix(120)
        var sessions: [ClaudeSession] = []
        var seenFiles = Set<String>(), seenAudits = Set<String>()
        for (file, _) in candidates {
            seenFiles.insert(file.path)
            let stamp = Stamp(file)
            let entry: Entry?
            if let cached = metadata[file.path], cached.0 == stamp { entry = cached.1 }
            else {
                entry = readMetadata(file)
                metadata[file.path] = (stamp, entry)
            }
            guard let entry else { continue }
            let rawID = entry.id.hasPrefix("local_") ? String(entry.id.dropFirst(6)) : entry.id
            var state = entry.status
            let shortID = String(rawID.prefix(8))
            if shortID.count == 8, shortID.allSatisfy({ $0.isASCII && $0.isHexDigit }) {
                let audit = file.deletingLastPathComponent().appendingPathComponent("\(shortID)/audit.jsonl")
                seenAudits.insert(audit.path)
                let stamp = Stamp(audit)
                let lifecycle: TaskStatus?
                if let cached = audits[audit.path], cached.0 == stamp { lifecycle = cached.1 }
                else {
                    lifecycle = Self.lifecycle(audit)
                    audits[audit.path] = (stamp, lifecycle)
                }
                if let lifecycle { state = lifecycle }
            }
            if state == .running, !appRunning || now.timeIntervalSince(entry.updated) >= 30 * 60 { state = .interrupted }
            sessions.append(ClaudeSession(id: entry.id, title: entry.title, cwd: entry.cwd,
                                          updatedAt: entry.updated, path: file.path, status: state))
        }
        metadata = metadata.filter { seenFiles.contains($0.key) }
        audits = audits.filter { seenAudits.contains($0.key) }
        return Array(sessions.sorted {
            $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt
        }.prefix(max(0, limit)))
    }

    private func readMetadata(_ url: URL) -> Entry? {
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["isArchived"] as? Bool != true,
              let id = (object["id"] as? String).flatMap({ $0.isEmpty ? nil : $0 }) ?? object["sessionId"] as? String,
              !id.isEmpty else { return nil }
        let title = [object["title"] as? String, object["name"] as? String].compactMap { $0 }
            .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? "Claude 会话"
        let updated: Date
        if let number = object["lastActivityAt"] as? NSNumber { updated = Date(timeIntervalSince1970: number.doubleValue / 1000) }
        else if let text = object["lastActivityAt"] as? String, let date = ISO8601.parse(text) { updated = date }
        else { updated = Stamp(url).modified ?? .distantPast }
        return Entry(id: id, title: String(title.prefix(140)), cwd: object["cwd"] as? String,
                     updated: updated, status: Self.status(object["status"] as? String))
    }

    private static func status(_ raw: String?) -> TaskStatus {
        switch raw {
        case "completed", "complete", "finished": return .completed
        case "failed", "error": return .failed
        case "interrupted", "cancelled": return .interrupted
        case "inProgress", "running", "in_progress": return .running
        default: return .unknown
        }
    }

    private static func lifecycle(_ url: URL) -> TaskStatus? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let size = try? handle.seekToEnd() else { return nil }
        let offset = size > 128 * 1024 ? size - 128 * 1024 : 0
        try? handle.seek(toOffset: offset)
        guard let data = try? handle.readToEnd() else { return nil }
        let lines = data.split(separator: UInt8(ascii: "\n"))
        // The first tail line may start in the middle of a record.
        for line in (offset > 0 ? lines.dropFirst() : lines[...]).reversed() {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { continue }
            let type = object["type"] as? String
            if type == "result" { return object["is_error"] as? Bool == true ? .failed : .completed }
            guard object["isMeta"] as? Bool != true, object["isSidechain"] as? Bool != true else { continue }
            if type == "assistant" {
                let stop = (object["message"] as? [String: Any])?["stop_reason"] as? String
                return stop == nil || stop == "tool_use" ? .running : .completed
            }
            if type == "user" || object["subtype"] as? String == "init" { return .running }
        }
        return nil
    }
}
