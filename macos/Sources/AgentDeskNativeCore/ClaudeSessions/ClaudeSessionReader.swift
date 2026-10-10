import Foundation

public struct ClaudeSession: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let cwd: String?
    public let updatedAt: Date
    public let path: String
    public let status: TaskStatus
}

/// Lists local Claude Code sessions (`<projectsRoot>/<project>/<session>.jsonl`) by file time.
/// Only `custom-title`, `cwd` and the last turn's structure are kept; message bodies are never stored. Not thread-safe:
/// call one instance from one serial queue.
public final class ClaudeSessionReader {
    public let projectsRoot: URL
    private var cache: [String: (modified: Date, title: String?, cwd: String?, turn: TurnState)] = [:]

    /// Where the session's last turn stands, read from record types and `stop_reason` only.
    enum TurnState { case ended, open, interrupted, none }

    public init(projectsRoot: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/projects")) {
        self.projectsRoot = projectsRoot
    }

    public func recent(limit: Int = 15, now: Date = Date()) -> [ClaudeSession] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.contentModificationDateKey, .isRegularFileKey]
        guard let projects = try? fm.contentsOfDirectory(at: projectsRoot, includingPropertiesForKeys: nil) else { return [] }
        var files: [(url: URL, modified: Date)] = []
        for project in projects {
            guard let items = try? fm.contentsOfDirectory(at: project, includingPropertiesForKeys: keys) else { continue }
            for item in items where item.pathExtension == "jsonl" {
                guard let values = try? item.resourceValues(forKeys: Set(keys)), values.isRegularFile == true,
                      let modified = values.contentModificationDate else { continue }
                files.append((item, modified))
            }
        }
        files.sort { $0.modified > $1.modified }
        return files.prefix(limit).map { file in
            let meta: (modified: Date, title: String?, cwd: String?, turn: TurnState)
            if let cached = cache[file.url.path], cached.modified == file.modified {
                meta = cached
            } else {
                let found = Self.metadata(of: file.url)
                meta = (file.modified, found.title, found.cwd, Self.turnState(of: file.url))
                cache[file.url.path] = meta
            }
            let fallback = meta.cwd.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "Claude 会话"
            return ClaudeSession(id: file.url.deletingPathExtension().lastPathComponent,
                                 title: String((meta.title ?? fallback).prefix(140)),
                                 cwd: meta.cwd, updatedAt: file.modified, path: file.url.path,
                                 status: Self.status(meta.turn, modified: file.modified, now: now))
        }
    }

    /// An open turn counts as running while the file keeps changing; after 30 quiet minutes it was cut off.
    static func status(_ turn: TurnState, modified: Date, now: Date) -> TaskStatus {
        switch turn {
        case .ended: return .completed
        case .interrupted: return .interrupted
        case .open: return now.timeIntervalSince(modified) < 30 * 60 ? .running : .interrupted
        case .none: return .unknown
        }
    }

    /// Scans the file's tail backwards for the last real user/assistant record. Text is only compared
    /// against Claude Code's fixed interrupt marker and never kept.
    static func turnState(of url: URL, tailBytes: UInt64 = 256 * 1024) -> TurnState {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return .none }
        defer { try? handle.close() }
        guard let size = try? handle.seekToEnd() else { return .none }
        try? handle.seek(toOffset: size > tailBytes ? size - tailBytes : 0)
        guard let data = try? handle.readToEnd() else { return .none }
        for line in data.split(separator: UInt8(ascii: "\n")).reversed() {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let type = object["type"] as? String, type == "user" || type == "assistant",
                  object["isMeta"] as? Bool != true, object["isSidechain"] as? Bool != true,
                  let message = object["message"] as? [String: Any] else { continue }
            if type == "assistant" {
                let stop = message["stop_reason"] as? String
                return stop == nil || stop == "tool_use" ? .open : .ended
            }
            // Slash commands, their output and background notifications are stored as user records but start no turn.
            let tags = ["<command-", "<local-command-", "<task-notification>", "<bash-"]
            if let text = message["content"] as? String, tags.contains(where: text.hasPrefix) { continue }
            let marker = "[Request interrupted by user"
            let blocks = message["content"] as? [[String: Any]] ?? []
            let interrupted = (message["content"] as? String)?.hasPrefix(marker) == true
                || blocks.contains { ($0["text"] as? String)?.hasPrefix(marker) == true }
            return interrupted ? .interrupted : .open
        }
        return .none
    }

    /// Decodes only lines that can hold a custom title or the first cwd; keeps nothing else.
    static func metadata(of url: URL) -> (title: String?, cwd: String?) {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return (nil, nil) }
        let titleMarker = Data("\"custom-title\"".utf8), cwdMarker = Data("\"cwd\"".utf8)
        var title: String?, cwd: String?
        for line in data.split(separator: UInt8(ascii: "\n")) {
            let maybeTitle = line.range(of: titleMarker) != nil
            let maybeCwd = cwd == nil && line.range(of: cwdMarker) != nil
            guard maybeTitle || maybeCwd,
                  let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { continue }
            if object["type"] as? String == "custom-title", let value = object["customTitle"] as? String, !value.isEmpty {
                title = value
            }
            if cwd == nil, let value = object["cwd"] as? String { cwd = value }
        }
        return (title, cwd)
    }
}
