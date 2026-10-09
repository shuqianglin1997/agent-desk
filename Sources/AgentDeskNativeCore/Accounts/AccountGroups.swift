import Foundation

/// Accounts grouped by client app for the panel. Group order is a user preference; account order is the store's.
public enum AccountGroups {
    public struct Group: Equatable {
        public let app: AppKind
        public let accounts: [Account]
    }

    /// Groups in `order`, then any app not in it by first appearance. Apps without accounts are left out.
    public static func ordered(_ accounts: [Account], order: [AppKind]) -> [Group] {
        let apps = complete(order, seen: accounts.map(\.app))
        return apps.compactMap { app in
            let members = accounts.filter { $0.app == app }
            return members.isEmpty ? nil : Group(app: app, accounts: members)
        }
    }

    /// Moves `app` to just before `target` (or to the end when nil).
    public static func move(_ app: AppKind, before target: AppKind?, in order: [AppKind]) -> [AppKind] {
        guard app != target else { return complete(order, seen: []) }
        var apps = complete(order, seen: []).filter { $0 != app }
        if let target, let index = apps.firstIndex(of: target) { apps.insert(app, at: index) } else { apps.append(app) }
        return apps
    }

    private static func complete(_ order: [AppKind], seen: [AppKind]) -> [AppKind] {
        var apps: [AppKind] = []
        for app in order + seen + AppKind.allCases where !apps.contains(app) { apps.append(app) }
        return apps
    }
}
