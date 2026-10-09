import SwiftUI
import AgentDeskNativeCore

/// One conversation row in an account card: a Codex task or a Claude Code session.
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

    var body: some View {
        Button { desk.open(row, in: account) } label: {
            HStack(spacing: 8) {
                Image(systemName: row.icon).foregroundStyle(row.tint).frame(width: 14)
                Text(row.title).lineLimit(1).foregroundStyle(.primary)
                Spacer(minLength: 4)
                Text(row.age).font(.system(size: 10)).foregroundStyle(.secondary).fixedSize()
                Text(row.status.label).font(.system(size: 10)).foregroundStyle(.primary).fixedSize()
            }
            .font(.system(size: 12))
            .padding(.vertical, 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
