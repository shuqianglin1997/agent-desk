import Foundation

/// Presentation order only; never writes to client data. Each account has its own ID list.
public final class SessionOrderStore {
    private let root: URL
    private var orders: [String: [String]] = [:]
    private var loaded = false
    private var file: URL { root.appendingPathComponent("session-order.json") }

    public init(root: URL) { self.root = root }

    public func load() throws {
        loaded = false
        orders = FileManager.default.fileExists(atPath: file.path)
            ? try JSONDecoder().decode([String: [String]].self, from: Data(contentsOf: file)) : [:]
        loaded = true
    }

    /// Ranked sessions first; new or unranked sessions keep their incoming recency order.
    public func ordered<T>(_ rows: [T], accountID: String, id: (T) -> String) -> [T] {
        var ranks: [String: Int] = [:]
        for (index, value) in (orders[accountID] ?? []).enumerated() where ranks[value] == nil { ranks[value] = index }
        return rows.enumerated().sorted {
            let a = ranks[id($0.element)] ?? Int.max, b = ranks[id($1.element)] ?? Int.max
            return a == b ? $0.offset < $1.offset : a < b
        }.map(\.element)
    }

    @discardableResult
    public func move(_ source: String, before target: String, accountID: String, currentIDs: [String]) throws -> Bool {
        guard loaded else { throw AccountError.notLoaded }
        guard source != target, currentIDs.contains(source), currentIDs.contains(target) else { return false }
        var ids: [String] = []
        for id in currentIDs + (orders[accountID] ?? []) where !ids.contains(id) { ids.append(id) }
        ids.removeAll { $0 == source }
        ids.insert(source, at: ids.firstIndex(of: target)!)
        var next = orders
        next[accountID] = ids
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(next).write(to: file, options: [.atomic])
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        orders = next
        return true
    }
}
