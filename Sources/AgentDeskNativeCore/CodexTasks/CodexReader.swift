import Foundation
import SQLite3

/// Reads only thread metadata and turn lifecycle fields. Never reads prompts, outputs or credentials.
public final class CodexReader {
    public let home: URL
    /// Last turn/waiting rows read per thread. Reused only when a history query fails (e.g. SQLITE_BUSY),
    /// never when it succeeds with no rows. Not thread-safe: use one reader from one serial queue.
    private var lastRows: [String: (turn: [String?]?, waiting: [String?]?)] = [:]
    /// Last turn event per rollout file, re-read only when the file's size or time changes.
    private var rolloutTurns: [String: (modified: Date, size: Int, turn: RolloutTurn?)] = [:]

    /// The newest turn lifecycle event in a rollout file. The history database can lag behind the rollout,
    /// so this wins when present. Only the event type, turn id and time are kept.
    struct RolloutTurn: Equatable {
        let id: String
        let status: String   // "inProgress", "completed" or "interrupted", as in thread_turns
        let modified: Date
    }

    public init(home: URL) { self.home = home.standardizedFileURL.resolvingSymlinksInPath() }

    public func read(appRunning: Bool, now: Date = Date()) -> CodexSnapshot {
        let statePath = home.appendingPathComponent("state_5.sqlite").path
        let historyPath = home.appendingPathComponent("thread_history_1.sqlite").path
        guard FileManager.default.fileExists(atPath: statePath),
              let state = ReadOnlyDatabase(statePath) else {
            return CodexSnapshot(detail: "还没有 Codex 本地记录（登录并开始对话后出现）。")
        }
        let columns = "id, coalesce(nullif(name, ''), title), updated_at, coalesce(recency_at, updated_at)"
        let order = "ORDER BY updated_at DESC LIMIT 16"
        let base = "FROM threads WHERE archived = 0 AND agent_path IS NULL"
        // rollout_path and source are optional: older Codex schemas without them still list tasks.
        // Subagent threads (source is a JSON object, e.g. Guardian reviews) are not the user's conversations.
        let variants = [
            "SELECT \(columns), rollout_path, source \(base) AND source NOT LIKE '{%' \(order)",
            "SELECT \(columns), rollout_path, NULL \(base) \(order)",
            "SELECT \(columns), NULL, NULL \(base) \(order)"
        ]
        guard let rows = variants.lazy.compactMap({ state.rows($0) }).first else { return CodexSnapshot(detail: "当前 Codex 数据格式暂不兼容。") }
        let history = ReadOnlyDatabase(historyPath)
        var tasks: [CodexTask] = []
        var seen: [String: (turn: [String?]?, waiting: [String?]?)] = [:]
        var historyFailed = false   // after one failed query, stop hitting a locked DB for the rest of this read
        func query(_ sql: String, _ id: String) -> [[String?]]? {
            guard !historyFailed, let history else { return nil }
            let result = history.rows(sql, text: id)
            if result == nil { historyFailed = true }
            return result
        }
        for row in rows {
            guard row.count >= 3, let id = row[0], UUID(uuidString: id) != nil else { continue }
            let turnRows = query("""
                SELECT turn_id, status, started_at, completed_at FROM thread_turns
                WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1
                """, id)
            let turn = turnRows.map { $0.first } ?? lastRows[id]?.turn
            let rolloutPath = row.count >= 5 ? row[4] : nil
            let rollout = rolloutPath.flatMap(rolloutTurn)
            let timestamp = max(Double(row[2] ?? "0") ?? 0, Double(turn?[2] ?? "0") ?? 0)
            var updated = Date(timeIntervalSince1970: max(timestamp, Double(turn?[3] ?? "0") ?? 0))
            if let rollout { updated = max(updated, rollout.modified) }
            // Only inspect structured tool names/status, never tool arguments or response text.
            let waitingRows = query("""
                SELECT json_extract(item_json, '$.tool'), json_extract(item_json, '$.status')
                FROM thread_items WHERE thread_id = ?1 AND item_type IN ('mcpToolCall', 'dynamicToolCall')
                AND turn_id = (SELECT turn_id FROM thread_turns WHERE thread_id = ?1 ORDER BY rollout_ordinal DESC LIMIT 1)
                ORDER BY rollout_ordinal DESC LIMIT 1
                """, id)
            let waitingRow = waitingRows.map { $0.first } ?? lastRows[id]?.waiting
            seen[id] = (turn, waitingRow)
            let tool = waitingRow?[0] ?? ""
            // The waiting row belongs to the database's latest turn; only trust it when that is the live turn.
            let isWaiting = tool.contains("request_user_input") && waitingRow?[1] == "inProgress"
                && (rollout == nil || rollout?.id == turn?[0])
            // `codex exec` runs in its own process, so the desktop app being closed says nothing about it.
            let source = row.count >= 6 ? row[5] : nil
            let status = SessionPolicy.status(raw: rollout?.status ?? turn?[1], updatedAt: updated, now: now,
                                          appRunning: appRunning || source == "exec", waiting: isWaiting)
            let title = String((row[1] ?? "Codex 聊天").prefix(140))
            tasks.append(CodexTask(id: id, title: title, status: status, turnID: rollout?.id ?? turn?[0] ?? "",
                                   updatedAt: updated, source: historyPath, rolloutPath: rolloutPath))
        }
        lastRows = seen
        rolloutTurns = rolloutTurns.filter { path, _ in rows.contains { $0.count >= 5 && $0[4] == path } }
        let active: (CodexTask) -> Int = { $0.status == .waiting ? 0 : $0.status == .running ? 1 : 2 }
        tasks.sort { active($0) == active($1) ? $0.updatedAt > $1.updatedAt : active($0) < active($1) }
        return CodexSnapshot(tasks: tasks, available: true,
            detail: history == nil ? "已读取聊天列表；此 Codex 版本没有可用的任务状态记录。" : "本机状态 · 每 5 秒更新")
    }
}

extension CodexReader {
    private func rolloutTurn(_ path: String) -> RolloutTurn? {
        guard let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
              let modified = values.contentModificationDate, let size = values.fileSize else { return nil }
        if let cached = rolloutTurns[path], cached.modified == modified, cached.size == size { return cached.turn }
        let turn = Self.lastTurn(inRollout: URL(fileURLWithPath: path), modified: modified)
        rolloutTurns[path] = (modified, size, turn)
        return turn
    }

    /// Scans the file's tail backwards for the last `task_started` / `task_complete` / `turn_aborted` event.
    /// A long turn can push its start beyond a small tail, so it retries once with a larger one.
    static func lastTurn(inRollout url: URL, modified: Date) -> RolloutTurn? {
        let events = ["task_started": "inProgress", "task_complete": "completed", "turn_aborted": "interrupted"]
        let markers = events.keys.map { Data("\"\($0)\"".utf8) }
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let size = try? handle.seekToEnd() else { return nil }
        for tail: UInt64 in [256 * 1024, 8 * 1024 * 1024] {
            try? handle.seek(toOffset: size > tail ? size - tail : 0)
            guard let data = try? handle.readToEnd() else { return nil }
            for line in data.split(separator: UInt8(ascii: "\n")).reversed()
            where markers.contains(where: { line.range(of: $0) != nil }) {
                guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                      object["type"] as? String == "event_msg",
                      let payload = object["payload"] as? [String: Any],
                      let type = payload["type"] as? String, let status = events[type],
                      let id = payload["turn_id"] as? String else { continue }
                return RolloutTurn(id: id, status: status, modified: modified)
            }
            if size <= tail { break }
        }
        return nil
    }
}

private final class ReadOnlyDatabase {
    private var db: OpaquePointer?
    init?(_ path: String) {
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            if db != nil { sqlite3_close(db) }; return nil
        }
        sqlite3_busy_timeout(db, 150)
    }
    deinit { sqlite3_close(db) }
    func rows(_ sql: String, text: String? = nil) -> [[String?]]? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        if let text {
            _ = text.withCString { sqlite3_bind_text(statement, 1, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
        }
        var result: [[String?]] = []
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW else { return nil }
            result.append((0..<sqlite3_column_count(statement)).map { index in
                guard let bytes = sqlite3_column_text(statement, index) else { return nil }
                return String(cString: bytes)
            })
        }
    }
}
