import XCTest
@testable import AgentDeskNativeCore

final class HandoffStoreTests: XCTestCase {
    private var cleanup: [URL] = []
    override func tearDown() { cleanup.forEach { try? FileManager.default.removeItem(at: $0) } }

    private func permissions(_ url: URL) throws -> Int {
        (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue ?? -1
    }

    func testSaveIsPrivateAndNeverOverwrites() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        XCTAssertEqual(store.directory, root.appendingPathComponent("handoffs"))
        let first = try store.save("一", fileName: "20261008-0905-t.md")
        let second = try store.save("二", fileName: "20261008-0905-t.md")
        XCTAssertEqual(first.lastPathComponent, "20261008-0905-t.md")
        XCTAssertEqual(second.lastPathComponent, "20261008-0905-t-2.md")
        XCTAssertEqual(try String(contentsOf: first, encoding: .utf8), "一")
        XCTAssertEqual(try permissions(first), 0o600)
        XCTAssertEqual(try permissions(store.directory), 0o700)
    }

    func testLogAppendsAndListsNewestFirst() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        XCTAssertEqual(store.recentLog(), [])
        let entries = (0..<25).map { index in
            HandoffLogEntry(time: Date(timeIntervalSince1970: 1_800_000_000 + Double(index)), source: "Omnix", target: "Nux",
                            conversation: "id-\(index)", method: "本地提取", result: "已交付")
        }
        try entries.forEach { try store.appendLog($0) }
        let recent = store.recentLog()
        XCTAssertEqual(recent.count, 20)
        XCTAssertEqual(recent.first, entries[24])
        XCTAssertEqual(recent.last, entries[5])
        XCTAssertEqual(try permissions(store.directory.appendingPathComponent("log.jsonl")), 0o600)
    }

    func testSaveRejectsPathLikeFileNames() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        for name in ["a/b.md", "/abs.md", ".", "..", "../escape.md", "..hidden.md", ""] {
            XCTAssertThrowsError(try store.save("x", fileName: name), name)
        }
        let leftovers = (try? FileManager.default.contentsOfDirectory(atPath: store.directory.path)) ?? []
        XCTAssertEqual(leftovers, [])
    }

    func testSaveSkipsExistingCandidates() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        _ = try store.save("1", fileName: "t.md")
        try "taken".write(to: store.directory.appendingPathComponent("t-2.md"), atomically: true, encoding: .utf8)
        let third = try store.save("3", fileName: "t.md")
        XCTAssertEqual(third.lastPathComponent, "t-3.md")
        XCTAssertEqual(try String(contentsOf: store.directory.appendingPathComponent("t-2.md"), encoding: .utf8), "taken")
    }

    func testSavedDocumentsHideEmailAddresses() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        let saved = try store.save("用户 sample@example.com 的任务", fileName: "local.md")
        XCTAssertEqual(try String(contentsOf: saved, encoding: .utf8), "用户 [邮箱已隐藏] 的任务")

    }

    func testLegacyLogIDsAreStableAndSelectedDeletionPreservesFilesAndUnknownLines() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        let file = try store.save("document", fileName: "handoff.md")
        let legacy = #"{"time":"2026-10-09T06:43:00Z","source":"Claude","target":"Omnix","conversation":"old-id","method":"原 AI 撰写","result":"已交付"}"#
        let log = store.directory.appendingPathComponent("log.jsonl")
        try (legacy + "\nunknown future format\n").write(to: log, atomically: true, encoding: .utf8)
        let old = try XCTUnwrap(store.recentLog().first)
        XCTAssertEqual(old.id, store.recentLog().first?.id)
        XCTAssertNil(old.documentPath)
        let latest = HandoffLogEntry(time: Date(timeIntervalSince1970: 1_800_000_000), source: "Nux", target: "Omnix", conversation: "new-id",
                                     method: "本地提取", result: "文档已准备", documentPath: file.path)
        try store.appendLog(latest)
        XCTAssertEqual(store.document(for: latest), file)
        try store.removeLogEntry(id: old.id)
        XCTAssertEqual(store.recentLog(), [latest])
        XCTAssertTrue(try String(contentsOf: log, encoding: .utf8).contains("unknown future format"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        XCTAssertEqual(try permissions(log), 0o600)
        try store.removeLogEntry(id: latest.id)
        XCTAssertEqual(store.recentLog(), [])
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    }

    func testLegacyDocumentResolutionRejectsAmbiguousMatchesAndOutsidePaths() throws {
        let root = try makeTempDir(); cleanup.append(root)
        let store = HandoffStore(root: root)
        let now = Date()
        let first = try store.save("one", fileName: HandoffDocument.fileName(title: "one", at: now))
        let legacy = HandoffLogEntry(time: now, source: "Nux", target: "Omnix", conversation: "id",
                                     method: "本地提取", result: "已交付")
        XCTAssertEqual(store.document(for: legacy)?.resolvingSymlinksInPath().path, first.resolvingSymlinksInPath().path)
        _ = try store.save("two", fileName: HandoffDocument.fileName(title: "two", at: now))
        XCTAssertNil(store.document(for: legacy))
        let outside = root.appendingPathComponent("outside.md")
        try "other".write(to: outside, atomically: true, encoding: .utf8)
        let invalid = HandoffLogEntry(time: now, source: "Nux", target: "Omnix", conversation: "id",
                                      method: "本地提取", result: "已交付", documentPath: outside.path)
        XCTAssertNil(store.document(for: invalid))
    }

}
