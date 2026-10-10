import SwiftUI
import AgentDeskNativeCore

struct AgentDeskNativePanel: View {
    @ObservedObject var desk: AgentDeskNativeModel
    @ObservedObject var pet: PetModel
    @State private var page: Page = .accounts
    enum Page { case accounts, settings, newAccount, info }
    private static let panelWidth: CGFloat = 340
    private static let panelPadding: CGFloat = 14

    private var accent: Color { .accentColor }
    private var title: String {
        switch page {
        case .accounts: return "AgentDesk Native"
        case .settings: return "设置"
        case .info: return "信息"
        case .newAccount: return "新建账号"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 14, weight: .semibold))
            // Keep one instance of every page, so navigation preserves scroll and expanded state.
            // The shared shell owns the size; long page contents scroll inside it.
            ZStack(alignment: .topLeading) {
                pageContent(.accounts) { cards }
                pageContent(.settings) { SettingsView(desk: desk, pet: pet) }
                pageContent(.info) { PanelInfoView(desk: desk) }
                pageContent(.newAccount) { NewAccountView(desk: desk) { page = .accounts } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            if let message = desk.message {
                HStack(alignment: .top, spacing: 6) {
                    Text(message).font(.system(size: 11)).foregroundStyle(.orange)
                        .lineLimit(2).help(message)
                    Spacer(minLength: 0)
                    Button { desk.dismissMessage() } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(.secondary).help("关闭提示")
                }
            }
            Divider()
            HStack(spacing: 14) {
                Button { toggle(.newAccount) } label: { Label("新建账号", systemImage: "plus") }
                    .foregroundStyle(page == .newAccount ? accent : Color.secondary)
                Spacer()
                Button { toggle(.info) } label: { footerIcon("info.circle") }
                    .foregroundStyle(page == .info ? accent : Color.secondary)
                    .help(page == .info ? "返回账号列表" : "信息")
                    .accessibilityLabel("信息")
                    .accessibilityValue(page == .info ? "已选中" : "未选中")
                Button { toggle(.settings) } label: { footerIcon("gearshape") }
                    .foregroundStyle(page == .settings ? accent : Color.secondary)
                    .help(page == .settings ? "返回账号列表" : "设置")
                    .accessibilityLabel("设置")
                    .accessibilityValue(page == .settings ? "已选中" : "未选中")
                if pet.enabled {
                    Button { pet.setVisible(!pet.visible) } label: {
                        footerIcon(pet.visible ? "pawprint.fill" : "pawprint")
                    }
                    .foregroundStyle(pet.visible ? accent : Color.secondary)
                    .help(pet.visible ? "隐藏桌宠" : "显示桌宠")
                    .accessibilityLabel("桌宠")
                    .accessibilityValue(pet.visible ? "已显示" : "已隐藏")
                }
            }
            .buttonStyle(.plain).font(.system(size: 12))
        }
        .padding(Self.panelPadding)
        .frame(width: Self.panelWidth, height: 570)
        .background {
            NativePanelMaterial()
                .overlay(Color(nsColor: .windowBackgroundColor).opacity(0.35))
        }
        .tint(.accentColor)
    }

    private func footerIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .resizable().scaledToFit()
            .frame(width: 16, height: 16)
            .frame(width: 24, height: 24, alignment: .center)
            .contentShape(Rectangle())
    }

    private func toggle(_ destination: Page) {
        page = page == destination ? .accounts : destination
    }

    private func pageContent<Content: View>(_ destination: Page, @ViewBuilder content: () -> Content) -> some View {
        // A fixed text column prevents disclosure expansion from rewrapping every page.
        // Scrolling remains available without a legacy scroller taking layout space.
        ScrollView(.vertical, showsIndicators: false) {
            content()
                .frame(width: Self.panelWidth - 2 * Self.panelPadding - 8, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .opacity(page == destination ? 1 : 0)
        .disabled(page != destination)
        .allowsHitTesting(page == destination)
        .accessibilityHidden(page != destination)
    }

    private var cards: some View {
        VStack(spacing: 8) {
            HandoffPreparationView(desk: desk)
            ForEach(desk.discovered, id: \.self) { app in DiscoveredRow(desk: desk, app: app) }
            if desk.accounts.isEmpty {
                Text("还没有账号。点下面的“新建账号”添加一个。").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            ForEach(desk.groups, id: \.app) { group in
                GroupHeader(desk: desk, app: group.app, count: group.accounts.count)
                if !desk.collapsedApps.contains(group.app) {
                    ForEach(group.accounts) { AccountCard(desk: desk, account: $0) }
                }
            }
        }
    }
}

/// Separate payloads keep account, group and session drops from affecting each other.
enum PanelDrag {
    static func account(_ id: String) -> String { "account:\(id)" }
    static func group(_ app: AppKind) -> String { "group:\(app.rawValue)" }

    static func session(_ id: String, accountID: String) -> String {
        // Encode IDs rather than splitting on punctuation that imported account IDs may contain.
        let data = try! JSONEncoder().encode([accountID, id])
        return "session:" + data.base64EncodedString()
    }

    static func dropSession(_ items: [String], on row: SessionRow, account: Account, desk: AgentDeskNativeModel) -> Bool {
        guard items.count == 1, let item = items.first, item.hasPrefix("session:"),
              let data = Data(base64Encoded: String(item.dropFirst("session:".count))),
              let ids = try? JSONDecoder().decode([String].self, from: data), ids.count == 2,
              ids[0] == account.id else { return false }
        return desk.moveSession(ids[1], before: row.id, in: account)
    }

    /// Handles a drop onto `app`'s header (target nil) or onto one of its accounts.
    static func drop(_ items: [String], on app: AppKind, account target: Account?, desk: AgentDeskNativeModel) -> Bool {
        guard let item = items.first else { return false }
        if item.hasPrefix("account:") {
            desk.moveAccount(String(item.dropFirst("account:".count)), before: target)
            return true
        }
        if item.hasPrefix("group:"), let moving = AppKind(rawValue: String(item.dropFirst("group:".count))) {
            desk.moveGroup(moving, before: app)
            return true
        }
        return false
    }
}

struct GroupHeader: View {
    @ObservedObject var desk: AgentDeskNativeModel
    let app: AppKind
    let count: Int
    @State private var targeted = false

    var body: some View {
        let collapsed = desk.collapsedApps.contains(app)
        // Not a Button: on macOS a Button swallows the drag gesture, so the header could not be dragged.
        HStack(spacing: 6) {
            if let icon = desk.icon(for: app) {
                Image(nsImage: icon).resizable().frame(width: 16, height: 16)
            }
            Text(app.displayName).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            if collapsed {
                Text("\(count)").font(.system(size: 10)).foregroundStyle(.tertiary)
            }
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(.tertiary)
                .rotationEffect(.degrees(collapsed ? -90 : 0))
        }
        .padding(.horizontal, 4).padding(.vertical, 3)
        .contentShape(Rectangle())
        .background(targeted ? Color.primary.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .onTapGesture { withAnimation(.easeInOut(duration: 0.15)) { desk.toggleCollapsed(app) } }
        .help(collapsed ? "展开 \(app.displayName)" : "收起 \(app.displayName)；拖动可调整分组顺序")
        .draggable(PanelDrag.group(app)) { DragChip(title: app.displayName) }
        .dropDestination(for: String.self) { items, _ in
            PanelDrag.drop(items, on: app, account: nil, desk: desk)
        } isTargeted: { targeted = $0 }
    }
}

/// Small drag preview; rendering a whole card as the preview made dragging stutter.
struct DragChip: View {
    let title: String
    var body: some View {
        Text(title).font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(.regularMaterial, in: Capsule())
            .foregroundStyle(.primary)
    }
}

/// Offers a client that was opened from the Dock (its default data exists) but has no account yet.
struct DiscoveredRow: View {
    @ObservedObject var desk: AgentDeskNativeModel
    let app: AppKind

    var body: some View {
        HStack(spacing: 8) {
            if let icon = desk.icon(for: app) { Image(nsImage: icon).resizable().frame(width: 18, height: 18) }
            let existing = desk.accounts.filter { $0.app == app }
            Text(existing.isEmpty ? "发现直接打开的 \(app.displayName)" : "发现直接打开的 \(app.displayName)，它是哪个账号？")
                .font(.system(size: 11)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            if existing.isEmpty {
                Button("添加为账号") { desk.addDiscovered(app) }.controlSize(.small)
            } else {
                // Usually it is an account the user already has, so offer those first; a new account comes last.
                Menu("选择账号") {
                    ForEach(existing) { account in
                        Button(account.name) { desk.useDefaultData(account) }
                    }
                    Divider()
                    Button("新账号…") { desk.addDiscovered(app) }
                }
                .menuStyle(.borderedButton).controlSize(.small).fixedSize()
            }
            Button { desk.dismissDiscovered(app) } label: { Image(systemName: "xmark") }
                .buttonStyle(.plain).foregroundStyle(.tertiary).help("不再提示")
        }
        .padding(8)
        .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
    }
}
