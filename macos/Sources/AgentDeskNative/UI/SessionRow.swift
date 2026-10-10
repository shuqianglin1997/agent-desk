import SwiftUI
import AgentDeskNativeCore

/// One conversation row in an account card: a Codex task or a Claude desktop session.
struct SessionRow: Identifiable {
    enum Kind {
        case codex(CodexTask)
        case claude(ClaudeSession)
    }
    let kind: Kind

    var id: String {
        switch kind {
        case .codex(let task): return task.id
        case .claude(let session): return session.id
        }
    }
    var title: String {
        switch kind {
        case .codex(let task): return task.title
        case .claude(let session): return session.title
        }
    }
    var path: String? {
        switch kind {
        case .codex(let task): return task.rolloutPath
        case .claude(let session): return session.path
        }
    }
    var status: TaskStatus {
        switch kind {
        case .codex(let task): return task.status
        case .claude(let session): return session.status
        }
    }
    var updatedAt: Date {
        switch kind {
        case .codex(let task): return task.updatedAt
        case .claude(let session): return session.updatedAt
        }
    }
    var isClaudeCode: Bool {
        guard case .claude(let session) = kind else { return false }
        return URL(fileURLWithPath: session.path).pathExtension == "jsonl"
            && URL(fileURLWithPath: session.path).lastPathComponent != "audit.jsonl"
    }
    var isActive: Bool { status.isActive }
    /// Every row shows its status; the time is shown beside it, never instead of it.
    var age: String {
        let now = Date()
        // A file touched a moment ago can be a hair ahead of `now`; "0 秒后" reads wrong.
        if abs(now.timeIntervalSince(updatedAt)) < 60 { return "刚刚" }
        return Self.relative.localizedString(for: updatedAt, relativeTo: now)
    }
    var icon: String {
        switch status {
        case .running: return "ellipsis.circle"
        case .completed: return "checkmark.circle"
        case .waiting: return "hand.raised"
        case .failed: return "exclamationmark.circle"
        case .interrupted: return "pause.circle"
        case .unknown: return "circle.dashed"
        }
    }
    var tint: Color {
        switch status {
        case .running, .waiting: return .accentColor
        case .completed: return ReadableStatusColor.green
        case .failed: return ReadableStatusColor.amber
        default: return .primary
        }
    }

    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter
    }()
}

struct SessionRowView: View {
    @ObservedObject var desk: AgentDeskNativeModel
    let account: Account
    let row: SessionRow
    @State private var targeted = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: row.icon).foregroundStyle(row.tint)
                .frame(width: 14, height: 20)
            Text(row.title).lineLimit(1).foregroundStyle(.primary)
            if row.isClaudeCode {
                Text("Code").font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Text(row.age).font(.system(size: 10)).foregroundStyle(.secondary).fixedSize()
            Text(row.status.label).font(.system(size: 10)).foregroundStyle(.primary).fixedSize()
        }
        .font(.system(size: 12))
        .padding(.vertical, 1)
        .contentShape(Rectangle())
        .onTapGesture { desk.open(row, in: account) }
        .draggable(PanelDrag.session(row.id, accountID: account.id)) { DragChip(title: row.title) }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(.return) { desk.open(row, in: account); return .handled }
        .onKeyPress(.space) { desk.open(row, in: account); return .handled }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { desk.open(row, in: account) }
        .help(row.isClaudeCode
              ? "本机 Claude Code 历史；点击调出默认 Claude 客户端，目前不支持可靠直达此 Code 会话。拖动整行排序。"
              : "点击调出所属客户端；拖动整行排序（同一账号、同一状态分区）。")
        .overlay(alignment: .top) {
            if targeted { Capsule().fill(Color.accentColor).frame(height: 2).offset(y: -2) }
        }
        .dropDestination(for: String.self) { items, _ in
            PanelDrag.dropSession(items, on: row, account: account, desk: desk)
        } isTargeted: { targeted = $0 }
        .contextMenu {
            Button("打开") { desk.open(row, in: account) }
            let targets = desk.accounts.filter { $0.id != account.id }
            if !targets.isEmpty {
                Menu("接力到…") {
                    ForEach(targets) { target in
                        Button("\(target.name)（\(target.app.displayName)）") { desk.handoff(row, from: account, to: target) }
                    }
                }
            }
            if let path = row.path {
                Button("复制会话文件路径") { desk.copy(path) }
                Button("在 Finder 中显示") { desk.reveal(path) }
            }
        }
    }
}
