import XCTest
@testable import AgentDeskNativeCore

final class ClaudeSessionReaderTests: XCTestCase {
    private func write(_ url: URL, _ lines: [String], modified: Date) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try lines.joined(separator: "\n").appending("\n").write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: url.path)
    }

    func testRecentSessionsUseTitleOrCwdOrderedByFileTime() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let project = root.appendingPathComponent("-Users-me-desk")
        let old = UUID().uuidString.lowercased(), new = UUID().uuidString.lowercased()
        try write(project.appendingPathComponent("\(old).jsonl"), [
            #"{"type":"user","cwd":"/Users/me/desk","message":{"content":"secret prompt"}}"#
        ], modified: Date(timeIntervalSince1970: 1000))
        try write(project.appendingPathComponent("\(new).jsonl"), [
            #"{"type":"user","cwd":"/Users/me/other","message":{"content":"talks about \"custom-title\" in text"}}"#,
            #"{"type":"custom-title","customTitle":"旧标题","sessionId":"x"}"#,
            #"{"type":"custom-title","customTitle":"desk 设计讨论","sessionId":"x"}"#
        ], modified: Date(timeIntervalSince1970: 2000))
        try write(project.appendingPathComponent("\(new)/subagents/agent-1.jsonl"), ["{}"], modified: Date(timeIntervalSince1970: 3000))

        let reader = ClaudeSessionReader(projectsRoot: root)
        let sessions = reader.recent(limit: 15)
        XCTAssertEqual(sessions.map(\.id), [new, old], "按文件修改时间倒序，忽略子目录里的文件")
        XCTAssertEqual(sessions[0].title, "desk 设计讨论", "多条 custom-title 取最后一条")
        XCTAssertEqual(sessions[0].cwd, "/Users/me/other")
        XCTAssertEqual(sessions[1].title, "desk", "没有标题时用工作目录名")
        XCTAssertEqual(sessions[1].updatedAt, Date(timeIntervalSince1970: 1000))
        XCTAssertEqual(reader.recent(limit: 1).map(\.id), [new])
        XCTAssertEqual(ClaudeSessionReader(projectsRoot: root.appendingPathComponent("missing")).recent(), [])
    }

    func testSessionStatusComesFromLastTurnStructureOnly() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let project = root.appendingPathComponent("-Users-me-desk")
        let now = Date(timeIntervalSince1970: 100_000)
        func session(_ name: String, _ lines: [String], age: TimeInterval) throws {
            try write(project.appendingPathComponent("\(name).jsonl"), lines, modified: now.addingTimeInterval(-age))
        }
        let prompt = #"{"type":"user","message":{"role":"user","content":"secret"}}"#
        let toolUse = #"{"type":"assistant","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use"}]}}"#
        let toolResult = #"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}"#
        let done = #"{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"ok"}]}}"#
        let interrupted = #"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}"#
        let meta = #"{"type":"user","isMeta":true,"message":{"role":"user","content":"caveat"}}"#
        try session("a-done", [prompt, toolUse, toolResult, done, meta, #"{"type":"cost-state"}"#], age: 10)
        try session("b-working", [prompt, toolUse, toolResult], age: 20)
        try session("c-stale", [prompt, toolUse], age: 3 * 3600)
        try session("d-stopped", [prompt, toolUse, interrupted], age: 30)
        try session("e-empty", [#"{"type":"summary"}"#], age: 40)
        let exit = #"{"type":"user","message":{"role":"user","content":"<command-name>/exit</command-name>"}}"#
        let stdout = #"{"type":"user","message":{"role":"user","content":"<local-command-stdout>Bye!</local-command-stdout>"}}"#
        let notice = #"{"type":"user","message":{"role":"user","content":"<task-notification>done</task-notification>"}}"#
        try session("f-exited", [prompt, done, exit, stdout, notice], age: 3 * 3600)

        let status = Dictionary(uniqueKeysWithValues: ClaudeSessionReader(projectsRoot: root).recent(now: now).map { ($0.id, $0.status) })
        XCTAssertEqual(status["a-done"], .completed, "回合以 end_turn 结束；之后的元信息记录不算新回合")
        XCTAssertEqual(status["b-working"], .running, "最近还在写、回合没结束")
        XCTAssertEqual(status["c-stale"], .interrupted, "回合没结束但很久没动静")
        XCTAssertEqual(status["d-stopped"], .interrupted, "用户手动打断")
        XCTAssertEqual(status["e-empty"], .unknown)
        XCTAssertEqual(status["f-exited"], .completed, "/exit、命令输出、后台通知不是新的一轮")
    }
}
