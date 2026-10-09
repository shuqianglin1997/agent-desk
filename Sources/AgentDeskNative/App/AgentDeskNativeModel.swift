import AppKit
import Combine
import AgentDeskNativeCore

extension Launcher {
    /// Activation uses NSRunningApplication only: no Accessibility, AppleScript or input-monitoring permission.
    static func live() -> Launcher {
        Launcher(activate: { pid in
            let work = { () -> Bool in
                guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else { return false }
                app.unhide()
                return app.activate(options: [.activateAllWindows])
            }
            return Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
        })
    }
}

/// Accounts, per-account Codex tasks, Claude sessions and the actions the panel offers.
final class AgentDeskNativeModel: ObservableObject {
    @Published private(set) var accounts: [Account] = []
    @Published private(set) var snapshots: [String: CodexSnapshot] = [:]
    @Published private(set) var claudeSessions: [ClaudeSession] = []
    @Published private(set) var runningIDs: Set<String> = []
    @Published private(set) var skippedImports: [String] = []
    @Published var message: String? {
        didSet { scheduleMessageDismissal() }
    }
    private var messageDismissal: DispatchWorkItem?
    private var panelVisible = false
    private let feedbackLifetime: TimeInterval
    private let notificationSender: (String, String, @escaping (Bool) -> Void) -> Void
    private var notificationSequence: UInt64 = 0
    /// Client groups in the panel, top to bottom, and which ones are folded. Both are saved in preferences.
    @Published private(set) var appOrder: [AppKind] =
        (UserDefaults.standard.stringArray(forKey: "appOrder") ?? []).compactMap(AppKind.init(rawValue:))
    @Published private(set) var collapsedApps: Set<AppKind> =
        Set((UserDefaults.standard.stringArray(forKey: "collapsedApps") ?? []).compactMap(AppKind.init(rawValue:)))
    private var appIcons: [AppKind: NSImage] = [:]
    /// Clients opened from the Dock whose data no account points at yet, minus ones the user dismissed.
    @Published private(set) var discovered: [AppKind] = []
    /// Current quota snapshots for both clients.
    @Published private(set) var quotas: [String: QuotaDisplay] = [:]
    @Published private(set) var refreshingQuotas: Set<String> = []
    @Published var automaticallySyncQuota = UserDefaults.standard.object(forKey: "automaticallySyncQuota") as? Bool ?? true {
        didSet { UserDefaults.standard.set(automaticallySyncQuota, forKey: "automaticallySyncQuota") }
    }
    private var quotaThrottle = QuotaThrottle()
    private var quotaRetryAfter: [String: Date] = [:]
    private var quotaTimer: Timer?
    private let quotaQueue = DispatchQueue(label: "com.agentdesk.native.quota", qos: .utility, attributes: .concurrent)
    /// Handoff documents and log under ~/Library/Application Support/AgentDeskNative/handoffs.
    let handoffs: HandoffStore
    /// Newest first, for the settings page.
    @Published var handoffLog: [HandoffLogEntry] = []
    @Published var pendingHandoff: HandoffPreparation?
    @Published var completingHandoff = false

    private let store: AccountStore
    private let launcher: Launcher
    private let claudeReader = ClaudeSessionReader()
    private var readers: [String: CodexReader] = [:]
    private let worker = DispatchQueue(label: "com.agentdesk.native.poll", qos: .utility)
    private var reading = false
    private var timer: Timer?
    private var launchCallbacks: [String: [(LaunchOutcome) -> Void]] = [:]

    init(store: AccountStore = .standard(), launcher: Launcher = .live(), feedbackLifetime: TimeInterval = 6,
         notificationSender: @escaping (String, String, @escaping (Bool) -> Void) -> Void = {
             AgentDeskNativeNotifications.shared.send(title: $0, body: $1, completion: $2)
         }) {
        self.store = store
        self.launcher = launcher
        self.handoffs = HandoffStore(root: store.root)
        self.feedbackLifetime = feedbackLifetime
        self.notificationSender = notificationSender
        do { pendingHandoff = try handoffs.pendingPreparation() }
        catch {
            do {
                try handoffs.archivePreparationState()
                message = "待接力记录无法读取，已保留备份。请重新准备接力；已有文档未删除。"
            } catch { message = "待接力记录无法恢复：\(error.localizedDescription)" }
        }
    }

    /// Background events remain visible outside the popover; denied notifications wait for the next opening.
    func notify(title: String, body: String) {
        notificationSequence &+= 1
        let sequence = notificationSequence
        notificationSender(title, body) { [weak self] delivered in
            guard !delivered else { return }
            DispatchQueue.main.async {
                guard let self, self.notificationSequence == sequence else { return }
                self.message = "\(title)：\(body)"
            }
        }
    }

    func dismissMessage() { message = nil }

    private func scheduleMessageDismissal() {
        messageDismissal?.cancel()
        messageDismissal = nil
        guard panelVisible, message != nil else { return }
        let work = DispatchWorkItem { [weak self] in self?.message = nil }
        messageDismissal = work
        DispatchQueue.main.asyncAfter(deadline: .now() + feedbackLifetime, execute: work)
    }

    func panelClosed() {
        panelVisible = false
        dismissMessage()
    }

    func start() {
        reload()
        handoffLog = handoffs.recentLog(limit: .max)
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.poll() }
        quotaTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            guard let self, self.automaticallySyncQuota else { return }
            self.refreshQuotas()
        }
        if automaticallySyncQuota { refreshQuotas() }
    }

    private func reload() {
        do { try store.load() } catch { message = "账号列表读取失败：\(error.localizedDescription)" }
        accounts = store.accounts
        skippedImports = store.skippedImports
        refreshDiscovered()
    }

    private func refreshDiscovered() {
        let dismissed = Set(UserDefaults.standard.stringArray(forKey: "dismissedDefaults") ?? [])
        discovered = store.unclaimedDefaults().filter { !dismissed.contains($0.rawValue) }
    }

    func dismissDiscovered(_ app: AppKind) {
        let dismissed = (UserDefaults.standard.stringArray(forKey: "dismissedDefaults") ?? []) + [app.rawValue]
        UserDefaults.standard.set(dismissed, forKey: "dismissedDefaults")
        refreshDiscovered()
    }

    /// Adds the Dock instance's default data as an account, named by the user.
    func addDiscovered(_ app: AppKind) {
        let alert = NSAlert()
        alert.messageText = "添加直接打开的 \(app.displayName)"
        alert.informativeText = "这是从程序坞或访达直接打开 \(app.displayName) 时使用的那份数据。AgentDesk Native 只引用它，不移动、不复制。"
        let field = NSTextField(string: app.displayName)
        field.frame = NSRect(x: 0, y: 0, width: 240, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "添加")
        alert.addButton(withTitle: "取消")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            try store.addDefault(app: app, name: field.stringValue)
            accounts = store.accounts
            refreshDiscovered()
            poll()
        } catch {
            message = "添加失败：\(error.localizedDescription)"
        }
    }

    func isDefaultData(_ account: Account) -> Bool { store.isDefaultData(account) }

    /// Re-points an existing account at its client's default data, e.g. when that is the account actually in use.
    func useDefaultData(_ account: Account) {
        let alert = NSAlert()
        alert.messageText = "让“\(account.name)”改用直接打开的 \(account.app.displayName)？"
        alert.informativeText = "以后启动和读取对话都使用从程序坞直接打开时的那份数据。原来的数据目录保留在原处，不会删除：\n\(account.profilePath)"
        alert.addButton(withTitle: "改用")
        alert.addButton(withTitle: "取消")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            try store.useDefaultData(id: account.id)
            accounts = store.accounts
            snapshots[account.id] = nil   // readers are keyed by session root, so the new data gets a fresh one
            quotas[account.id] = nil
            quotaThrottle.reset(account.id)
            quotaRetryAfter[account.id] = nil
            refreshDiscovered()
            poll()
        } catch {
            message = "改用默认数据失败：\(error.localizedDescription)"
        }
    }

    // MARK: Quota

    func panelOpened() {
        panelVisible = true
        scheduleMessageDismissal()
        refreshQuotas()
    }

    func refreshQuotas(manual: Bool = false) {
        for account in accounts { refreshQuota(account, manual: manual) }
    }

    func refreshQuota(_ account: Account, manual: Bool = true) {
        guard !dataMissing(account), !refreshingQuotas.contains(account.id) else { return }
        let now = Date()
        if let retry = quotaRetryAfter[account.id], retry > now {
            if manual { message = "Claude 正在限制查询，请在 \(QuotaFormat.resetTimestamp(retry)) 后重试。" }
            return
        }
        if manual { quotaThrottle.reset(account.id) }
        let live = quotaThrottle.allow(account.id, now: now)
        if live { refreshingQuotas.insert(account.id) }
        let rollouts = (snapshots[account.id]?.tasks ?? []).sorted { $0.updatedAt > $1.updatedAt }.compactMap(\.rolloutPath).prefix(5)
        quotaQueue.async { [weak self] in
            let cache = account.app == .claude
                ? ClaudeQuotaCache.latest(dataDir: URL(fileURLWithPath: account.profilePath))
                : QuotaCache.latest(rollouts: Array(rollouts))
            DispatchQueue.main.async {
                guard let self, self.accounts.contains(where: { $0.id == account.id && $0.profilePath == account.profilePath }) else { return }
                if account.app == .claude {
                    let current = self.quotas[account.id]
                    if let cache, current == nil || cache.observedAt > (current?.observedAt ?? .distantPast) {
                        var display = QuotaDisplay.claude(cache)
                        display.liveFailure = current?.liveFailure
                        self.setQuota(display, for: account.id)
                    } else if current == nil { self.setQuota(.claude(nil), for: account.id) }
                } else {
                    let display = QuotaDisplay.withCache(self.quotas[account.id], cache)
                    self.setQuota(display ?? (live ? .empty : nil), for: account.id)
                }
            }
            guard live else { return }
            if account.app == .claude {
                let result = ClaudeQuota.live(dataDir: URL(fileURLWithPath: account.profilePath), interactive: manual)
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.refreshingQuotas.remove(account.id)
                    guard self.accounts.contains(where: { $0.id == account.id && $0.profilePath == account.profilePath }) else { return }
                    if case .failure(.rateLimited(let delay)) = result { self.quotaRetryAfter[account.id] = Date().addingTimeInterval(delay) }
                    else { self.quotaRetryAfter[account.id] = nil }
                    self.setQuota((self.quotas[account.id] ?? .claude(nil)).applyingClaude(result, now: Date()), for: account.id)
                }
            } else {
                let result = CodexQuota.live(account)
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.refreshingQuotas.remove(account.id)
                    guard self.accounts.contains(where: { $0.id == account.id && $0.profilePath == account.profilePath }) else { return }
                    self.setQuota((self.quotas[account.id] ?? .empty).applying(result, now: Date()), for: account.id)
                }
            }
        }
    }

    private func setQuota(_ display: QuotaDisplay?, for id: String) {
        if quotas[id] != display { quotas[id] = display }
    }

    // MARK: Polling

    func poll() {
        guard !reading else { return }
        reading = true
        let accounts = self.accounts
        let codex = accounts.filter { $0.app == .codex }.map { ($0.id, reader(for: $0)) }
        let claudeReader = self.claudeReader
        worker.async { [weak self] in
            let processes = ProcessMatcher.snapshot() ?? []
            let running = Set(accounts.filter { ProcessMatcher.owner(of: $0.profilePath, in: processes) != nil }.map(\.id))
            var snapshots: [String: CodexSnapshot] = [:]
            for (id, reader) in codex { snapshots[id] = reader.read(appRunning: running.contains(id)) }
            let sessions = accounts.contains { $0.app == .claude } ? claudeReader.recent() : []
            DispatchQueue.main.async { self?.apply(snapshots: snapshots, running: running, sessions: sessions) }
        }
    }

    private func apply(snapshots: [String: CodexSnapshot], running: Set<String>, sessions: [ClaudeSession]) {
        reading = false
        let live = Set(accounts.map(\.id))
        let snapshots = snapshots.filter { live.contains($0.key) }
        if self.snapshots != snapshots { self.snapshots = snapshots }
        let running = running.intersection(live)
        if runningIDs != running { runningIDs = running }
        if claudeSessions != sessions { claudeSessions = sessions }
        if quotas.keys.contains(where: { !live.contains($0) }) { quotas = quotas.filter { live.contains($0.key) } }

    }

    private func reader(for account: Account) -> CodexReader {
        if let reader = readers[account.sessionRoot] { return reader }
        let reader = CodexReader(home: URL(fileURLWithPath: account.sessionRoot))
        readers[account.sessionRoot] = reader
        return reader
    }

    // MARK: Actions

    func launch(_ account: Account, then: ((LaunchOutcome) -> Void)? = nil) {
        if launchCallbacks[account.id] != nil {
            if let then { launchCallbacks[account.id]?.append(then) }
            return
        }
        launchCallbacks[account.id] = then.map { [$0] } ?? []
        let launcher = self.launcher
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let outcome = launcher.launch(account)
            DispatchQueue.main.async {
                guard let self else { return }
                let callbacks = self.launchCallbacks.removeValue(forKey: account.id) ?? []
                if case .failed(let text) = outcome {
                    self.notify(title: "启动失败", body: text)
                } else {
                    do { try self.store.markLaunched(id: account.id, at: Date()) } catch {
                        self.notify(title: "记录启动时间失败", body: error.localizedDescription)
                    }
                    self.accounts = self.store.accounts
                }
                callbacks.forEach { $0(outcome) }
                self.poll()
            }
        }
    }

    /// Brings the account's client forward; opens the conversation link only when it cannot reach the wrong instance.
    /// Codex instances are counted from a fresh process list, so a Codex started outside AgentDeskNative also counts.
    func open(_ row: SessionRow, in account: Account, then completion: ((LaunchOutcome) -> Void)? = nil) {
        launch(account) { outcome in
            defer { completion?(outcome) }
            guard case .activated = outcome else { return }
            let action: OpenAction
            switch row.kind {
            case .codex(let task):
                DispatchQueue.global(qos: .userInitiated).async {
                    let action = Self.runningCodexInstances().map {
                        SessionRouting.codex(threadID: task.id, runningCodexInstances: $0)
                    } ?? .activateOnly
                    if case .openURL(let url) = action { DispatchQueue.main.async { NSWorkspace.shared.open(url) } }
                }
                return
            case .claude(let session):
                action = SessionRouting.claude(sessionID: session.id)
            }
            if case .openURL(let url) = action { NSWorkspace.shared.open(url) }
        }
    }

    /// Main Codex/ChatGPT processes currently running, or nil when the process list is unavailable.
    private static func runningCodexInstances() -> Int? {
        ProcessMatcher.snapshot()?.filter { process in
            !process.args.contains(" --type=") && !process.args.contains("crashpad_handler")
                && (process.args.contains("/ChatGPT.app/Contents/MacOS/") || process.args.contains("/Codex.app/Contents/MacOS/"))
        }.count
    }

    /// Pet double-click: the Codex account with an active task, else the first Codex account, else any account.
    func openBusiestAccount() {
        let codex = accounts.filter { $0.app == .codex }
        let busy = codex.first { account in
            snapshots[account.id]?.tasks.contains { $0.status == .running || $0.status == .waiting } == true
        }
        if let account = busy ?? codex.first ?? accounts.first { launch(account) }
    }

    func copy(_ path: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Self.resolved(path), forType: .string)
    }

    func reveal(_ path: String) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: Self.resolved(path))])
    }

    /// Codex may record paths under the short /tmp alias; show the real location.
    private static func resolved(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }

    // MARK: Account management

    @discardableResult
    func create(name: String, app: AppKind) -> Bool {
        do {
            let account = try store.create(name: name, app: app)
            accounts = store.accounts
            launch(account)
            return true
        } catch {
            message = "新建失败：\(error.localizedDescription)"
            return false
        }
    }

    func rename(_ account: Account) {
        let alert = NSAlert()
        alert.messageText = "给“\(account.name)”改名"
        let field = NSTextField(string: account.name)
        field.frame = NSRect(x: 0, y: 0, width: 240, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "改名")
        alert.addButton(withTitle: "取消")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            try store.rename(id: account.id, to: field.stringValue)
            accounts = store.accounts
        } catch {
            message = "改名失败：\(error.localizedDescription)"
        }
    }

    func delete(_ account: Account) {
        let alert = NSAlert()
        alert.messageText = "删除账号“\(account.name)”？"
        let box = NSButton(checkboxWithTitle: "同时把数据目录移到废纸篓", target: nil, action: nil)
        if store.isDefaultData(account) {
            // The Dock instance's data is never offered for the Trash.
            alert.informativeText = "只删除 AgentDeskNative 里的账号。直接打开 \(account.app.displayName) 时使用的数据不受影响。"
        } else {
            alert.informativeText = "只删除 AgentDeskNative 里的账号槽，客户端数据目录默认保留。"
            alert.accessoryView = box
        }
        alert.addButton(withTitle: "删除")
        alert.addButton(withTitle: "取消")
        NSApp.activate()
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            try store.delete(id: account.id, moveDataToTrash: box.state == .on)
        } catch {
            message = "删除失败：\(error.localizedDescription)"
        }
        accounts = store.accounts
        snapshots[account.id] = nil
        refreshDiscovered()
    }

    func relocate(_ account: Account) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.showsHiddenFiles = true
        panel.prompt = "使用这个目录"
        panel.message = "选择“\(account.name)”的客户端数据目录（--user-data-dir）"
        NSApp.activate()
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try store.relocate(id: account.id, profilePath: url.path)
            accounts = store.accounts
            quotas[account.id] = nil
            quotaThrottle.reset(account.id)
            quotaRetryAfter[account.id] = nil
            poll()
        } catch {
            message = "重新定位失败：\(error.localizedDescription)"
        }
    }

    // MARK: Groups

    var groups: [AccountGroups.Group] { AccountGroups.ordered(accounts, order: appOrder) }

    func toggleCollapsed(_ app: AppKind) {
        if collapsedApps.contains(app) { collapsedApps.remove(app) } else { collapsedApps.insert(app) }
        UserDefaults.standard.set(collapsedApps.map(\.rawValue).sorted(), forKey: "collapsedApps")
    }

    func moveGroup(_ app: AppKind, before target: AppKind?) {
        appOrder = AccountGroups.move(app, before: target, in: groups.map(\.app))
        UserDefaults.standard.set(appOrder.map(\.rawValue), forKey: "appOrder")
    }

    /// Reorders within one client group only; a drop onto another client's account is ignored.
    func moveAccount(_ id: String, before target: Account?) {
        guard let moving = accounts.first(where: { $0.id == id }) else { return }
        if let target, target.app != moving.app { return }
        // Dropping on the group's tail puts it after that group's last account.
        let next = target?.id ?? accounts.drop { $0.id != groups.first { $0.app == moving.app }?.accounts.last?.id }
            .dropFirst().first?.id
        do {
            try store.move(id: id, before: next)
            accounts = store.accounts
        } catch {
            message = "调整顺序失败：\(error.localizedDescription)"
        }
    }

    /// The installed client's own icon, as shown in Finder.
    func icon(for app: AppKind) -> NSImage? {
        if let cached = appIcons[app] { return cached }
        guard let url = AppLocator.locate(app) else { return nil }
        let image = NSWorkspace.shared.icon(forFile: url.path)
        appIcons[app] = image
        return image
    }

    // MARK: View helpers

    func title(for account: Account) -> String {
        account.name
    }

    func dataMissing(_ account: Account) -> Bool {
        !FileManager.default.fileExists(atPath: account.profilePath)
    }

    func rows(for account: Account) -> [SessionRow] {
        switch account.app {
        case .codex: return (snapshots[account.id]?.tasks ?? []).map { SessionRow(kind: .codex($0)) }
        case .claude: return account.id == firstClaudeID ? claudeSessions.map { SessionRow(kind: .claude($0)) } : []
        }
    }

    func emptyText(for account: Account) -> String {
        switch account.app {
        case .codex:
            guard let snapshot = snapshots[account.id] else { return "正在读取…" }
            return snapshot.available ? "还没有对话" : snapshot.detail
        case .claude:
            if account.id != firstClaudeID, let first = accounts.first(where: { $0.app == .claude }) {
                return "Claude 的本地会话统一显示在“\(first.name)”下"
            }
            return "还没有本地 Code 会话"
        }
    }

    private var firstClaudeID: String? { accounts.first { $0.app == .claude }?.id }
}
