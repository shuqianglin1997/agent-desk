import XCTest
@testable import AgentDeskNativeCore

final class AccountGroupsTests: XCTestCase {
    private func account(_ name: String, _ app: AppKind) -> Account {
        Account(id: name, name: name, app: app, profilePath: "/p/\(name)", sessionRoot: "/p/\(name)",
                createdAt: Date(), lastLaunchedAt: nil)
    }

    func testGroupsFollowSavedOrderKeepAccountOrderAndSkipEmptyApps() {
        let accounts = [account("Omnid", .claude), account("Omnix", .codex), account("Nux", .codex)]
        let groups = AccountGroups.ordered(accounts, order: [.codex, .claude])
        XCTAssertEqual(groups.map(\.app), [.codex, .claude])
        XCTAssertEqual(groups[0].accounts.map(\.name), ["Omnix", "Nux"])
        XCTAssertEqual(AccountGroups.ordered(accounts, order: []).map(\.app), [.claude, .codex],
                       "没有保存过顺序时按账号首次出现的顺序")
        XCTAssertEqual(AccountGroups.ordered([account("Nux", .codex)], order: [.claude, .codex]).map(\.app), [.codex],
                       "没有账号的客户端不显示分组")
    }

    func testMovingGroupPutsItBeforeTarget() {
        XCTAssertEqual(AccountGroups.move(.claude, before: .codex, in: [.codex, .claude]), [.claude, .codex])
        XCTAssertEqual(AccountGroups.move(.codex, before: nil, in: [.codex, .claude]), [.claude, .codex])
        XCTAssertEqual(AccountGroups.move(.codex, before: .codex, in: [.codex, .claude]), [.codex, .claude])
        XCTAssertEqual(AccountGroups.move(.claude, before: .codex, in: []), [.claude, .codex], "补全未保存的客户端")
    }
}
