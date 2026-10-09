import XCTest
@testable import AgentDeskNativeCore

/// Clients opened from the Dock keep their data in default places; AgentDeskNative must treat those as accounts too.
final class DefaultDataTests: XCTestCase {
    func testDefaultLocations() {
        XCTAssertEqual(AppKind.codex.defaultProfilePath(home: "/Users/me"), "/Users/me/Library/Application Support/Codex")
        XCTAssertEqual(AppKind.codex.defaultSessionRoot(home: "/Users/me"), "/Users/me/.codex")
        XCTAssertEqual(AppKind.claude.defaultProfilePath(home: "/Users/me"), "/Users/me/Library/Application Support/Claude")
        XCTAssertEqual(AppKind.claude.defaultSessionRoot(home: "/Users/me"), "/Users/me/Library/Application Support/Claude")
        XCTAssertEqual(AppKind.codex.sessionRoot(forProfile: "/p/x", home: "/Users/me"), "/p/x/codex-home")
        XCTAssertEqual(AppKind.codex.sessionRoot(forProfile: "/Users/me/Library/Application Support/Codex", home: "/Users/me"),
                       "/Users/me/.codex", "默认目录的 CODEX_HOME 是 ~/.codex，不是 codex-home 子目录")
    }

    func testUseDefaultDataAndDiscoverUnclaimedDefaults() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let home = root.appendingPathComponent("home").path
        let store = AccountStore(root: root.appendingPathComponent("AgentDeskNative"),
                                 agentDeskProfiles: root.appendingPathComponent("missing.json"), home: home)
        try store.load()
        XCTAssertEqual(store.unclaimedDefaults(), [], "客户端从没用过（默认目录不存在）时不提示")

        for app in AppKind.allCases {
            try FileManager.default.createDirectory(atPath: app.defaultProfilePath(home: home), withIntermediateDirectories: true)
        }
        XCTAssertEqual(store.unclaimedDefaults(), [.codex, .claude])

        let omnix = try store.create(name: "Omnix", app: .codex)
        try store.useDefaultData(id: omnix.id)
        XCTAssertEqual(store.accounts[0].profilePath, AppKind.codex.defaultProfilePath(home: home))
        XCTAssertEqual(store.accounts[0].sessionRoot, home + "/.codex")
        XCTAssertEqual(store.unclaimedDefaults(), [.claude])

        let claude = try store.addDefault(app: .claude, name: "Omnid")
        XCTAssertEqual(claude.profilePath, AppKind.claude.defaultProfilePath(home: home))
        XCTAssertEqual(claude.sessionRoot, claude.profilePath)
        XCTAssertEqual(store.unclaimedDefaults(), [])
        XCTAssertThrowsError(try store.addDefault(app: .claude, name: "Again"), "同一份默认数据只能对应一个账号")

        try store.delete(id: claude.id, moveDataToTrash: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: claude.profilePath), "默认数据永远不会被移到废纸篓")
        XCTAssertEqual(store.unclaimedDefaults(), [.claude])
    }
}
