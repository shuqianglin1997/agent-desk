import XCTest
import AgentDeskNativeCore
@testable import AgentDeskNative

final class NotificationFeedbackTests: XCTestCase {
    private func model(lifetime: TimeInterval = 0.05, delivered: Bool) -> AgentDeskNativeModel {
        let unused = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AccountStore(root: unused, agentDeskProfiles: unused.appendingPathComponent("missing"))
        return AgentDeskNativeModel(store: store, feedbackLifetime: lifetime, notificationSender: { _, _, reply in reply(delivered) })
    }

    private func after(_ seconds: TimeInterval, _ check: @escaping () -> Void) {
        let done = expectation(description: "feedback state")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { check(); done.fulfill() }
        wait(for: [done], timeout: 2)
    }

    func testDeliveredEventDoesNotLeavePanelMessage() {
        let model = model(delivered: true)
        model.notify(title: "接力完成", body: "交接文件已收到")
        after(0.01) { XCTAssertNil(model.message) }
    }

    func testDeniedBackgroundNotificationWaitsForPanelThenExpires() {
        let model = model(delivered: false)
        model.notify(title: "接力完成", body: "交接文件已收到")
        after(0.1) { XCTAssertEqual(model.message, "接力完成：交接文件已收到") }
        model.panelOpened()
        after(0.1) { XCTAssertNil(model.message) }
    }

    func testNewFeedbackGetsItsOwnLifetimeAndCanBeDismissed() {
        let model = model(lifetime: 0.15, delivered: false)
        model.panelOpened()
        model.message = "旧提示"
        after(0.1) { model.message = "新提示" }
        after(0.1) { XCTAssertEqual(model.message, "新提示") }
        model.dismissMessage()
        XCTAssertNil(model.message)
    }

    func testClosingPanelClearsSeenFeedbackButPreservesLaterEvents() {
        let model = model(delivered: false)
        model.panelOpened()
        model.message = "已看到的提示"
        model.panelClosed()
        XCTAssertNil(model.message)
        model.notify(title: "稍后完成", body: "新事件")
        after(0.1) { XCTAssertEqual(model.message, "稍后完成：新事件") }
    }

    func testOlderAuthorizationCallbackCannotOverwriteCompletion() {
        let unused = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = AccountStore(root: unused, agentDeskProfiles: unused.appendingPathComponent("missing"))
        var replies: [(Bool) -> Void] = []
        let model = AgentDeskNativeModel(store: store, notificationSender: { _, _, reply in replies.append(reply) })
        model.notify(title: "提示词已复制", body: "等待文件")
        model.notify(title: "文件已收到", body: "交接完成")
        replies[1](false)
        after(0.01) { XCTAssertEqual(model.message, "文件已收到：交接完成") }
        replies[0](false)
        after(0.01) { XCTAssertEqual(model.message, "文件已收到：交接完成") }
    }
}
