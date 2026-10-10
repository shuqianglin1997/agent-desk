import XCTest
import AgentDeskNativeCore
@testable import AgentDeskNative

final class LaunchCompletionTests: XCTestCase {
    func testConcurrentLaunchRequestsAllReceiveTheOneOutcome() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("desk-launch-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = AccountStore(root: root, agentDeskProfiles: root.appendingPathComponent("missing"))
        try store.load()
        let account = try store.create(name: "测试", app: .codex)
        var activations = 0
        let launcher = Launcher(activate: { _ in activations += 1; return true }, processes: {
            [RunningProcess(pid: 42, args: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=\(account.profilePath)")]
        })
        let model = AgentDeskNativeModel(store: store, launcher: launcher, notificationSender: { _, _, reply in reply(true) })
        let done = expectation(description: "both requesters finish")
        done.expectedFulfillmentCount = 2
        for _ in 0..<2 {
            model.launch(account) { outcome in
                XCTAssertEqual(outcome, .activated(pid: 42))
                done.fulfill()
            }
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(activations, 1)
    }
}
