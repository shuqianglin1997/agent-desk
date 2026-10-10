import XCTest
@testable import AgentDeskNativeCore

final class ClaudeDesktopSessionTests: XCTestCase {
    private func session(_ profile: URL, id: String, title: String, audit: String) throws -> URL {
        let folder = profile.appendingPathComponent("local-agent-mode-sessions/org/user")
        let short = String(id.replacingOccurrences(of: "local_", with: "").prefix(8))
        try FileManager.default.createDirectory(at: folder.appendingPathComponent(short), withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("\(id).json")
        let data = try JSONSerialization.data(withJSONObject: ["id": id, "title": title, "lastActivityAt": 1791552004000, "initialMessage": "never display this"])
        try data.write(to: url)
        try audit.write(to: folder.appendingPathComponent("\(short)/audit.jsonl"), atomically: true, encoding: .utf8)
        return url
    }

    func testAccountsAreIsolatedAndAuditCacheUpdatesWithoutMetadataChange() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let a = root.appendingPathComponent("a"), b = root.appendingPathComponent("b")
        let id = "local_12345678-1234-1234-1234-123456789abc"
        let file = try session(a, id: id, title: "Account A", audit: "{\"type\":\"result\",\"is_error\":false}\n")
        _ = try session(b, id: id, title: "Account B", audit: "{\"type\":\"result\",\"is_error\":true}\n")
        let reader = ClaudeDesktopSessionReader(profileRoot: a)
        XCTAssertEqual(reader.recent(appRunning: false).map(\.title), ["Account A"])
        XCTAssertEqual(reader.recent(appRunning: false).first?.status, .completed)
        XCTAssertEqual(ClaudeDesktopSessionReader(profileRoot: b).recent(appRunning: false).first?.status, .failed)
        XCTAssertTrue(FileManager.default.contentsEqual(atPath: try XCTUnwrap(reader.recent(appRunning: false).first?.path), andPath: file.path))
        let audit = file.deletingLastPathComponent().appendingPathComponent("12345678/audit.jsonl")
        try "{\"type\":\"assistant\",\"message\":{\"stop_reason\":\"tool_use\"}}\n".write(to: audit, atomically: true, encoding: .utf8)
        let now = Date(timeIntervalSince1970: 1791552005)
        XCTAssertEqual(reader.recent(appRunning: true, now: now).first?.status, .running)
        XCTAssertEqual(reader.recent(appRunning: false, now: now).first?.status, .interrupted)
        XCTAssertEqual(reader.recent(appRunning: true, now: now.addingTimeInterval(3600)).first?.status, .interrupted)
        try "{\"type\":\"result\",\"is_error\":false}\n{unfinished".write(to: audit, atomically: true, encoding: .utf8)
        XCTAssertEqual(reader.recent(appRunning: true, now: now).first?.status, .completed)
    }

    func testSharedFixtureArchiveMissingAndPromptPrivacy() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("shared/fixtures")
        let folder = root.appendingPathComponent("local-agent-mode-sessions/org/user")
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("12345678"), withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("local_12345678-1234-1234-1234-123456789abc.json")
        try FileManager.default.copyItem(at: fixtures.appendingPathComponent("claude/session.json"), to: file)
        try FileManager.default.copyItem(at: fixtures.appendingPathComponent("claude/audit.jsonl"), to: folder.appendingPathComponent("12345678/audit.jsonl"))
        let expected = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtures.appendingPathComponent("expected/sessions.json"))) as! [String: Any]
        let reader = ClaudeDesktopSessionReader(profileRoot: root)
        XCTAssertEqual(reader.recent(appRunning: false).first?.title, expected["claudeTitle"] as? String)
        XCTAssertEqual(reader.recent(appRunning: false).first?.status, .completed)
        try #"{"id":"hidden","title":"Archived","isArchived":true}"#.write(to: folder.appendingPathComponent("archive.json"), atomically: true, encoding: .utf8)
        try #"{"id":"fallback","initialMessage":"must not be title"}"#.write(to: folder.appendingPathComponent("fallback.json"), atomically: true, encoding: .utf8)
        try "{}".write(to: folder.appendingPathComponent("unrelated.json"), atomically: true, encoding: .utf8)
        XCTAssertEqual(reader.recent(appRunning: true).count, 2)
        XCTAssertEqual(reader.recent(appRunning: true).first { $0.id == "fallback" }?.title, "Claude 会话")
        let missing = root.appendingPathComponent("missing")
        XCTAssertTrue(ClaudeDesktopSessionReader(profileRoot: missing).recent(appRunning: true).isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.path))
    }
}
