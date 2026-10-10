import XCTest
import SQLite3
@testable import AgentDeskNativeCore

final class AgentDeskNativeCoreTests: XCTestCase {
    private let id = "01a0e3b4-4943-75b0-a292-f4eadb309a7c"
    private func task(_ status: TaskStatus, turn: String = "turn-1") -> CodexTask {
        CodexTask(id: id, title: "桌宠", status: status, turnID: turn, updatedAt: Date(), source: "test")
    }

    func testStaleOrClosedAppIsNotFalselyRunningOrCompleted() {
        let now = Date()
        // A turn that never finished (stale, or its app is gone) was cut off: interrupted, never completed.
        XCTAssertEqual(SessionPolicy.status(raw: "inProgress", updatedAt: now.addingTimeInterval(-3600), now: now, appRunning: true, waiting: false), .interrupted)
        XCTAssertEqual(SessionPolicy.status(raw: "inProgress", updatedAt: now, now: now, appRunning: false, waiting: false), .interrupted)
        XCTAssertEqual(SessionPolicy.status(raw: nil, updatedAt: now, now: now, appRunning: true, waiting: false), .unknown)
        XCTAssertEqual(SessionPolicy.status(raw: "failed", updatedAt: now, now: now, appRunning: true, waiting: false), .failed)
    }

    func testUntrustedTaskTextCannotChooseNavigationTarget() {
        XCTAssertEqual(SessionPolicy.threadURL(id)?.absoluteString, "codex://threads/\(id)")
        XCTAssertNil(SessionPolicy.threadURL("https://example.com"))
        XCTAssertNil(SessionPolicy.threadURL("../auth.json"))
        XCTAssertNil(SessionPolicy.threadURL(id + "?prompt=execute"))
    }

    func testMissingDirectoryNeverCreatesCodexDatabases() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        XCTAssertFalse(CodexReader(home: home).read(appRunning: true).available)
        XCTAssertFalse(FileManager.default.fileExists(atPath: home.path))
    }

    func testReaderUsesSelectedHomeAndMetadataWithoutWriting() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        let state = home.appendingPathComponent("state_5.sqlite")
        let history = home.appendingPathComponent("thread_history_1.sqlite")
        try createDB(state, sql: """
            CREATE TABLE threads(id TEXT, name TEXT, title TEXT, updated_at INTEGER, recency_at INTEGER, archived INTEGER, agent_path TEXT);
            INSERT INTO threads VALUES('\(id)', '桌宠', 'private prompt must not be chosen', 2000, 2000, 0, NULL);
            INSERT INTO threads VALUES('01a0e3b4-4943-75b0-a292-f4eadb309a7d', 'archived', '', 2100, 2100, 1, NULL);
            """)
        try createDB(history, sql: """
            CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, rollout_ordinal INTEGER);
            CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_type TEXT, item_json TEXT, rollout_ordinal INTEGER);
            INSERT INTO thread_turns VALUES('\(id)', 'old-turn', 'completed', 1900, 1950, 1);
            INSERT INTO thread_turns VALUES('\(id)', 'new-turn', 'inProgress', 2000, NULL, 3);
            INSERT INTO thread_items VALUES('\(id)', 'old-turn', 'mcpToolCall', '{"tool":"request_user_input", "status":"inProgress"}', 2);
            """)
        let originalState = try Data(contentsOf: state), originalHistory = try Data(contentsOf: history)
        let snapshot = CodexReader(home: home).read(appRunning: true, now: Date(timeIntervalSince1970: 2001))
        XCTAssertTrue(snapshot.available)
        XCTAssertEqual(snapshot.scope, "session")
        XCTAssertEqual(snapshot.tasks.count, 1)
        XCTAssertEqual(snapshot.tasks.first?.title, "桌宠")
        XCTAssertEqual(snapshot.tasks.first?.status, .running, "Old-turn input requests must not leak into the current turn")
        XCTAssertEqual(snapshot.tasks.first?.scope, "session")
        XCTAssertNil(snapshot.tasks.first?.rolloutPath, "旧表结构没有 rollout_path 时照常列出任务")
        XCTAssertEqual(try Data(contentsOf: state), originalState)
        XCTAssertEqual(try Data(contentsOf: history), originalHistory)
    }

    func testReaderKeepsRolloutPathWhenSchemaHasIt() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        try createDB(home.appendingPathComponent("state_5.sqlite"), sql: """
            CREATE TABLE threads(id TEXT, name TEXT, title TEXT, updated_at INTEGER, recency_at INTEGER, archived INTEGER, agent_path TEXT, rollout_path TEXT);
            INSERT INTO threads VALUES('\(id)', '桌宠', '', 2000, 2000, 0, NULL, '/h/sessions/2026/10/08/rollout-x.jsonl');
            """)
        let snapshot = CodexReader(home: home).read(appRunning: false, now: Date(timeIntervalSince1970: 2001))
        XCTAssertEqual(snapshot.tasks.first?.rolloutPath, "/h/sessions/2026/10/08/rollout-x.jsonl")
    }

    func testReaderHidesSubagentsAndTrustsExecTurnsWithoutDesktopApp() throws {
        let home = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: home) }
        let exec = "01a117cf-9f9e-71e0-8e00-a55e542f0fd1", guardian = "01a117d2-ec19-78d3-9502-7140369ba60c"
        let desktop = "01a1176a-8ac1-7ea0-bc6f-ee3c17c186cd", old = "01a11758-2f91-73e1-bc7e-14e91ade7dff"
        try createDB(home.appendingPathComponent("state_5.sqlite"), sql: """
            CREATE TABLE threads(id TEXT, name TEXT, title TEXT, updated_at INTEGER, recency_at INTEGER, archived INTEGER,
                                 agent_path TEXT, rollout_path TEXT, source TEXT);
            INSERT INTO threads VALUES('\(exec)', '', 'exec 任务', 2000, 2000, 0, NULL, NULL, 'exec');
            INSERT INTO threads VALUES('\(guardian)', '', 'Guardian review', 2000, 2000, 0, NULL, NULL, '{"subagent":{"other":"guardian"}}');
            INSERT INTO threads VALUES('\(desktop)', '', '桌面任务', 1990, 1990, 0, NULL, NULL, 'vscode');
            INSERT INTO threads VALUES('\(old)', '', '很早的对话', 1000, 1000, 0, NULL, NULL, 'vscode');
            """)
        try createDB(home.appendingPathComponent("thread_history_1.sqlite"), sql: """
            CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, rollout_ordinal INTEGER);
            CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_type TEXT, item_json TEXT, rollout_ordinal INTEGER);
            INSERT INTO thread_turns VALUES('\(exec)', 't1', 'inProgress', 2000, NULL, 1);
            INSERT INTO thread_turns VALUES('\(desktop)', 't2', 'inProgress', 1990, NULL, 1);
            """)
        let tasks = CodexReader(home: home).read(appRunning: false, now: Date(timeIntervalSince1970: 2001)).tasks
        XCTAssertEqual(tasks.map(\.id), [exec, desktop, old], "子代理（Guardian 等）不列出")
        XCTAssertEqual(tasks.map(\.status), [.running, .interrupted, .unknown],
                       "codex exec 不依赖桌面端；桌面端已关时未结束的回合算中断；没有回合记录的保持未知")
    }

    func testRolloutLifecycleOverridesStaleHistoryTurn() throws {
        let home = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: home) }
        let done = "01a1103f-c98a-77d0-88da-5838da2ff127", working = "01a110ab-dc2f-7d73-a4d8-357697c1aaa3"
        let aborted = "01a0e28d-fad9-75e1-9fc4-0dd64e9bfb18"
        func rollout(_ name: String, _ events: [String]) throws -> String {
            let url = home.appendingPathComponent("\(name).jsonl")
            let lines = [#"{"timestamp":"2026-10-07T13:00:00Z","type":"response_item","payload":{"type":"message","content":"task_complete secret"}}"#]
                + events.map { #"{"timestamp":"2026-10-07T14:00:00Z","type":"event_msg","payload":{"type":"\#($0)","turn_id":"t-new"}}"# }
            try lines.joined(separator: "\n").appending("\n").write(to: url, atomically: true, encoding: .utf8)
            return url.path
        }
        let donePath = try rollout("done", ["task_started", "task_complete"])
        let workingPath = try rollout("working", ["task_complete", "task_started"])
        let abortedPath = try rollout("aborted", ["task_started", "turn_aborted"])
        try createDB(home.appendingPathComponent("state_5.sqlite"), sql: """
            CREATE TABLE threads(id TEXT, name TEXT, title TEXT, updated_at INTEGER, recency_at INTEGER, archived INTEGER,
                                 agent_path TEXT, rollout_path TEXT, source TEXT);
            INSERT INTO threads VALUES('\(done)', '', '已完成', 3000, 3000, 0, NULL, '\(donePath)', 'vscode');
            INSERT INTO threads VALUES('\(working)', '', '进行中', 2900, 2900, 0, NULL, '\(workingPath)', 'vscode');
            INSERT INTO threads VALUES('\(aborted)', '', '被打断', 2800, 2800, 0, NULL, '\(abortedPath)', 'vscode');
            """)
        try createDB(home.appendingPathComponent("thread_history_1.sqlite"), sql: """
            CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, rollout_ordinal INTEGER);
            CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_type TEXT, item_json TEXT, rollout_ordinal INTEGER);
            INSERT INTO thread_turns VALUES('\(done)', 't-old', 'interrupted', 1000, 1002, 1);
            INSERT INTO thread_turns VALUES('\(working)', 't-old', 'completed', 1000, 1002, 1);
            INSERT INTO thread_turns VALUES('\(aborted)', 't-old', 'completed', 1000, 1002, 1);
            """)
        // The rollout files were just written, so an open turn counts as fresh.
        let tasks = CodexReader(home: home).read(appRunning: true).tasks
        let status = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0.status) })
        XCTAssertEqual(status[done], .completed, "数据库停在旧的中断回合，会话文件里后面的回合已正常完成")
        XCTAssertEqual(status[working], .running)
        XCTAssertEqual(status[aborted], .interrupted)
        XCTAssertEqual(tasks.first { $0.id == done }?.turnID, "t-new")
    }

    private func createDB(_ url: URL, sql: String) throws {
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(url.path, &db), SQLITE_OK)
        defer { sqlite3_close(db) }
        var error: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(db, sql, nil, nil, &error)
        let message = error.map { String(cString: $0) } ?? ""
        sqlite3_free(error)
        XCTAssertEqual(result, SQLITE_OK, message)
    }
}
