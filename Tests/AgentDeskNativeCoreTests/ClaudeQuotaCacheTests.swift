import XCTest
@testable import AgentDeskNativeCore

final class ClaudeQuotaCacheTests: XCTestCase {
    private var cleanup: [URL] = []
    override func tearDown() { cleanup.forEach { try? FileManager.default.removeItem(at: $0) } }

    // V8 serialization pieces: one-byte string, double, small integer.
    private func key(_ text: String) -> [UInt8] { [0x22, UInt8(text.utf8.count)] + Array(text.utf8) }
    private func double(_ value: Double) -> [UInt8] {
        [0x4E] + (0..<8).map { UInt8((value.bitPattern >> (8 * UInt64($0))) & 0xFF) }
    }

    /// Shaped like a real Claude Code rate_limit_event as the desktop client caches it.
    private func event(fiveHour: Double, weekly: Double, created: String) -> [UInt8] {
        var bytes = Array("xx".utf8) + key("rate_limit_info") + [0x6F] + key("rateLimitType") + key("seven_day")
        bytes += key("resetsAt") + double(1_791_543_600) + key("status") + key("allowed_warning")
        bytes += key("unifiedWindows") + [0x6F]
        bytes += key("five_hour") + [0x6F] + key("resetsAt") + double(1_791_477_600) + key("utilization") + double(fiveHour) + [0x7B, 0x02]
        bytes += key("seven_day") + [0x6F] + key("resetsAt") + double(1_791_543_600) + key("utilization") + double(weekly) + [0x7B, 0x02]
        bytes += [0x7B, 0x01] + key("utilization") + double(weekly) + [0x7B, 0x06]
        bytes += key("type") + key("rate_limit_event") + key("ccr_event") + [0x6F] + key("created_at") + key(created)
        return bytes
    }

    func testReadsNewestRateLimitEventWithResetTimes() throws {
        let bytes = event(fiveHour: 0.2, weekly: 0.5, created: "2026-10-08T12:16:06.529598Z")
            + event(fiveHour: 0.42, weekly: 0.84, created: "2026-10-08T13:08:35.003323Z")
            + event(fiveHour: 0.1, weekly: 0.4, created: "2026-10-08T11:00:00Z")
        let found = try XCTUnwrap(ClaudeQuotaCache.latestEvent(inValue: bytes))
        XCTAssertEqual(found.observedAt.timeIntervalSince1970, ISO8601.parse("2026-10-08T13:08:35Z")!.timeIntervalSince1970, accuracy: 1)
        XCTAssertEqual(found.windows.map(\.label), ["5h", "周"])
        XCTAssertEqual(found.windows[0].usedPercent, 42, accuracy: 0.001)
        XCTAssertEqual(found.windows[0].resetsAt, Date(timeIntervalSince1970: 1_791_477_600))
        XCTAssertEqual(found.windows[1].usedPercent, 84, accuracy: 0.001)
        XCTAssertEqual(found.windows[1].resetsAt, Date(timeIntervalSince1970: 1_791_543_600))
    }

    func testSmallIntegerUtilizationAndMissingDataAreHandled() {
        var bytes = event(fiveHour: 0.3, weekly: 0.6, created: "2026-10-08T13:00:00Z")
        // Replace the five-hour double with V8 small integer 0 (`I` + zigzag 0).
        let marker = key("utilization") + double(0.3)
        let range = bytes.firstRange(of: marker)!
        bytes.replaceSubrange(range, with: key("utilization") + [0x49, 0x00])
        XCTAssertEqual(ClaudeQuotaCache.latestEvent(inValue: bytes)?.windows.first?.usedPercent, 0)
        XCTAssertNil(ClaudeQuotaCache.latestEvent(inValue: Array("no events here".utf8)))
        XCTAssertNil(ClaudeQuotaCache.latestEvent(inValue: Array(event(fiveHour: 0.1, weekly: 0.2, created: "x").prefix(40))))
    }

    func testSnappyWrappedBlob() throws {
        // "abcdabcdabcd": literal "abcd" then a copy of 8 bytes at distance 4 (tag type 1: len 8 → (8-4)<<2, offset 4).
        let compressed: [UInt8] = [12, 3 << 2, 0x61, 0x62, 0x63, 0x64, (4 << 2) | 1, 4]
        XCTAssertEqual(Snappy.decompress(compressed, from: 0), Array("abcdabcdabcd".utf8))
        XCTAssertNil(Snappy.decompress([20, 3 << 2, 0x61], from: 0))

        // A wrapped blob holding only literals.
        let value = event(fiveHour: 0.5, weekly: 0.85, created: "2026-10-08T15:00:00Z")
        var literal: [UInt8] = []
        var length = value.count
        repeat { literal.append(UInt8(length & 0x7F) | (length >= 0x80 ? 0x80 : 0)); length >>= 7 } while length > 0
        literal += [61 << 2, UInt8((value.count - 1) & 0xFF), UInt8((value.count - 1) >> 8)] + value
        let found = try XCTUnwrap(ClaudeQuotaCache.latestEvent(inBlob: [0xFF, 0x11, 0x02] + literal))
        XCTAssertEqual(found.windows.last?.usedPercent ?? 0, 85, accuracy: 0.001)
    }

    func testHistoryDropsStaleFiveHourValueAndNewestSourceWins() throws {
        let dir = try makeTempDir(); cleanup.append(dir)
        let now = Date(timeIntervalSince1970: 1_791_450_000)
        let sixHoursAgo = (now.timeIntervalSince1970 - 6 * 3600) * 1000
        let history = #"{"version":2,"samples":[{"t":1,"org":null,"u":{"fh":1,"sd":1}},{"t":\#(sixHoursAgo),"org":"o","u":{"fh":76,"sd":55}}]}"#
        try history.write(to: dir.appendingPathComponent("plan-usage-history.json"), atomically: true, encoding: .utf8)
        let fromHistory = try XCTUnwrap(ClaudeQuotaCache.latest(dataDir: dir, now: now))
        XCTAssertEqual(fromHistory.windows.map(\.label), ["周"])
        XCTAssertEqual(fromHistory.windows.first?.usedPercent, 55)

        // A newer event in the IndexedDB blobs wins over the history sample.
        let blobs = dir.appendingPathComponent("IndexedDB/https_claude.ai_0.indexeddb.blob/4/00")
        try FileManager.default.createDirectory(at: blobs, withIntermediateDirectories: true)
        let created = ISO8601.string(now.addingTimeInterval(-3600))
        try Data(event(fiveHour: 0.42, weekly: 0.84, created: created)).write(to: blobs.appendingPathComponent("60"))
        let newest = try XCTUnwrap(ClaudeQuotaCache.latest(dataDir: dir, now: Date()))
        XCTAssertEqual(newest.windows.map(\.label), ["5h", "周"])
        XCTAssertEqual(newest.windows.last?.usedPercent ?? 0, 84, accuracy: 0.001)

        XCTAssertNil(ClaudeQuotaCache.latest(dataDir: dir.appendingPathComponent("missing"), now: now))
    }

    func testNewerHistoryRetainsSameCycleResetWithoutRevivingExpiredFiveHourUsage() throws {
        let dir = try makeTempDir(); cleanup.append(dir)
        let now = ISO8601.parse("2026-10-09T09:00:00Z")!
        let observed = ISO8601.parse("2026-10-09T03:12:43Z")!
        let history = #"{"samples":[{"t":\#(observed.timeIntervalSince1970 * 1000),"u":{"fh":8,"sd":94}}]}"#
        try history.write(to: dir.appendingPathComponent("plan-usage-history.json"), atomically: true, encoding: .utf8)
        let blobs = dir.appendingPathComponent("IndexedDB/https_claude.ai_0.indexeddb.blob")
        try FileManager.default.createDirectory(at: blobs, withIntermediateDirectories: true)
        try Data(event(fiveHour: 0.48, weekly: 0.92, created: "2026-10-08T19:22:23Z"))
            .write(to: blobs.appendingPathComponent("usage"))
        let combined = try XCTUnwrap(ClaudeQuotaCache.latest(dataDir: dir, now: now))
        XCTAssertEqual(combined.observedAt, observed)
        XCTAssertEqual(combined.windows.count, 1)
        XCTAssertEqual(combined.windows[0].usedPercent, 94)
        XCTAssertEqual(combined.windows[0].resetsAt, now.addingTimeInterval(7200))
    }

    func testResetFromPreviousCycleCannotBeAttachedToNewUsage() throws {
        let observed = Date(timeIntervalSince1970: 1_791_500_000)
        let newest = CachedQuota(windows: [QuotaWindow(minutes: 300, usedPercent: 8, resetsAt: nil)], observedAt: observed)
        for reset in [observed, observed.addingTimeInterval(-1), observed.addingTimeInterval(6 * 3600)] {
            let older = CachedQuota(windows: [QuotaWindow(minutes: 300, usedPercent: 90, resetsAt: reset)],
                                    observedAt: observed.addingTimeInterval(-3600))
            XCTAssertNil(ClaudeQuotaCache.combining([older, newest])?.windows.first?.resetsAt)
        }
    }
}
