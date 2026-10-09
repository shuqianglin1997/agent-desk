import XCTest
@testable import AgentDeskNativeCore

final class AccountStoreTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws { root = try makeTempDir() }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

    private func writeAgentDesk(_ profiles: [[String: Any]]) throws -> URL {
        let url = root.appendingPathComponent("AgentDesk/profiles.json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: ["version": 1, "profiles": profiles]).write(to: url)
        return url
    }
    private func emptyStore() throws -> AccountStore {
        let store = AccountStore(root: root.appendingPathComponent("AgentDeskNative"),
                                 agentDeskProfiles: root.appendingPathComponent("missing.json"))
        try store.load()
        return store
    }

    func testFirstLoadImportsClaudeAndCodexSlotsOnly() throws {
        let agentDesk = try writeAgentDesk([
            ["id": "a1", "appId": "codex", "name": "Omnix", "group": "", "profilePath": "/p/codex",
             "sessionRoot": "/p/codex/codex-home", "createdAt": "2026-09-15T04:12:56.102Z",
             "lastLaunchedAt": "2026-10-06T15:22:22.129Z"],
            ["id": "a2", "appId": "claude", "name": "Omnid", "group": "个人", "profilePath": "/p/claude",
             "sessionRoot": "/p/claude", "createdAt": "2026-09-15T03:38:30.011Z", "lastLaunchedAt": NSNull()],
            ["id": "a3", "appId": "cursor", "name": "Cur", "profilePath": "/p/cur", "sessionRoot": "/p/cur"]
        ])
        let store = AccountStore(root: root.appendingPathComponent("AgentDeskNative"), agentDeskProfiles: agentDesk)
        try store.load()

        XCTAssertEqual(store.accounts.map(\.name), ["Omnix", "Omnid"])
        XCTAssertEqual(store.accounts[0].app, .codex)
        XCTAssertEqual(store.accounts[0].sessionRoot, "/p/codex/codex-home")
        XCTAssertNotNil(store.accounts[0].lastLaunchedAt)
        XCTAssertFalse(try String(contentsOf: store.fileURL, encoding: .utf8).contains("个人"), "agent-desk 的分组标签不再保存")
        XCTAssertNil(store.accounts[1].lastLaunchedAt)
        XCTAssertEqual(store.skippedImports, ["Cur（cursor）"])
        let perms = try FileManager.default.attributesOfItem(atPath: store.fileURL.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(perms?.intValue, 0o600)

        // accounts.json is now the source of truth; later agent-desk changes are not re-imported.
        _ = try writeAgentDesk([])
        let reopened = AccountStore(root: store.root, agentDeskProfiles: agentDesk)
        try reopened.load()
        XCTAssertEqual(reopened.accounts, store.accounts)
        XCTAssertEqual(reopened.skippedImports, ["Cur（cursor）"])
    }

    func testCreateRenameDeleteKeepsDataByDefault() throws {
        let store = try emptyStore()
        XCTAssertEqual(store.accounts, [])

        let account = try store.create(name: " Work/Alt ", app: .codex)
        XCTAssertEqual(account.name, "Work/Alt")
        XCTAssertTrue(account.profilePath.contains("/Profiles/Codex/Work-Alt-"), account.profilePath)
        XCTAssertEqual(account.sessionRoot, account.profilePath + "/codex-home")
        let perms = try FileManager.default.attributesOfItem(atPath: account.sessionRoot)[.posixPermissions] as? NSNumber
        XCTAssertEqual(perms?.intValue, 0o700)

        XCTAssertThrowsError(try store.rename(id: account.id, to: "  "))
        try store.rename(id: account.id, to: "Omnix 2")
        XCTAssertEqual(store.accounts.first?.name, "Omnix 2")

        try store.delete(id: account.id, moveDataToTrash: false)
        XCTAssertTrue(store.accounts.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: account.profilePath), "默认保留数据目录")

        let claude = try store.create(name: "Omnid", app: .claude)
        XCTAssertTrue(claude.profilePath.contains("/Profiles/Claude/Omnid-"))
        XCTAssertEqual(claude.sessionRoot, claude.profilePath)
        XCTAssertThrowsError(try store.create(name: "   ", app: .claude))
    }

    func testMoveReordersAndPersists() throws {
        let store = try emptyStore()
        let a = try store.create(name: "A", app: .codex), b = try store.create(name: "B", app: .codex)
        let c = try store.create(name: "C", app: .claude)
        try store.move(id: c.id, before: a.id)
        XCTAssertEqual(store.accounts.map(\.name), ["C", "A", "B"])
        try store.move(id: c.id, before: nil)
        XCTAssertEqual(store.accounts.map(\.name), ["A", "B", "C"])
        try store.move(id: b.id, before: a.id)
        let reopened = AccountStore(root: store.root, agentDeskProfiles: store.agentDeskProfiles)
        try reopened.load()
        XCTAssertEqual(reopened.accounts.map(\.name), ["B", "A", "C"])
        XCTAssertThrowsError(try store.move(id: a.id, before: "missing"))
        XCTAssertEqual(store.accounts.map(\.name), ["B", "A", "C"], "目标不存在时顺序不变")
    }

    func testRelocateAndMarkLaunchedPersist() throws {
        let store = try emptyStore()
        let account = try store.create(name: "X", app: .codex)
        try store.relocate(id: account.id, profilePath: "/new/place")
        let launched = Date(timeIntervalSince1970: 1_800_000_000)
        try store.markLaunched(id: account.id, at: launched)
        XCTAssertThrowsError(try store.rename(id: "nope", to: "Y"))

        let reopened = AccountStore(root: store.root, agentDeskProfiles: store.agentDeskProfiles)
        try reopened.load()
        XCTAssertEqual(reopened.accounts.first?.profilePath, "/new/place")
        XCTAssertEqual(reopened.accounts.first?.sessionRoot, "/new/place/codex-home")
        XCTAssertEqual(reopened.accounts.first?.lastLaunchedAt, launched)
    }

    func testFailedLoadBlocksWritesSoSlotsAreNotWiped() throws {
        let dir = root.appendingPathComponent("AgentDesk")
        let profiles = dir.appendingPathComponent("profiles.json")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try "{ invalid json".write(to: profiles, atomically: true, encoding: .utf8)
        let store = AccountStore(root: root.appendingPathComponent("AgentDeskNative"), agentDeskProfiles: profiles)
        XCTAssertThrowsError(try store.load())
        XCTAssertThrowsError(try store.create(name: "新账号", app: .codex)) { XCTAssertEqual($0 as? AccountError, .notLoaded) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
        XCTAssertEqual(AccountError.notLoaded.errorDescription, "账号列表尚未成功读取，已停止写入以免覆盖")
    }

    func testUnreadableProfilesJsonThrowsAndDoesNotSave() throws {
        let agentDeskDir = root.appendingPathComponent("AgentDesk")
        let profilesUrl = agentDeskDir.appendingPathComponent("profiles.json")
        try FileManager.default.createDirectory(at: agentDeskDir, withIntermediateDirectories: true)

        // Write garbage bytes that cannot be parsed as JSON
        try "{ invalid json".data(using: .utf8)!.write(to: profilesUrl)

        let store = AccountStore(root: root.appendingPathComponent("AgentDeskNative"), agentDeskProfiles: profilesUrl)
        XCTAssertThrowsError(try store.load()) { error in
            guard case .importFailed = error as? AccountError else {
                XCTFail("Expected .importFailed error, got \(error)")
                return
            }
        }

        // accounts.json should NOT have been created
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path),
                       "accounts.json should not exist after import failure")

        // Now write a valid profiles.json and verify import succeeds
        let validData = try JSONSerialization.data(withJSONObject: [
            "version": 1,
            "profiles": [
                ["id": "a1", "appId": "codex", "name": "Test", "group": "", "profilePath": "/test",
                 "sessionRoot": "/test/codex-home", "createdAt": "2026-09-15T04:12:56.102Z", "lastLaunchedAt": NSNull()]
            ]
        ])
        try validData.write(to: profilesUrl)

        let store2 = AccountStore(root: root.appendingPathComponent("AgentDeskNative"), agentDeskProfiles: profilesUrl)
        try store2.load()
        XCTAssertEqual(store2.accounts.count, 1)
        XCTAssertEqual(store2.accounts[0].name, "Test")
        XCTAssertTrue(FileManager.default.fileExists(atPath: store2.fileURL.path),
                      "accounts.json should exist after successful import")
    }
}
