import XCTest
@testable import AgentDeskNativeCore

final class HandoffPreparationTests: XCTestCase {
    func testPrepareRestoresStateWithoutCreatingAPlaceholderDocument() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = HandoffStore(root: root)
        let pending = try store.prepare(sourceID: "source", targetID: "target", conversationID: "thread", title: "任务")
        let file = store.preparedURL(for: pending)
        XCTAssertTrue(file.path.hasPrefix(root.path + "/handoffs/drafts/"))
        XCTAssertEqual(file.lastPathComponent, "handoff.md")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertEqual(try HandoffStore(root: root).pendingPreparation(), pending)
        XCTAssertThrowsError(try store.prepare(sourceID: "other", targetID: "target", conversationID: "thread", title: "另一个"))
        let attributes = try FileManager.default.attributesOfItem(atPath: file.deletingLastPathComponent().path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o700)
        let state = store.directory.appendingPathComponent("pending.json")
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: state.path)[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }

    func testMissingEmptyAndInvalidDocumentRemainPendingForRetry() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = HandoffStore(root: root)
        let pending = try store.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "任务")
        XCTAssertThrowsError(try store.copyPreparedDocument(pending)) { error in
            XCTAssertTrue(error.localizedDescription.contains("尚未生成"))
        }
        let file = store.preparedURL(for: pending)
        try " \n".write(to: file, atomically: true, encoding: .utf8)
        XCTAssertThrowsError(try store.copyPreparedDocument(pending))
        try Data([0xff, 0xfe]).write(to: file)
        XCTAssertThrowsError(try store.copyPreparedDocument(pending))
        XCTAssertEqual(try store.pendingPreparation(), pending)
        XCTAssertTrue(store.recentLog().isEmpty)
    }

    func testGeneratedDocumentUsesExactPathAndCopiesFullBodyWithoutOverwriting() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = HandoffStore(root: root)
        let pending = try store.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "任务")
        let body = "# 交接\n目标、约束和下一步。\n" + String(repeating: "必要信息。", count: 1000)
        let file = store.preparedURL(for: pending)
        try body.write(to: file, atomically: true, encoding: .utf8)
        let copy = try store.copyPreparedDocument(pending)
        XCTAssertNotEqual(copy.url, file)
        XCTAssertEqual(copy.markdown, body)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), body)
        XCTAssertEqual(try store.pendingPreparation(), pending, "目标打开成功前不能清除待接力状态")
        let wrongID = UUID()
        try store.clearPreparation(id: wrongID)
        XCTAssertNotNil(try store.pendingPreparation())
        try store.clearPreparation(id: pending.id)
        XCTAssertNil(try store.pendingPreparation())
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: copy.url.path))
    }

    func testPreparedFileCannotBeASymlink() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = HandoffStore(root: root)
        let pending = try store.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "任务")
        let outside = root.appendingPathComponent("other.md")
        try "不应读取".write(to: outside, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(at: store.preparedURL(for: pending), withDestinationURL: outside)
        XCTAssertThrowsError(try store.copyPreparedDocument(pending))
    }

    func testUnreadableStateCanBeArchivedWithoutDeletingDocuments() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = HandoffStore(root: root)
        let pending = try store.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "任务")
        let file = store.preparedURL(for: pending)
        try "交接正文".write(to: file, atomically: true, encoding: .utf8)
        let bad = Data("broken record".utf8)
        try bad.write(to: store.directory.appendingPathComponent("pending.json"))
        XCTAssertThrowsError(try store.pendingPreparation())
        let backup = try store.archivePreparationState()
        XCTAssertEqual(try Data(contentsOf: backup), bad)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        XCTAssertNil(try store.pendingPreparation())
        XCTAssertNoThrow(try store.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "重新准备"))
    }

    func testPromptIsPortableAndIncludesEssentialContextWithoutTranscriptExtraction() {
        let file = URL(fileURLWithPath: "/Users/test/Library/Application Support/AgentDeskNative/handoffs/drafts/id/handoff.md")
        let prompt = HandoffDocument.preparationPrompt(savedAt: file)
        XCTAssertTrue(prompt.contains(file.path))
        for essential in ["最新用户要求", "已授权范围", "未验证项", "未提交改动", "真实阻塞", "未确认", "无法写文件"] {
            XCTAssertTrue(prompt.contains(essential), essential)
        }
        XCTAssertFalse(prompt.contains("file://"))
        XCTAssertLessThan(prompt.count, 900)
    }
}
