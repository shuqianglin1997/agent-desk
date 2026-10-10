import XCTest
import SwiftUI
import AppKit
import Combine
import SQLite3
import AgentDeskNativeCore
@testable import AgentDeskNative

final class SessionParityTests: XCTestCase {
    func testPollingUsesEachProfileAndRowDropsPersistWithoutCrossAccountMoves() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AccountStore(root: root, agentDeskProfiles: root.appendingPathComponent("missing"))
        try store.load()
        let a = try store.create(name: "A", app: .claude)
        let b = try store.create(name: "B", app: .claude)
        func write(_ account: Account, _ id: String, _ title: String) throws {
            let folder = URL(fileURLWithPath: account.profilePath).appendingPathComponent("local-agent-mode-sessions/org/user")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: ["id": id, "title": title, "status": "completed"])
            try data.write(to: folder.appendingPathComponent("\(id).json"))
        }
        try write(a, "one", "A one")
        try write(a, "two", "A two")
        try write(b, "one", "B one")
        let model = AgentDeskNativeModel(store: store)
        func poll(_ model: AgentDeskNativeModel) {
            let done = expectation(description: "account snapshots applied")
            let subscription = model.$claudeSessions.dropFirst().sink { sessions in
                if sessions[a.id]?.count == 2 && sessions[b.id]?.count == 1 { done.fulfill() }
            }
            model.poll()
            wait(for: [done], timeout: 5)
            withExtendedLifetime(subscription) {}
        }
        poll(model)
        XCTAssertEqual(Set(model.rows(for: a).map(\.title)), ["A one", "A two"])
        XCTAssertEqual(model.rows(for: b).map(\.title), ["B one"])
        let before = model.rows(for: a)
        XCTAssertTrue(PanelDrag.dropSession([PanelDrag.session(before[1].id, accountID: a.id)], on: before[0], account: a, desk: model))
        XCTAssertEqual(model.rows(for: a).map(\.id), [before[1].id, before[0].id])
        XCTAssertFalse(PanelDrag.dropSession([PanelDrag.session("one", accountID: b.id)], on: before[0], account: a, desk: model))
        XCTAssertFalse(PanelDrag.dropSession([PanelDrag.account(a.id)], on: before[0], account: a, desk: model))
        XCTAssertFalse(PanelDrag.dropSession(["session:bad"], on: before[0], account: a, desk: model))
        let restarted = AgentDeskNativeModel(store: store)
        poll(restarted)
        XCTAssertEqual(restarted.rows(for: a).map(\.id), model.rows(for: a).map(\.id))
        XCTAssertEqual(restarted.rows(for: b).map(\.title), ["B one"])
    }
    func testDefaultSlotRestoresLocalCodeHistoryWithoutLeakingToIsolatedProfiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AccountStore(root: root.appendingPathComponent("desk"), agentDeskProfiles: root.appendingPathComponent("missing"), home: root.path)
        try store.load()
        // Create the isolated account first: list order must never determine ownership.
        let isolated = try store.create(name: "Other", app: .claude)
        let defaultProfile = URL(fileURLWithPath: AppKind.claude.defaultProfilePath(home: root.path))
        try FileManager.default.createDirectory(at: defaultProfile, withIntermediateDirectories: true)
        let account = try store.addDefault(app: .claude, name: "Default")
        let project = root.appendingPathComponent(".claude/projects/project")
        try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)
        try Data("{\"type\":\"custom-title\",\"customTitle\":\"Recovered Code session\"}\n".utf8)
            .write(to: project.appendingPathComponent("code-session.jsonl"))
        let desktop = defaultProfile.appendingPathComponent("local-agent-mode-sessions/org/user")
        try FileManager.default.createDirectory(at: desktop, withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["id": "desktop-session", "title": "Desktop session"])
            .write(to: desktop.appendingPathComponent("desktop-session.json"))
        let model = AgentDeskNativeModel(store: store)
        let done = expectation(description: "both sources read")
        let subscription = model.$claudeSessions.dropFirst().sink { sessions in
            if sessions[account.id]?.count == 2 { done.fulfill() }
        }
        model.poll()
        wait(for: [done], timeout: 5)
        withExtendedLifetime(subscription) {}
        XCTAssertEqual(Set(model.rows(for: account).map(\.title)), ["Recovered Code session", "Desktop session"])
        XCTAssertEqual(model.rows(for: account).filter(\.isClaudeCode).map(\.title), ["Recovered Code session"])
        XCTAssertTrue(model.rows(for: isolated).isEmpty)
    }

    func testPanelAcceptsFirstMouseAndDoesNotDismissInsideClicks() {
        let host = FirstMouseHostingView(rootView: SwiftUI.Text("Panel"))
        XCTAssertTrue(host.acceptsFirstMouse(for: nil))
        let frame = NSRect(x: 100, y: 200, width: 320, height: 500)
        XCTAssertTrue(PanelClickPolicy.isInside(NSPoint(x: 120, y: 250), frame: frame))
        XCTAssertFalse(PanelClickPolicy.isInside(NSPoint(x: 99, y: 250), frame: frame))
        XCTAssertFalse(PanelClickPolicy.isInside(NSPoint(x: 120, y: 250), frame: nil))
    }

    func testCodexOrderingPreservesActivitySections() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AccountStore(root: root, agentDeskProfiles: root.appendingPathComponent("missing"))
        try store.load()
        let account = try store.create(name: "Codex", app: .codex)
        let time = Int(Date().timeIntervalSince1970)
        func database(_ name: String, sql: String) throws {
            var db: OpaquePointer?
            XCTAssertEqual(sqlite3_open(URL(fileURLWithPath: account.sessionRoot).appendingPathComponent(name).path, &db), SQLITE_OK)
            defer { sqlite3_close(db) }
            XCTAssertEqual(sqlite3_exec(db, sql, nil, nil, nil), SQLITE_OK)
        }
        try database("state_5.sqlite", sql: """
            CREATE TABLE threads(id TEXT,name TEXT,title TEXT,updated_at INTEGER,recency_at INTEGER,archived INTEGER,agent_path TEXT,rollout_path TEXT,source TEXT);
            INSERT INTO threads VALUES('12345678-1234-1234-1234-123456789ab3','Work','',\(time),\(time),0,NULL,NULL,'exec');
            INSERT INTO threads VALUES('12345678-1234-1234-1234-123456789ab1','A','',\(time-1),\(time-1),0,NULL,NULL,'exec');
            INSERT INTO threads VALUES('12345678-1234-1234-1234-123456789ab2','B','',\(time-2),\(time-2),0,NULL,NULL,'exec');
            """)
        try database("thread_history_1.sqlite", sql: """
            CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,rollout_ordinal INTEGER);
            CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_type TEXT,item_json TEXT,rollout_ordinal INTEGER);
            INSERT INTO thread_turns VALUES('12345678-1234-1234-1234-123456789ab3','t','inProgress',\(time),NULL,1);
            INSERT INTO thread_turns VALUES('12345678-1234-1234-1234-123456789ab1','t','completed',\(time-1),\(time),1);
            INSERT INTO thread_turns VALUES('12345678-1234-1234-1234-123456789ab2','t','completed',\(time-2),\(time),1);
            """)
        let model = AgentDeskNativeModel(store: store)
        let done = expectation(description: "Codex rows read")
        let subscription = model.$snapshots.dropFirst().sink { _ in done.fulfill() }
        model.poll()
        wait(for: [done], timeout: 5)
        withExtendedLifetime(subscription) {}
        XCTAssertEqual(model.rows(for: account).filter(\.isActive).map(\.id), ["12345678-1234-1234-1234-123456789ab3"])
        XCTAssertFalse(model.moveSession("12345678-1234-1234-1234-123456789ab3", before: "12345678-1234-1234-1234-123456789ab1", in: account))
        XCTAssertTrue(model.moveSession("12345678-1234-1234-1234-123456789ab2", before: "12345678-1234-1234-1234-123456789ab1", in: account))
        XCTAssertEqual(model.rows(for: account).filter { !$0.isActive }.map(\.id), ["12345678-1234-1234-1234-123456789ab2", "12345678-1234-1234-1234-123456789ab1"])
        XCTAssertEqual(model.rows(for: account).filter(\.isActive).map(\.id), ["12345678-1234-1234-1234-123456789ab3"])
    }

}
