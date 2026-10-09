import XCTest
@testable import AgentDeskNativeCore

final class LaunchPartsTests: XCTestCase {
    private var cleanup: [URL] = []
    override func tearDown() { cleanup.forEach { try? FileManager.default.removeItem(at: $0) } }
    private func shortPath(_ prefix: String) -> URL {
        let url = URL(fileURLWithPath: "/tmp/\(prefix)-\(UUID().uuidString.prefix(8).lowercased())")
        cleanup.append(url)
        return url
    }

    func testShortSessionRootIsPassedDirectly() throws {
        let dir = try makeShortDir(); cleanup.append(dir)
        let aliasRoot = shortPath("desk-a")
        let home = try RuntimeHome.resolve(accountID: "acct", sessionRoot: dir.path, aliasRoot: aliasRoot)
        XCTAssertEqual(home, dir.resolvingSymlinksInPath().path)
        XCTAssertFalse(FileManager.default.fileExists(atPath: aliasRoot.path))
    }

    func testLongSessionRootGetsPrivateShortAlias() throws {
        let base = shortPath("desk-t"), aliasRoot = shortPath("desk-a")
        let long = base.appendingPathComponent(String(repeating: "x", count: 100)).path
        XCTAssertTrue(RuntimeHome.needsAlias(long))

        let home = try RuntimeHome.resolve(accountID: "acct", sessionRoot: long, aliasRoot: aliasRoot)
        XCTAssertTrue(home.hasPrefix(aliasRoot.path + "/"))
        XCTAssertFalse(RuntimeHome.needsAlias(home))
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: home),
                       URL(fileURLWithPath: long).resolvingSymlinksInPath().path)
        let perms = try FileManager.default.attributesOfItem(atPath: aliasRoot.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(perms?.intValue, 0o700)
        XCTAssertEqual(try RuntimeHome.resolve(accountID: "acct", sessionRoot: long, aliasRoot: aliasRoot), home, "再次启动复用同一个软链接")
    }

    func testForeignFileAtAliasPathIsNeverReplaced() throws {
        let base = shortPath("desk-t"), aliasRoot = shortPath("desk-a")
        let long = base.appendingPathComponent(String(repeating: "y", count: 100)).path
        try FileManager.default.createDirectory(at: aliasRoot, withIntermediateDirectories: true)
        let alias = aliasRoot.appendingPathComponent(RuntimeHome.aliasName("acct"))
        try Data("not a link".utf8).write(to: alias)
        XCTAssertThrowsError(try RuntimeHome.resolve(accountID: "acct", sessionRoot: long, aliasRoot: aliasRoot)) {
            XCTAssertEqual($0 as? LaunchError, .aliasConflict)
        }
        XCTAssertEqual(try String(contentsOf: alias, encoding: .utf8), "not a link")
    }

    func testLaunchCommandArguments() {
        let account = Account(id: "a", name: "Omnix", app: .codex,
                              profilePath: "/P/Application Support/x", sessionRoot: "/P/x/codex-home",
                              createdAt: Date(), lastLaunchedAt: nil)
        XCTAssertEqual(LaunchCommand.make(appBundle: "/Applications/ChatGPT.app", account: account, codexHome: "/tmp/h").arguments,
                       ["-n", "-a", "/Applications/ChatGPT.app", "--env", "CODEX_HOME=/tmp/h",
                        "--args", "--user-data-dir=/P/Application Support/x"])
        var claude = account
        claude.app = .claude
        XCTAssertEqual(LaunchCommand.make(appBundle: "/Applications/Claude.app", account: claude, codexHome: "/ignored").arguments,
                       ["-n", "-a", "/Applications/Claude.app", "--args", "--user-data-dir=/P/Application Support/x"])
    }

    func testCrashpadPruneRemovesOldestUntilWithinLimit() throws {
        let profile = try makeTempDir(); cleanup.append(profile)
        let pending = profile.appendingPathComponent("Crashpad/pending")
        try FileManager.default.createDirectory(at: pending, withIntermediateDirectories: true)
        for (index, name) in ["a.dmp", "b.dmp", "c.dmp"].enumerated() {
            let file = pending.appendingPathComponent(name)
            try Data(repeating: 0, count: 10).write(to: file)
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: Double(1000 + index))],
                                                  ofItemAtPath: file.path)
        }
        XCTAssertEqual(CrashpadCleaner.prune(profilePath: profile.path, limit: 15), 2)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: pending.path), ["c.dmp"])
        XCTAssertEqual(CrashpadCleaner.prune(profilePath: profile.path.appending("-missing")), 0)
    }
}
