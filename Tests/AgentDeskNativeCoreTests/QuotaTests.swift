import XCTest
@testable import AgentDeskNativeCore

func json(_ text: String) -> [String: Any] {
    try! JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
}

final class QuotaTests: XCTestCase {
    func testWindowsAreNamedByLengthNotByPrimaryOrSecondary() {
        // Omnix (T3): the only window is the weekly one, reported as primary.
        let omnix = QuotaParser.windows(json("""
            {"primary":{"usedPercent":34,"windowDurationMins":10080,"resetsAt":1791960941},"secondary":null,"planType":"prolite"}
            """))
        XCTAssertEqual(omnix, [QuotaWindow(minutes: 10080, usedPercent: 34, resetsAt: Date(timeIntervalSince1970: 1791960941))])
        XCTAssertEqual(omnix.first?.label, "周")
        // Rollout events use snake_case; windows come out shortest first.
        let nux = QuotaParser.windows(json("""
            {"limit_id":"codex","secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":1790000000},
             "primary":{"used_percent":16.0,"window_minutes":300,"resets_at":1789000000},"plan_type":"unknown"}
            """))
        XCTAssertEqual(nux.map(\.label), ["5h", "周"])
        XCTAssertEqual(nux.map(\.usedPercent), [16, 41])
        XCTAssertEqual(QuotaParser.planType(json(#"{"plan_type":"edu"}"#)), "edu")
        XCTAssertEqual(QuotaParser.windows(nil), [])
        XCTAssertEqual(QuotaParser.windows(json(#"{"primary":null,"secondary":null}"#)), [])
    }

    func testInvalidWindowMinutesAreDropped() {
        for minutes in ["0", "-300", "1e30"] {
            let bucket = json("""
                {"primary":{"usedPercent":10,"windowDurationMins":\(minutes)},"secondary":null}
                """)
            XCTAssertEqual(QuotaParser.windows(bucket), [], "minutes \(minutes)")
        }
    }

    func testWindowLabelsClampAndReset() {
        XCTAssertEqual(QuotaWindow(minutes: 1440, usedPercent: 0, resetsAt: nil).label, "1天")
        XCTAssertEqual(QuotaWindow(minutes: 120, usedPercent: 0, resetsAt: nil).label, "2h")
        XCTAssertEqual(QuotaWindow(minutes: 45, usedPercent: 0, resetsAt: nil).label, "45分")
        XCTAssertEqual(QuotaWindow(minutes: 300, usedPercent: 140, resetsAt: nil).usedPercent, 100)
        XCTAssertEqual(QuotaWindow(minutes: 300, usedPercent: -3, resetsAt: nil).usedPercent, 0)
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(QuotaWindow(minutes: 300, usedPercent: 50, resetsAt: Date(timeIntervalSince1970: 999)).hasReset(now: now))
        XCTAssertFalse(QuotaWindow(minutes: 300, usedPercent: 50, resetsAt: Date(timeIntervalSince1970: 1_001)).hasReset(now: now))
        XCTAssertFalse(QuotaWindow(minutes: 300, usedPercent: 50, resetsAt: nil).hasReset(now: now))
    }

    func testClassifyLiveAnswers() {
        let nuxLimits = json("""
            {"rateLimits":{"primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":1},
                           "secondary":{"usedPercent":12,"windowDurationMins":10080,"resetsAt":2}},
             "rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":1}}}}
            """)
        let chatgpt = json(#"{"account":{"type":"chatgpt","planType":"edu"},"requiresOpenaiAuth":true}"#)
        guard case .windows(let windows)? = QuotaParser.classify(accountResult: chatgpt, rateLimits: nuxLimits) else {
            return XCTFail("应返回窗口")
        }
        XCTAssertEqual(windows.map(\.label), ["5h", "周"])   // rateLimits wins; ByLimitId is not added again

        let byID = json(#"{"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":5,"windowDurationMins":300,"resetsAt":1}}}}"#)
        XCTAssertEqual(QuotaParser.classify(accountResult: chatgpt, rateLimits: byID),
                       .windows([QuotaWindow(minutes: 300, usedPercent: 5, resetsAt: Date(timeIntervalSince1970: 1))]))

        // API-key account (T3): API key account, rate-limit read failed.
        let apiKey = json(#"{"account":{"type":"apiKey"},"requiresOpenaiAuth":true}"#)
        guard case .unlimited? = QuotaParser.classify(accountResult: apiKey, rateLimits: nil) else { return XCTFail("API Key 应为不限") }

        let enterprise = json(#"{"account":{"type":"chatgpt","planType":"enterprise"}}"#)
        guard case .unlimited? = QuotaParser.classify(accountResult: enterprise, rateLimits: json("{}")) else { return XCTFail("企业套餐应为不限") }
        let team = json(#"{"account":{"type":"chatgpt","planType":"team"}}"#)
        guard case .unlimited? = QuotaParser.classify(accountResult: team, rateLimits: json("{}")) else { return XCTFail("团队套餐应为不限") }

        XCTAssertEqual(QuotaParser.classify(accountResult: json(#"{"account":null,"requiresOpenaiAuth":true}"#), rateLimits: nil), .signedOut)
        XCTAssertEqual(QuotaParser.classify(accountResult: chatgpt, rateLimits: json("{}")), .noData)
        // A ChatGPT account whose rate-limit read failed, or an account read that failed: not trustworthy.
        XCTAssertNil(QuotaParser.classify(accountResult: chatgpt, rateLimits: nil))
        XCTAssertNil(QuotaParser.classify(accountResult: nil, rateLimits: json("{}")))
    }

    func testFormat() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(QuotaFormat.age(now.addingTimeInterval(-30), now: now), "刚刚")
        XCTAssertEqual(QuotaFormat.age(now.addingTimeInterval(-12 * 60), now: now), "12 分钟前")
        XCTAssertEqual(QuotaFormat.age(now.addingTimeInterval(-3 * 3600), now: now), "3 小时前")
        XCTAssertEqual(QuotaFormat.age(now.addingTimeInterval(-2 * 86400), now: now), "2 天前")
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let base = ISO8601.parse("2026-10-08T10:00:00Z")!
        XCTAssertEqual(QuotaFormat.reset(ISO8601.parse("2026-10-08T15:40:00Z")!, now: base, calendar: utc), "15:40")
        XCTAssertEqual(QuotaFormat.reset(ISO8601.parse("2026-10-12T01:00:00Z")!, now: base, calendar: utc), "10/12")
    }

    func testResetCountdownUsesRemainingDurationAcrossMidnightAndUpdatesAtReset() {
        var singapore = Calendar(identifier: .gregorian)
        singapore.timeZone = TimeZone(identifier: "Asia/Singapore")!
        // 23:00 locally: a reset on the following calendar day still gets a countdown.
        let now = ISO8601.parse("2026-10-09T15:00:00Z")!
        let reset = now.addingTimeInterval(73 * 60)
        XCTAssertEqual(QuotaFormat.resetCountdown(reset, now: now, calendar: singapore), "1小时13分后重置")
        XCTAssertEqual(QuotaFormat.resetCountdown(reset, now: reset.addingTimeInterval(-3600), calendar: singapore), "1小时后重置")
        XCTAssertEqual(QuotaFormat.resetCountdown(reset, now: reset.addingTimeInterval(-60), calendar: singapore), "1分钟后重置")
        XCTAssertEqual(QuotaFormat.resetCountdown(reset, now: reset.addingTimeInterval(-30), calendar: singapore), "不到1分钟后重置")
        XCTAssertEqual(QuotaFormat.resetCountdown(reset, now: reset, calendar: singapore), "已重置")
        XCTAssertEqual(QuotaFormat.resetCountdown(reset, now: reset.addingTimeInterval(1), calendar: singapore), "已重置")
    }

    func testResetCountdownSwitchesAt24HoursAndUsesLocalWeekdayAndTime() {
        var singapore = Calendar(identifier: .gregorian)
        singapore.timeZone = TimeZone(identifier: "Asia/Singapore")!
        let now = ISO8601.parse("2026-10-09T15:00:00Z")!
        XCTAssertEqual(QuotaFormat.resetCountdown(now.addingTimeInterval(86400 - 1), now: now, calendar: singapore), "23小时59分后重置")
        XCTAssertEqual(QuotaFormat.resetCountdown(now.addingTimeInterval(86400), now: now, calendar: singapore), "周六 23:00 重置")
        // Sunday in Singapore while it is still Saturday in UTC.
        XCTAssertEqual(QuotaFormat.resetCountdown(ISO8601.parse("2026-10-10T16:15:00Z")!, now: now, calendar: singapore), "周日 00:15 重置")
        XCTAssertEqual(QuotaFormat.resetTimestamp(ISO8601.parse("2026-10-10T16:15:42Z")!, calendar: singapore), "2026-10-11 星期日 00:15:42 +08:00")
    }

    func testCacheReadsNewestTokenCountWithWindows() throws {
        let dir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let older = dir.appendingPathComponent("older.jsonl")
        try """
            partial line from the middle of a file
            {"timestamp":"2026-09-21T03:04:05.678Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":16.0,"window_minutes":300,"resets_at":1789000000},"secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":1790000000},"plan_type":"unknown"}}}
            {"timestamp":"2026-09-21T03:05:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":null,"secondary":null}}}
            {"timestamp":"2026-09-21T03:06:00.000Z","type":"event_msg","payload":{"type":"agent_message","message":"token_count"}}
            """.write(to: older, atomically: true, encoding: .utf8)
        let newest = dir.appendingPathComponent("newest.jsonl")
        try #"{"timestamp":"2026-09-22T00:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"t"}}"#
            .write(to: newest, atomically: true, encoding: .utf8)

        let cached = QuotaCache.latest(rollouts: [newest.path, dir.appendingPathComponent("missing.jsonl").path, older.path])
        XCTAssertEqual(cached?.windows.map(\.label), ["5h", "周"])
        XCTAssertEqual(cached?.windows.map(\.usedPercent), [16, 41])
        XCTAssertEqual(cached?.observedAt, ISO8601.parse("2026-09-21T03:04:05.678Z"))
        XCTAssertNil(QuotaCache.latest(rollouts: [newest.path]))
        XCTAssertNil(QuotaCache.latest(rollouts: []))
    }
}
