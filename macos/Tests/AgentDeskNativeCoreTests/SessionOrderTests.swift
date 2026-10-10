import XCTest
@testable import AgentDeskNativeCore

final class SessionOrderTests: XCTestCase {
    func testReorderPersistsPerAccountAndKeepsNewSessions() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = SessionOrderStore(root: root)
        try store.load()
        XCTAssertTrue(try store.move("c", before: "a", accountID: "one", currentIDs: ["a", "b", "c"]))
        let restored = SessionOrderStore(root: root)
        try restored.load()
        XCTAssertEqual(restored.ordered(["a", "b", "c", "new"], accountID: "one", id: { $0 }), ["c", "a", "b", "new"])
        XCTAssertEqual(restored.ordered(["a", "b", "c"], accountID: "two", id: { $0 }), ["a", "b", "c"])
        XCTAssertEqual(restored.ordered(["b", "c"], accountID: "one", id: { $0 }), ["c", "b"])
        XCTAssertFalse(try restored.move("foreign", before: "a", accountID: "one", currentIDs: ["a", "b"]))
        XCTAssertFalse(try restored.move("a", before: "foreign", accountID: "one", currentIDs: ["a", "b"]))
        let attrs = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent("session-order.json").path)
        XCTAssertEqual((attrs[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }

    func testBadStateIsNotOverwrittenAndFailedSaveKeepsPreviousOrder() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("session-order.json")
        try Data("bad".utf8).write(to: file)
        let store = SessionOrderStore(root: root)
        XCTAssertThrowsError(try store.load())
        XCTAssertThrowsError(try store.move("b", before: "a", accountID: "one", currentIDs: ["a", "b"]))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "bad")
        try FileManager.default.removeItem(at: file)
        try store.load()
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        XCTAssertThrowsError(try store.move("b", before: "a", accountID: "one", currentIDs: ["a", "b"]))
        XCTAssertEqual(store.ordered(["a", "b"], accountID: "one", id: { $0 }), ["a", "b"])
    }
}
