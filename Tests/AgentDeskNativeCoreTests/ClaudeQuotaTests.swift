import XCTest
@testable import AgentDeskNativeCore

final class ClaudeQuotaTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_791_500_000)
    private func key(account: String = "owner", org: String = "org", scopes: String = "user:profile") -> String {
        "acct:\(account)|device:\(org):https://api.anthropic.com:\(scopes)"
    }
    private func entry(token: String = "test-token", age: TimeInterval = 3600) -> [String: Any] {
        ["token": token, "expiresAt": now.addingTimeInterval(age).timeIntervalSince1970 * 1000]
    }

    func testUsageParsingPreservesActualPercentAndFractionalReset() throws {
        let data = Data(#"{"five_hour":{"utilization":6,"resets_at":"2026-10-09T09:50:00.510386+00:00"},"seven_day":{"utilization":95,"resets_at":"2026-10-09T11:00:00.510415+00:00"}}"#.utf8)
        let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let windows = ClaudeQuota.windows(object)
        XCTAssertEqual(windows.map(\.usedPercent), [6, 95])
        XCTAssertEqual(windows.map(\.minutes), [300, 10080])
        XCTAssertEqual(try XCTUnwrap(windows.first?.resetsAt).timeIntervalSince1970,
                       ISO8601.parse("2026-10-09T09:50:00.510386Z")!.timeIntervalSince1970, accuracy: 0.001)
    }

    func testMissingAndInvalidUsageNeverBecomeZero() {
        XCTAssertTrue(ClaudeQuota.windows(["five_hour": ["utilization": NSNull()], "seven_day": ["utilization": 101]]).isEmpty)
        let windows = ClaudeQuota.windows(["five_hour": ["utilization": 0, "resets_at": NSNull()]])
        XCTAssertEqual(windows.first?.usedPercent, 0)
        XCTAssertNil(windows.first?.resetsAt)
    }

    func testCredentialsStayBoundToAccountOrganizationAndUsageScope() throws {
        let entries: [String: Any] = [key(): entry(), key(account: "other"): entry(token: "wrong-account", age: 9000),
                                    key(org: "other-org"): entry(token: "wrong-org", age: 8000)]
        XCTAssertEqual(try ClaudeQuota.selectToken(entries, account: "owner", organization: "org", now: now).get(), "test-token")
        if case .success = ClaudeQuota.selectToken(entries, account: "owner", organization: nil, now: now) {
            XCTFail("Ambiguous organizations must not select a token")
        }
        if case .success = ClaudeQuota.selectToken(entries, account: "missing", organization: "org", now: now) {
            XCTFail("Another account's token must not be used")
        }
        XCTAssertEqual(ClaudeQuota.selectToken([key(scopes: "user:inference"): entry()], account: "owner", organization: "org", now: now), .failure(.noUsageScope))
        XCTAssertEqual(ClaudeQuota.selectToken([key(): entry(age: -1)], account: "owner", organization: "org", now: now), .failure(.expired))
    }

    func testStaleOrganizationHistoryDoesNotBlockUniqueCurrentLogin() throws {
        let entries: [String: Any] = [key(org: "new-org"): entry(), key(org: "expired-org"): entry(age: -100)]
        XCTAssertEqual(try ClaudeQuota.selectToken(entries, account: "owner", organization: "previous-account-org", now: now).get(), "test-token")
        let ambiguous: [String: Any] = [key(org: "one"): entry(), key(org: "two"): entry()]
        XCTAssertEqual(ClaudeQuota.selectToken(ambiguous, account: "owner", organization: "stale-org", now: now), .failure(.noLogin))
    }

    func testFailureRetainsLastGoodValueAndOriginalTimestamp() {
        let value = QuotaValue.windows([QuotaWindow(minutes: 300, usedPercent: 6, resetsAt: nil)])
        let live = QuotaDisplay.claude(nil).applyingClaude(.success(value), now: now)
        XCTAssertFalse(live.cached)
        let failed = live.applyingClaude(.failure(.rateLimited(600)), now: now.addingTimeInterval(300))
        XCTAssertEqual(failed.value, value)
        XCTAssertEqual(failed.observedAt, now)
        XCTAssertTrue(failed.cached)
        XCTAssertTrue(failed.liveFailed)
        XCTAssertFalse(failed.applyingClaude(.success(value), now: now.addingTimeInterval(600)).liveFailed)
    }

    func testKnownElectronEnvelopeDecryptsWithoutChangingSource() {
        let fixture = "djEwDbY1hae4DCdyUny/pcoJYX+HSF6u6k7NCmA4EXJECs5HOytJmVXx+u98H22BtUQi"
        let object = ClaudeQuota.decrypt(fixture, password: Data("fixture-password".utf8))
        XCTAssertEqual((object?["fixture"] as? [String: Any])?["token"] as? String, "fake-only")
        XCTAssertNil(ClaudeQuota.decrypt(fixture, password: Data("wrong-password".utf8)))
    }

    func testOlderLocalCacheCannotReplaceLastGoodLiveSnapshotAfterFailure() {
        let value = QuotaValue.windows([QuotaWindow(minutes: 10080, usedPercent: 95, resetsAt: nil)])
        let retained = QuotaDisplay.empty.applying(.success(value), now: now)
            .applying(.failure(.timedOut), now: now.addingTimeInterval(300))
        let old = CachedQuota(windows: [QuotaWindow(minutes: 10080, usedPercent: 94, resetsAt: nil)], observedAt: now.addingTimeInterval(-3600))
        XCTAssertEqual(QuotaDisplay.withCache(retained, old), retained)
    }

    func testUnknownOrCorruptEncryptedFormatIsRejected() {
        XCTAssertNil(ClaudeQuota.decrypt("not-base64", password: Data("test".utf8)))
        XCTAssertNil(ClaudeQuota.decrypt(Data("v11wrong".utf8).base64EncodedString(), password: Data("test".utf8)))
        XCTAssertNil(ClaudeQuota.decrypt(Data("v10wrong".utf8).base64EncodedString(), password: Data("test".utf8)))
    }
}
