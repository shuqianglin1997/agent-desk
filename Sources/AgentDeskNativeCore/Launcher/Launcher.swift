import Foundation

public enum LaunchOutcome: Equatable {
    case launched
    case activated(pid: Int32)
    case failed(String)
}

/// Starts an account's client, or brings its already-running instance to the front.
/// `activate` is injected by the app layer (NSRunningApplication) so this module stays UI-free.
public struct Launcher {
    public var activate: (Int32) -> Bool
    public var locate: (AppKind) -> URL?
    public var processes: () -> [RunningProcess]?
    public var run: (LaunchCommand) throws -> Void
    public var aliasRoot: URL

    public init(activate: @escaping (Int32) -> Bool,
                locate: @escaping (AppKind) -> URL? = { AppLocator.locate($0) },
                processes: @escaping () -> [RunningProcess]? = { ProcessMatcher.snapshot() },
                run: @escaping (LaunchCommand) throws -> Void = { try $0.run() },
                aliasRoot: URL = RuntimeHome.defaultAliasRoot()) {
        self.activate = activate
        self.locate = locate
        self.processes = processes
        self.run = run
        self.aliasRoot = aliasRoot
    }

    public func launch(_ account: Account) -> LaunchOutcome {
        guard let running = processes() else { return .failed("无法确认客户端是否在运行，已取消启动") }
        if let owner = ProcessMatcher.owner(of: account.profilePath, in: running) {
            return activate(owner.pid) ? .activated(pid: owner.pid) : .failed("客户端在运行，但没能调到前台")
        }
        guard FileManager.default.fileExists(atPath: account.profilePath) else { return .failed("数据目录不存在") }
        guard let bundle = locate(account.app) else { return .failed(AppLocator.missingMessage(account.app)) }
        CrashpadCleaner.prune(profilePath: account.profilePath)
        do {
            let home = account.app == .codex
                ? try RuntimeHome.resolve(accountID: account.id, sessionRoot: account.sessionRoot, aliasRoot: aliasRoot)
                : nil
            try run(LaunchCommand.make(appBundle: bundle.path, account: account, codexHome: home))
            return .launched
        } catch {
            return .failed("启动失败：\(error.localizedDescription)")
        }
    }
}
