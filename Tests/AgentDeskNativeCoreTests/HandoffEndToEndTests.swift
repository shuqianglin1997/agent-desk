import XCTest
@testable import AgentDeskNativeCore

final class HandoffEndToEndTests: XCTestCase {
    func testSelectedDocumentCopyLogAndClipboardPreserveBodyAndOriginal() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("owner-handoff.md")
        let body = "# 交接\n\n目录：/Users/test/project\n" + String(repeating: "已完成与下一步。", count: 1000) + "\n不要推送或部署。"
        try body.write(to: source, atomically: true, encoding: .utf8)
        let store = HandoffStore(root: root)
        let first = try store.copyDocument(source, fileName: "task.md")
        let second = try store.copyDocument(source, fileName: "task.md")
        XCTAssertNotEqual(first.url, second.url)
        XCTAssertEqual(try String(contentsOf: source, encoding: .utf8), body)
        XCTAssertEqual(try String(contentsOf: first.url, encoding: .utf8), body)
        let clipboard = HandoffDocument.clipboard(markdown: first.markdown, savedAt: first.url)
        XCTAssertTrue(clipboard.contains(first.url.standardizedFileURL.path))
        XCTAssertTrue(clipboard.hasSuffix(body))
        let entry = HandoffLogEntry(time: Date(), source: "Claude", target: "Codex", conversation: "metadata-only",
                                   method: "文档接力", result: "文档已准备，待粘贴发送", documentPath: first.url.path)
        try store.appendLog(entry)
        XCTAssertEqual(store.document(for: try XCTUnwrap(store.recentLog().first)), first.url)
        try store.removeLogEntry(id: entry.id)
        XCTAssertTrue(store.recentLog().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.url.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }

    func testInvalidOrEmptySelectedDocumentDoesNotProduceACopy() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = HandoffStore(root: root)
        let file = root.appendingPathComponent("empty.md")
        try " \n ".write(to: file, atomically: true, encoding: .utf8)
        XCTAssertThrowsError(try store.copyDocument(file, fileName: "copy.md"))
        try Data([0xff, 0xfe, 0xff]).write(to: file)
        XCTAssertThrowsError(try store.copyDocument(file, fileName: "copy.md"))
        XCTAssertThrowsError(try store.copyDocument(root, fileName: "copy.md"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory.path))
    }

    func testSelectedDocumentRedactionLeavesSourceUntouched() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("handoff.md")
        let body = "任务 sample@example.com\n下一步继续验证。"
        try body.write(to: source, atomically: true, encoding: .utf8)
        let saved = try HandoffStore(root: root).copyDocument(source, fileName: "copy.md")
        XCTAssertEqual(saved.markdown, "任务 [邮箱已隐藏]\n下一步继续验证。")
        XCTAssertEqual(try String(contentsOf: saved.url, encoding: .utf8), saved.markdown)
        XCTAssertEqual(try String(contentsOf: source, encoding: .utf8), body)
    }
}
