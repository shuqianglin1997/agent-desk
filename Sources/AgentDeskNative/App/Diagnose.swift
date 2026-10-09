import Foundation
import AgentDeskNativeCore

/// `AgentDeskNative --diagnose`: prints per-account status for acceptance checks. No chat content is printed.
enum Diagnose {
    /// Window numbers or a status word only; never anything that identifies the account.
    private static func summary(_ value: QuotaValue?) -> String {
        switch value {
        case .windows(let windows)?: return windows.map {
            "\($0.label):\(Int($0.usedPercent.rounded()))% reset=\($0.resetsAt.map { QuotaFormat.resetTimestamp($0) } ?? "未记录")"
        }.joined(separator: ",")
        case .unlimited?: return "不限"
        case .signedOut?: return "未登录"
        case .noData?: return "无数据"
        case nil: return "无"
        }
    }

    static func run() {
        let store = AccountStore.standard()
        do { try store.load() } catch { print("accountsError=\(error.localizedDescription)"); return }
        let processes = ProcessMatcher.snapshot() ?? []
        print("accounts=\(store.accounts.count) skipped=\(store.skippedImports)")
        for account in store.accounts {
            let running = ProcessMatcher.owner(of: account.profilePath, in: processes) != nil
            let data = FileManager.default.fileExists(atPath: account.profilePath)
            var line = "account=\(account.name) app=\(account.app.rawValue) data=\(data) running=\(running)"
            if account.app == .codex {
                let snapshot = CodexReader(home: URL(fileURLWithPath: account.sessionRoot)).read(appRunning: running)
                let states = Dictionary(grouping: snapshot.tasks, by: { $0.status.rawValue }).mapValues(\.count)
                line += " available=\(snapshot.available) tasks=\(snapshot.tasks.count) states=\(states)"
                let rollouts = snapshot.tasks.sorted { $0.updatedAt > $1.updatedAt }.compactMap(\.rolloutPath).prefix(5)
                line += " quotaCached=\(summary(QuotaCache.latest(rollouts: Array(rollouts)).map { QuotaValue.windows($0.windows) }))"
                switch CodexQuota.live(account) {
                case .success(let value): line += " quotaLive=\(summary(value))"
                case .failure(let failure): line += " quotaLive=失败(\(failure.reason))"
                }
            } else {
                if let cache = ClaudeQuotaCache.latest(dataDir: URL(fileURLWithPath: account.profilePath)) {
                    line += " quotaCached=\(summary(.windows(cache.windows))) observed=\(QuotaFormat.resetTimestamp(cache.observedAt))"
                }
                switch ClaudeQuota.live(dataDir: URL(fileURLWithPath: account.profilePath)) {
                case .success(let value): line += " quotaLive=\(summary(value))"
                case .failure(let failure): line += " quotaLive=失败(\(failure.reason))"
                }
            }
            print(HandoffDocument.redactingEmails(line))
        }
        let claude = ClaudeSessionReader().recent()
        let claudeStates = Dictionary(grouping: claude, by: { $0.status.rawValue }).mapValues(\.count)
        print("claudeSessions=\(claude.count) states=\(claudeStates)")
        AgentDeskNativeNotifications.shared.diagnose()
        RunLoop.current.run(until: Date().addingTimeInterval(3))
    }
}
