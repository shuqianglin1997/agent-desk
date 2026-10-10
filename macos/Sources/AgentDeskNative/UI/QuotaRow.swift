import SwiftUI
import AgentDeskNativeCore

/// Numeric quota windows stay on separate lines within the narrow account card.
struct QuotaRowView: View {
    let quota: QuotaDisplay

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            VStack(alignment: .leading, spacing: 3) {
                switch quota.value {
                case .windows(let windows)?:
                    if quota.isClaude, quota.cached, !windows.contains(where: { $0.minutes == 300 }) {
                        HStack(spacing: 6) {
                            Text("5h").frame(minWidth: 20, alignment: .leading)
                            Text("待更新")
                            Spacer(minLength: 4)
                            Text("暂无最新用量")
                        }
                        .foregroundStyle(.secondary)
                        .help("本地旧记录无法确认当前 5 小时用量。点击账号旁的刷新按钮同步；查询失败原因可在缓存警示中查看。")
                    }
                    ForEach(Array(windows.enumerated()), id: \.offset) {
                        QuotaWindowView(window: $0.element, now: context.date)
                    }
                case .unlimited(let why)?:
                    Text("不限").help(why)
                case .signedOut?:
                    Text("未登录").foregroundStyle(.orange)
                case .noData?:
                    Text("没有返回额度").foregroundStyle(.secondary)
                case nil where quota.isClaude:
                    Text(quota.liveFailed ? "暂无数据" : "查询中…").foregroundStyle(.secondary).help(quota.liveFailure ?? "正在查询 Claude 额度")
                case nil:
                    Text(quota.liveFailed ? "暂无数据" : "查询中…").foregroundStyle(.secondary)
                }
            }
            .font(.system(size: 11))
            .fixedSize(horizontal: false, vertical: true)
        }
    }

}

/// Cache age belongs to the account header, separate from each window's reset time.
struct QuotaFreshnessView: View {
    let quota: QuotaDisplay

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            if quota.cached, let observed = quota.observedAt {
                HStack(spacing: 3) {
                    Text("缓存 · \(QuotaFormat.age(observed, now: context.date))")
                    if quota.liveFailed { Image(systemName: "exclamationmark.triangle") }
                }
                    .help("额度记录时间：\(QuotaFormat.resetTimestamp(observed))。"
                          + (quota.liveFailed ? "保留最近的额度记录。" : "正在查询实时额度。")
                          + (quota.liveFailure.map { "实时查询失败：\($0)" } ?? ""))
            } else if let failure = quota.liveFailure {
                Text("查询失败").help(failure)
            }
        }
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
        .fixedSize()
    }
}

struct QuotaWindowView: View {
    let window: QuotaWindow
    let now: Date

    var body: some View {
        // A cached window that has already reset says nothing about current use.
        let reset = window.hasReset(now: now)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(window.label).foregroundStyle(.secondary).frame(minWidth: 20, alignment: .leading)
            Text(reset ? "已重置" : "\(Int(window.usedPercent.rounded()))%")
                .monospacedDigit()
                .foregroundStyle(reset ? Color.secondary : tint(window.usedPercent))
                .fixedSize()
            Spacer(minLength: 4)
            if !reset, let resetsAt = window.resetsAt {
                Text(QuotaFormat.resetCountdown(resetsAt, now: now))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
                    .fixedSize()
            } else if reset {
                Text("待更新用量").foregroundStyle(.secondary)
            } else {
                Text("重置时间未记录").foregroundStyle(.secondary).fixedSize()
            }
        }
        .help((reset ? "旧周期用量已失效。" : "已用 \(Int(window.usedPercent.rounded()))%，剩余 \(Int((100 - window.usedPercent).rounded()))%。") + (window.resetsAt.map {
            "\(window.label)窗口\(reset ? "已于" : "将于") \(QuotaFormat.resetTimestamp($0)) 重置"
        } ?? "重置时间未记录"))
    }

    private func tint(_ used: Double) -> Color {
        used >= 90 ? ReadableStatusColor.red : used >= 70 ? ReadableStatusColor.amber : .primary
    }
}
