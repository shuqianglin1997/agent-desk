import XCTest
@testable import AgentDeskNativeCore

final class LauncherTests: XCTestCase {
    private var cleanup: [URL] = []
    override func tearDown() { cleanup.forEach { try? FileManager.default.removeItem(at: $0) } }

    private func fakeApp(_ root: URL, _ name: String, id: String) throws {
        let contents = root.appendingPathComponent("\(name)/Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": id], format: .xml, options: 0)
        try plist.write(to: contents.appendingPathComponent("Info.plist"))
    }

    func testLocatorPrefersChatGPTAndRejectsWrongBundleID() throws {
        let root = try makeTempDir(); cleanup.append(root)
        try fakeApp(root, "ChatGPT.app", id: "com.example.fake")
        try fakeApp(root, "Codex.app", id: "com.openai.codex")
        XCTAssertEqual(AppLocator.locate(.codex, roots: [root])?.lastPathComponent, "Codex.app")
        try fakeApp(root, "ChatGPT.app", id: "com.openai.codex")
        XCTAssertEqual(AppLocator.locate(.codex, roots: [root])?.lastPathComponent, "ChatGPT.app")
        XCTAssertNil(AppLocator.locate(.claude, roots: [root]))
        XCTAssertEqual(AppLocator.missingMessage(.codex), "找不到 Codex 客户端（ChatGPT.app）")
    }

    func testOwnerMatchesExactUserDataDirOnMainProcessOnly() {
        let processes = ProcessMatcher.parse("""
              101 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/A/Codex/x-1
              102 /Applications/ChatGPT.app/Contents/Frameworks/ChatGPT Helper (Renderer).app/Contents/MacOS/ChatGPT Helper (Renderer) --type=renderer --user-data-dir=/A/Codex/x-12
              103 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/A/Codex/x-12 --flag
              104 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/Users/me/Library/Application Support/AgentDesk/Profiles/Claude/e-1
              105 /usr/bin/open -n -a /Applications/ChatGPT.app --args --user-data-dir=/A/Codex/y-1
              106 grep ChatGPT --user-data-dir=/A/Codex/y-1
            """)
        XCTAssertEqual(processes.count, 6)
        XCTAssertNil(ProcessMatcher.owner(of: "/A/Codex/y-1", in: processes))
        XCTAssertEqual(ProcessMatcher.owner(of: "/A/Codex/x-1", in: processes)?.pid, 101)
        XCTAssertEqual(ProcessMatcher.owner(of: "/A/Codex/x-12", in: processes)?.pid, 103)
        XCTAssertEqual(ProcessMatcher.owner(of: "/Users/me/Library/Application Support/AgentDesk/Profiles/Claude/e-1", in: processes)?.pid, 104)
        XCTAssertNil(ProcessMatcher.owner(of: "/A/Codex/x", in: processes))
    }

    func testDefaultDataDirAlsoMatchesClientStartedWithoutFlag() {
        let processes = ProcessMatcher.parse("""
              201 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/A/Codex/x-1
              202 /Applications/ChatGPT.app/Contents/Frameworks/ChatGPT Helper.app/Contents/MacOS/ChatGPT Helper --type=gpu-process
              203 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT
              204 /Applications/Claude.app/Contents/MacOS/Claude
            """)
        let codexDefault = "/Users/me/Library/Application Support/Codex"
        XCTAssertEqual(ProcessMatcher.owner(of: codexDefault, in: processes, home: "/Users/me")?.pid, 203)
        XCTAssertEqual(ProcessMatcher.owner(of: "/Users/me/Library/Application Support/Claude", in: processes, home: "/Users/me")?.pid, 204)
        // Non-default dirs never claim a flagless process.
        XCTAssertNil(ProcessMatcher.owner(of: "/A/Codex/y-1", in: processes, home: "/Users/me"))
        // An explicit flag for the default dir still matches.
        let flagged = ProcessMatcher.parse("301 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=\(codexDefault)")
        XCTAssertEqual(ProcessMatcher.owner(of: codexDefault, in: flagged, home: "/Users/me")?.pid, 301)
    }

    private func account(_ dir: URL) -> Account {
        Account(id: "acct", name: "Omnix", app: .codex, profilePath: dir.path,
                sessionRoot: dir.appendingPathComponent("codex-home").path, createdAt: Date(), lastLaunchedAt: nil)
    }

    func testRunningAccountIsActivatedNotRelaunched() throws {
        let dir = try makeShortDir(); cleanup.append(dir)
        var ran: [LaunchCommand] = [], activated: [Int32] = []
        let launcher = Launcher(
            activate: { activated.append($0); return true },
            locate: { _ in URL(fileURLWithPath: "/Applications/ChatGPT.app") },
            processes: { [RunningProcess(pid: 42, args: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=\(dir.path)")] },
            run: { ran.append($0) })
        XCTAssertEqual(launcher.launch(account(dir)), .activated(pid: 42))
        XCTAssertEqual(activated, [42])
        XCTAssertTrue(ran.isEmpty)
    }

    func testUnknownProcessListCancelsLaunch() throws {
        let dir = try makeShortDir(); cleanup.append(dir)
        let launcher = Launcher(activate: { _ in true }, locate: { _ in URL(fileURLWithPath: "/Applications/ChatGPT.app") },
                                processes: { nil }, run: { _ in XCTFail("ps 失败时不应启动") })
        XCTAssertEqual(launcher.launch(account(dir)), .failed("无法确认客户端是否在运行，已取消启动"))
    }

    func testStoppedAccountLaunchesWithCodexHome() throws {
        let dir = try makeShortDir(); cleanup.append(dir)
        var ran: [LaunchCommand] = []
        let launcher = Launcher(activate: { _ in true },
                                locate: { _ in URL(fileURLWithPath: "/Applications/ChatGPT.app") },
                                processes: { [] }, run: { ran.append($0) })
        let target = account(dir)
        XCTAssertEqual(launcher.launch(target), .launched)
        let home = URL(fileURLWithPath: target.sessionRoot).resolvingSymlinksInPath().path
        XCTAssertEqual(ran.first?.arguments, ["-n", "-a", "/Applications/ChatGPT.app", "--env", "CODEX_HOME=\(home)",
                                              "--args", "--user-data-dir=\(dir.path)"])
    }

    func testMissingClientAndMissingDataAreReported() throws {
        let dir = try makeShortDir(); cleanup.append(dir)
        let launcher = Launcher(activate: { _ in true }, locate: { _ in nil }, processes: { [] },
                                run: { _ in XCTFail("不应执行 open") })
        XCTAssertEqual(launcher.launch(account(dir)), .failed("找不到 Codex 客户端（ChatGPT.app）"))
        var gone = account(dir)
        gone.profilePath = dir.appendingPathComponent("missing").path
        XCTAssertEqual(launcher.launch(gone), .failed("数据目录不存在"))
    }

    func testSessionRouting() {
        let id = "01a0e3b4-4943-75b0-a292-f4eadb309a7c"
        let url = URL(string: "codex://threads/\(id)")!
        XCTAssertEqual(SessionRouting.codex(threadID: id, runningCodexInstances: 1), .openURL(url))
        XCTAssertEqual(SessionRouting.codex(threadID: id, runningCodexInstances: 2), .activateOnly)
        XCTAssertEqual(SessionRouting.codex(threadID: "../auth.json", runningCodexInstances: 1), .activateOnly)
    }
}
