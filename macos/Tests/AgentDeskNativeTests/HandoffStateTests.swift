import XCTest
import AgentDeskNativeCore
@testable import AgentDeskNative

final class HandoffStateTests: XCTestCase {
    func testRestartRestoresPendingAndCancelPreservesGeneratedFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AccountStore(root: root, agentDeskProfiles: root.appendingPathComponent("missing"))
        let handoffs = HandoffStore(root: root)
        let pending = try handoffs.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "任务")
        let file = handoffs.preparedURL(for: pending)
        try "交接文档".write(to: file, atomically: true, encoding: .utf8)
        let model = AgentDeskNativeModel(store: store)
        XCTAssertEqual(model.pendingHandoff, pending)
        model.cancelHandoffPreparation()
        XCTAssertNil(model.pendingHandoff)
        XCTAssertNil(try handoffs.pendingPreparation())
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    }

    func testUnreadablePendingIsPreservedAndDoesNotBlockNewHandoffs() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AccountStore(root: root, agentDeskProfiles: root.appendingPathComponent("missing"))
        let handoffs = HandoffStore(root: root)
        _ = try handoffs.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "任务")
        try Data("bad state".utf8).write(to: handoffs.directory.appendingPathComponent("pending.json"))
        let model = AgentDeskNativeModel(store: store)
        XCTAssertNil(model.pendingHandoff)
        XCTAssertTrue(model.message?.contains("已保留备份") == true)
        let files = try FileManager.default.contentsOfDirectory(atPath: handoffs.directory.path)
        XCTAssertEqual(files.filter { $0.hasPrefix("pending-unreadable-") }.count, 1)
        XCTAssertNoThrow(try handoffs.prepare(sourceID: "s", targetID: "t", conversationID: "c", title: "重新准备"))
    }
}
