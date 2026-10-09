import XCTest
import SQLite3
@testable import AgentDeskNativeCore

final class BusyHistoryTests: XCTestCase {
    func testBusyHistoryKeepsLastKnownTurnStatus() throws {
        let id = "01a0e3b4-4943-75b0-a292-f4eadb309a7c"
        let home = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: home) }
        func exec(_ db: OpaquePointer?, _ sql: String) { XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK) }
        var state: OpaquePointer?, history: OpaquePointer?
        sqlite3_open(home.appendingPathComponent("state_5.sqlite").path, &state)
        exec(state, """
            CREATE TABLE threads(id TEXT, name TEXT, title TEXT, updated_at INTEGER, recency_at INTEGER, archived INTEGER, agent_path TEXT);
            INSERT INTO threads VALUES('\(id)', 't', '', 2000, 2000, 0, NULL);
            """)
        sqlite3_close(state)
        sqlite3_open(home.appendingPathComponent("thread_history_1.sqlite").path, &history)
        defer { sqlite3_close(history) }
        exec(history, """
            CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, rollout_ordinal INTEGER);
            CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_type TEXT, item_json TEXT, rollout_ordinal INTEGER);
            INSERT INTO thread_turns VALUES('\(id)', 'turn', 'completed', 1900, 1950, 1);
            """)
        let reader = CodexReader(home: home)
        XCTAssertEqual(reader.read(appRunning: true).tasks.first?.status, .completed)
        exec(history, "BEGIN EXCLUSIVE")   // rollback-journal DB: readers now get SQLITE_BUSY
        XCTAssertEqual(reader.read(appRunning: true).tasks.first?.status, .completed, "busy history must not flip to unknown")
        XCTAssertEqual(CodexReader(home: home).read(appRunning: true).tasks.first?.status, .unknown, "no prior read: honest unknown")
        exec(history, "ROLLBACK")
    }
}
