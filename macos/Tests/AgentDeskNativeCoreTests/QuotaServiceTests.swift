import XCTest
@testable import AgentDeskNativeCore

final class QuotaServiceTests: XCTestCase {
    private let week = QuotaWindow(minutes: 10080, usedPercent: 34, resetsAt: nil)
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testCacheShowsUntilLiveArrivesAndNeverReplacesLive() {
        let cache = CachedQuota(windows: [week], observedAt: now.addingTimeInterval(-600))
        let shown = QuotaDisplay.withCache(nil, cache)
        XCTAssertEqual(shown, QuotaDisplay(value: .windows([week]), observedAt: cache.observedAt, cached: true, liveFailure: nil))
        XCTAssertNil(QuotaDisplay.withCache(nil, nil))

        let live = (shown ?? .empty).applying(.success(.unlimited("x")), now: now)
        XCTAssertEqual(live, QuotaDisplay(value: .unlimited("x"), observedAt: now, cached: false, liveFailure: nil))
        XCTAssertEqual(QuotaDisplay.withCache(live, cache), live)
    }

    func testNewerCacheBeatsOlderLive() {
        let live = QuotaDisplay.empty.applying(.success(.unlimited("x")), now: now.addingTimeInterval(-7200))
            .applying(.failure(.timedOut), now: now)
        let cache = CachedQuota(windows: [week], observedAt: now.addingTimeInterval(-60))
        let shown = QuotaDisplay.withCache(live, cache)
        XCTAssertEqual(shown, QuotaDisplay(value: .windows([week]), observedAt: cache.observedAt, cached: true,
                                           liveFailure: "查询超时（10 秒）"))
    }

    func testOlderCacheNeverReplacesNewerLive() {
        let live = QuotaDisplay.empty.applying(.success(.unlimited("x")), now: now)
        XCTAssertEqual(QuotaDisplay.withCache(live, CachedQuota(windows: [week], observedAt: now.addingTimeInterval(-60))), live)
        XCTAssertEqual(QuotaDisplay.withCache(live, CachedQuota(windows: [week], observedAt: now)), live)
    }

    func testFailedLiveQueryKeepsCacheAndSaysSo() {
        let cache = CachedQuota(windows: [week], observedAt: now.addingTimeInterval(-600))
        let failed = QuotaDisplay.withCache(nil, cache)!.applying(.failure(.timedOut), now: now)
        XCTAssertEqual(failed.value, .windows([week]))
        XCTAssertTrue(failed.cached)
        XCTAssertTrue(failed.liveFailed)
        XCTAssertEqual(failed.liveFailure, "查询超时（10 秒）")

        let nothing = QuotaDisplay.empty.applying(.failure(.notFound), now: now)
        XCTAssertNil(nothing.value)
        XCTAssertEqual(nothing.liveFailure, "找不到 Codex 命令行工具")
        // A later success clears the failure.
        XCTAssertFalse(nothing.applying(.success(.signedOut), now: now).liveFailed)
        // A cache read after a failure keeps the failure visible.
        XCTAssertTrue(QuotaDisplay.withCache(nothing, cache)!.liveFailed)
    }

    func testThrottleAllowsOneQueryPerAccountPerFiveMinutes() {
        var throttle = QuotaThrottle()
        XCTAssertTrue(throttle.allow("a", now: now))
        XCTAssertFalse(throttle.allow("a", now: now.addingTimeInterval(299)))
        XCTAssertTrue(throttle.allow("b", now: now.addingTimeInterval(10)))
        XCTAssertTrue(throttle.allow("a", now: now.addingTimeInterval(300)))
        XCTAssertFalse(throttle.allow("a", now: now.addingTimeInterval(301)))
        throttle.reset("a")
        XCTAssertTrue(throttle.allow("a", now: now.addingTimeInterval(302)))
    }
}
