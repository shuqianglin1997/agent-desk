import XCTest
@testable import AgentDeskNativeCore

final class HandoffDocumentTests: XCTestCase {
    private var utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()
    private let at = ISO8601.parse("2026-10-08T09:05:00Z")!

    func testNamesAndRefusal() {
        XCTAssertEqual(HandoffDocument.fileName(title: "修/登录: a*b?", at: at, calendar: utc), "20261008-0905-修 登录  a b.md")
        XCTAssertEqual(HandoffDocument.fileName(title: "..隐藏", at: at, suffix: "-副本", calendar: utc), "20261008-0905-隐藏-副本.md")
        XCTAssertEqual(HandoffDocument.fileName(title: "  ", at: at, calendar: utc), "20261008-0905-对话.md")
        XCTAssertEqual(HandoffDocument.fileName(title: String(repeating: "长", count: 60), at: at, calendar: utc),
                       "20261008-0905-" + String(repeating: "长", count: 40) + ".md")
        XCTAssertEqual(HandoffDocument.clipboardPreamble, "这是从另一个账号接力过来的任务，请先阅读下面的交接文档，再检查当前 git 状态后继续。")
        XCTAssertNotNil(HandoffDocument.refusal(for: .running))
        XCTAssertNotNil(HandoffDocument.refusal(for: .waiting))
        for status: TaskStatus in [.completed, .failed, .interrupted, .unknown] { XCTAssertNil(HandoffDocument.refusal(for: status)) }
    }

    func testClipboardIncludesAbsoluteSavedPathAndBodyForClientsWithoutFileAccess() {
        let file = URL(fileURLWithPath: "/Users/test/Library/Application Support/AgentDeskNative/handoffs/交接.md")
        let body = "# 接力\n\n工作目录：/Users/test/project\n下一步：继续验证"
        let clipboard = HandoffDocument.clipboard(markdown: body, savedAt: file)
        XCTAssertTrue(clipboard.hasPrefix(HandoffDocument.clipboardPreamble))
        XCTAssertTrue(clipboard.contains(file.path))
        XCTAssertTrue(clipboard.hasSuffix(body))
        XCTAssertFalse(clipboard.contains("file://"))
    }

}
