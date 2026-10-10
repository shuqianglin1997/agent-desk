import Foundation

public enum AccountError: LocalizedError, Equatable {
    case emptyName, notFound, notLoaded, alreadyAdded, importFailed(String)
    public var errorDescription: String? {
        switch self {
        case .emptyName: return "名称不能为空"
        case .notFound: return "找不到这个账号"
        case .notLoaded: return "账号列表尚未成功读取，已停止写入以免覆盖"
        case .alreadyAdded: return "已经有账号在使用这份数据"
        case .importFailed(let detail): return "无法读取 agent-desk 的账号列表：\(detail)"
        }
    }
}

struct AccountFile: Codable {
    var version = 1
    var accounts: [Account]
    var skippedImports: [String]
}

/// Account slots stored in `<root>/accounts.json` (mode 0600). Imports agent-desk slots on first load.
public final class AccountStore {
    public let root: URL
    public let agentDeskProfiles: URL
    /// Home directory used to find clients' default data; injectable for tests.
    public let home: String
    public private(set) var accounts: [Account] = []
    public private(set) var skippedImports: [String] = []
    /// Set once `load()` succeeds; `save()` refuses to run before that so a failed read never overwrites accounts.json.
    private var loaded = false
    public var fileURL: URL { root.appendingPathComponent("accounts.json") }

    public init(root: URL, agentDeskProfiles: URL, home: String = NSHomeDirectory()) {
        self.root = root
        self.agentDeskProfiles = agentDeskProfiles
        self.home = home
    }

    public static func standard() -> AccountStore {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return AccountStore(root: support.appendingPathComponent("AgentDeskNative"),
                            agentDeskProfiles: support.appendingPathComponent("AgentDesk/profiles.json"))
    }

    public func load() throws {
        if FileManager.default.fileExists(atPath: fileURL.path) {
            let file = try Self.decoder.decode(AccountFile.self, from: Data(contentsOf: fileURL))
            accounts = file.accounts
            skippedImports = file.skippedImports
            loaded = true
        } else {
            (accounts, skippedImports) = try Self.importAgentDesk(agentDeskProfiles)
            loaded = true
            try save()
        }
    }

    public func create(name: String, app: AppKind, now: Date = Date()) throws -> Account {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw AccountError.emptyName }
        let id = UUID().uuidString.lowercased()
        let profile = root.appendingPathComponent("Profiles/\(app.displayName)/\(Self.folderName(trimmed))-\(id.prefix(8))")
        let session = app == .codex ? profile.appendingPathComponent("codex-home") : profile
        let fm = FileManager.default
        try fm.createDirectory(at: session, withIntermediateDirectories: true)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: profile.path)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: session.path)
        let account = Account(id: id, name: trimmed, app: app, profilePath: profile.path,
                              sessionRoot: session.path, createdAt: now, lastLaunchedAt: nil)
        accounts.append(account)
        try save()
        return account
    }

    public func rename(id: String, to name: String) throws {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw AccountError.emptyName }
        try update(id) { $0.name = trimmed }
    }

    public func relocate(id: String, profilePath: String) throws {
        try update(id) {
            $0.profilePath = profilePath
            $0.sessionRoot = $0.app.sessionRoot(forProfile: profilePath, home: home)
        }
    }

    /// Points an account at its client's default data (the instance opened from the Dock). Nothing is moved.
    public func useDefaultData(id: String) throws {
        guard let account = accounts.first(where: { $0.id == id }) else { throw AccountError.notFound }
        let path = account.app.defaultProfilePath(home: home)
        if accounts.contains(where: { $0.id != id && $0.profilePath == path }) { throw AccountError.alreadyAdded }
        try relocate(id: id, profilePath: path)
    }

    /// Adds an account for a client's default data without creating any directory.
    @discardableResult
    public func addDefault(app: AppKind, name: String, now: Date = Date()) throws -> Account {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw AccountError.emptyName }
        let path = app.defaultProfilePath(home: home)
        guard !accounts.contains(where: { $0.profilePath == path }) else { throw AccountError.alreadyAdded }
        let account = Account(id: UUID().uuidString.lowercased(), name: trimmed, app: app, profilePath: path,
                              sessionRoot: app.defaultSessionRoot(home: home), createdAt: now, lastLaunchedAt: nil)
        accounts.append(account)
        try save()
        return account
    }

    public func isDefaultData(_ account: Account) -> Bool {
        account.profilePath == account.app.defaultProfilePath(home: home)
    }

    /// Clients that have been used normally (their default data exists) but no account points at that data.
    public func unclaimedDefaults() -> [AppKind] {
        AppKind.allCases.filter { app in
            let path = app.defaultProfilePath(home: home)
            return FileManager.default.fileExists(atPath: path) && !accounts.contains { $0.profilePath == path }
        }
    }

    public func markLaunched(id: String, at date: Date) throws {
        try update(id) { $0.lastLaunchedAt = date }
    }

    /// Removes the slot. Data goes to the Trash only when asked; it is never deleted permanently.
    public func delete(id: String, moveDataToTrash: Bool) throws {
        guard let index = accounts.firstIndex(where: { $0.id == id }) else { throw AccountError.notFound }
        let account = accounts.remove(at: index)
        try save()
        // The client's own default data is what the Dock instance uses; deleting the account only forgets it.
        if moveDataToTrash, !isDefaultData(account), FileManager.default.fileExists(atPath: account.profilePath) {
            try FileManager.default.trashItem(at: URL(fileURLWithPath: account.profilePath), resultingItemURL: nil)
        }
    }

    /// Moves an account to just before another one (or to the end when `target` is nil). Order is saved.
    public func move(id: String, before target: String?) throws {
        guard let from = accounts.firstIndex(where: { $0.id == id }) else { throw AccountError.notFound }
        guard id != target else { return }
        let account = accounts.remove(at: from)
        if let target {
            guard let to = accounts.firstIndex(where: { $0.id == target }) else {
                accounts.insert(account, at: from); throw AccountError.notFound
            }
            accounts.insert(account, at: to)
        } else {
            accounts.append(account)
        }
        try save()
    }

    private func update(_ id: String, _ change: (inout Account) -> Void) throws {
        guard let index = accounts.firstIndex(where: { $0.id == id }) else { throw AccountError.notFound }
        change(&accounts[index])
        try save()
    }

    func save() throws {
        guard loaded else { throw AccountError.notLoaded }
        let fm = FileManager.default
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        let data = try Self.encoder.encode(AccountFile(accounts: accounts, skippedImports: skippedImports))
        try data.write(to: fileURL, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    static func importAgentDesk(_ url: URL) throws -> ([Account], [String]) {
        // If file doesn't exist, return empty import
        guard FileManager.default.fileExists(atPath: url.path) else { return ([], []) }

        // File exists but may not be readable/parseable - throw on any error
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw AccountError.importFailed("无法读取文件：\(error.localizedDescription)")
        }

        let json: [String: Any]
        do {
            guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw AccountError.importFailed("JSON 根元素不是对象")
            }
            json = obj
        } catch let error as AccountError {
            throw error
        } catch {
            throw AccountError.importFailed("无效的 JSON：\(error.localizedDescription)")
        }

        guard let profiles = json["profiles"] as? [[String: Any]] else {
            throw AccountError.importFailed("缺少 profiles 数组")
        }

        var accounts: [Account] = [], skipped: [String] = []
        for profile in profiles {
            let name = profile["name"] as? String ?? "未命名"
            let raw = profile["appId"] as? String ?? "?"
            guard let app = AppKind(rawValue: raw),
                  let id = profile["id"] as? String,
                  let profilePath = profile["profilePath"] as? String,
                  let sessionRoot = profile["sessionRoot"] as? String else {
                skipped.append("\(name)（\(raw)）")
                continue
            }
            accounts.append(Account(
                id: id, name: name, app: app,
                profilePath: profilePath, sessionRoot: sessionRoot,
                createdAt: (profile["createdAt"] as? String).flatMap(ISO8601.parse) ?? Date(),
                lastLaunchedAt: (profile["lastLaunchedAt"] as? String).flatMap(ISO8601.parse)))
        }
        return (accounts, skipped)
    }

    static func folderName(_ name: String) -> String {
        let replaced = String(name.map { "/:\\".contains($0) ? "-" : $0 })
        let trimmed = String(replaced.drop { $0 == "." }).trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "account" : String(trimmed.prefix(40))
    }

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(ISO8601.string(date))
        }
        return encoder
    }()

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = ISO8601.parse(text) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "无法识别的日期 \(text)"))
            }
            return date
        }
        return decoder
    }()
}
