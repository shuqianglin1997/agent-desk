import Foundation

/// Finds the official desktop client and verifies its bundle ID so a same-named app cannot impersonate it.
public enum AppLocator {
    public static let bundleIDs: [AppKind: String] = [.codex: "com.openai.codex", .claude: "com.anthropic.claudefordesktop"]
    /// The Codex client now ships as ChatGPT.app; Codex.app is the legacy name.
    public static let bundleNames: [AppKind: [String]] = [.codex: ["ChatGPT.app", "Codex.app"], .claude: ["Claude.app"]]

    public static func searchRoots() -> [URL] {
        [URL(fileURLWithPath: "/Applications"),
         FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
    }

    public static func locate(_ app: AppKind, roots: [URL] = searchRoots()) -> URL? {
        for name in bundleNames[app] ?? [] {
            for root in roots {
                let url = root.appendingPathComponent(name)
                if bundleID(at: url) == bundleIDs[app] { return url }
            }
        }
        return nil
    }

    public static func missingMessage(_ app: AppKind) -> String {
        "找不到 \(app.displayName) 客户端（\(bundleNames[app]?.first ?? "")）"
    }

    static func bundleID(at app: URL) -> String? {
        guard let data = try? Data(contentsOf: app.appendingPathComponent("Contents/Info.plist")),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return nil }
        return plist["CFBundleIdentifier"] as? String
    }
}
