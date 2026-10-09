import XCTest
@testable import AgentDeskNativeCore

final class CodexAppServerTests: XCTestCase {
    func testExchangeFollowsProtocolAndDropsIdentity() {
        var exchange = CodexAppServer.Exchange()
        XCTAssertEqual(CodexAppServer.Exchange.initialize["method"] as? String, "initialize")
        let first = exchange.receive(["id": 1, "result": [:]])
        XCTAssertEqual(first.send.map { $0["method"] as? String }, ["initialized", "account/read", "account/rateLimits/read"])
        XCTAssertEqual(first.send.map { $0["id"] as? Int }, [nil, 2, 3])
        XCTAssertNil(first.done)
        XCTAssertNil(exchange.receive(["method": "account/updated", "params": [:]]).done)   // notifications are ignored
        XCTAssertNil(exchange.receive(["id": 3, "error": ["code": -32600, "message": "chatgpt authentication required"]]).done)
        let last = exchange.receive(["id": 2, "result": ["requiresOpenaiAuth": true,
            "account": ["type": "chatgpt", "planType": "plus", "email": "someone@example.com"]]])
        guard case .success(let answer)? = last.done else { return XCTFail("应在两个回复都到齐后完成") }
        XCTAssertNil(answer.rateLimits)
        XCTAssertEqual((answer.account?["account"] as? [String: Any])?["type"] as? String, "chatgpt")
        XCTAssertFalse(String(describing: answer.account).contains("someone@example.com"))

        var failing = CodexAppServer.Exchange()
        guard case .failure(.initializeFailed)? = failing.receive(["id": 1, "error": ["code": -1]]).done else {
            return XCTFail("initialize 出错应失败")
        }
    }

    private func fakeCLI(_ body: String) throws -> (cli: String, dir: URL) {
        let dir = try makeTempDir()
        let url = dir.appendingPathComponent("codex")
        try ("#!/bin/sh\n" + body).write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return (url.path, dir)
    }

    func testQueryRunsAppServerWithCodexHome() throws {
        let (cli, dir) = try fakeCLI("""
            echo "$CODEX_HOME|$*" > "$(dirname "$0")/seen.txt"
            read init
            echo '{"id":1,"result":{"userAgent":"fake"}}'
            read a; read b; read c
            echo "$a$b$c" > "$(dirname "$0")/requests.txt"
            echo '{"method":"account/updated","params":{}}'
            echo '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":34,"windowDurationMins":10080,"resetsAt":1791960941}}}}'
            echo '{"id":2,"result":{"account":{"type":"chatgpt","planType":"prolite"},"requiresOpenaiAuth":true}}'
            cat > /dev/null
            """)
        defer { try? FileManager.default.removeItem(at: dir) }
        guard case .success(let answer) = CodexAppServer.query(cli: cli, codexHome: "/tmp/some home", timeout: 5) else {
            return XCTFail("应查询成功")
        }
        XCTAssertEqual(QuotaParser.classify(accountResult: answer.account, rateLimits: answer.rateLimits),
                       .windows([QuotaWindow(minutes: 10080, usedPercent: 34, resetsAt: Date(timeIntervalSince1970: 1791960941))]))
        let seen = try String(contentsOf: dir.appendingPathComponent("seen.txt"), encoding: .utf8)
        XCTAssertEqual(seen, "/tmp/some home|app-server --listen stdio://\n")
        let requests = try String(contentsOf: dir.appendingPathComponent("requests.txt"), encoding: .utf8)
        XCTAssertTrue(requests.contains("\"initialized\""))
        XCTAssertTrue(requests.contains("account/rateLimits/read"))
    }

    func testQueryFailures() throws {
        let slow = try fakeCLI("read init\nexec sleep 30\n")
        defer { try? FileManager.default.removeItem(at: slow.dir) }
        let started = Date()
        XCTAssertEqual(failure(CodexAppServer.query(cli: slow.cli, codexHome: "/tmp", timeout: 0.5)), .timedOut)
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)

        let quits = try fakeCLI("exit 3\n")
        defer { try? FileManager.default.removeItem(at: quits.dir) }
        XCTAssertEqual(failure(CodexAppServer.query(cli: quits.cli, codexHome: "/tmp", timeout: 5)), .exited)

        XCTAssertEqual(failure(CodexAppServer.query(cli: "/nonexistent/codex", codexHome: "/tmp", timeout: 5)), .startFailed)
    }

    /// A wrapper whose grandchild ignores TERM, keeps stdout and only exits on stdin EOF.
    func testTimeoutClosesStdinSoOrphanedChildExits() throws {
        let wrapper = try fakeCLI("""
            trap '' TERM
            exec 3<&0
            (cat <&3 > /dev/null; echo gone > "$(dirname "$0")/orphan.txt") 3<&3 &
            read init
            exec sleep 30
            """)
        defer { try? FileManager.default.removeItem(at: wrapper.dir) }
        let started = Date()
        XCTAssertEqual(failure(CodexAppServer.query(cli: wrapper.cli, codexHome: "/tmp", timeout: 1)), .timedOut)
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
        let marker = wrapper.dir.appendingPathComponent("orphan.txt")
        let deadline = Date().addingTimeInterval(3)
        while !FileManager.default.fileExists(atPath: marker.path), Date() < deadline { usleep(50_000) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: marker.path), "the orphan should see stdin EOF and exit")
    }

    private func failure(_ result: Result<CodexAppServer.Answer, CodexAppServer.Failure>) -> CodexAppServer.Failure? {
        if case .failure(let failure) = result { return failure }
        return nil
    }
}
