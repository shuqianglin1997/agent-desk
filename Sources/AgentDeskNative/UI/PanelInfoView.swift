import SwiftUI

struct PanelInfoView: View {
    @ObservedObject var desk: AgentDeskNativeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            item("账号与任务", symbol: "rectangle.stack") {
                Text("点账号打开客户端，点任务调出所属账号。分组可收起，账号与分组可拖动排序；右键查看更多操作。")
            }
            item("额度", symbol: "gauge.with.dots.needle.50percent") {
                Text("百分比为已用额度，悬停查看剩余。打开面板会同步，也可手动刷新。")
                Text("同步失败时保留缓存；标记表示记录时间，悬停警示查看原因。")
                    .foregroundStyle(.secondary)
            }
            item("文档接力", symbol: "doc.on.clipboard") {
                Text("右键已停下的任务 → 接力到…，选择 Markdown 文档。AgentDesk Native 复制正文与绝对路径；到目标新对话粘贴发送。")
            }
            item("桌面入口", symbol: "pawprint") {
                Text("在设置开启原生浮球，爪印控制显示与隐藏。单击打开面板，双击调出忙碌账号，拖动换位置。始终保持系统外观。")
            }
            Divider()
            PanelDisclosure("数据与限制") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("平时只读任务元数据。接力只复制你选择的文档，不提取或自动发送聊天；副本保存在本机。")
                    Text("Claude 额度使用对应账号授权，仅在内存中使用。首次手动同步可能需要钥匙串授权；后台不弹提示。")
                    Text("点击任务不保证直接定位到具体对话，可能需要在客户端中选择。")
                    if desk.accounts.filter({ $0.app == .claude }).count > 1 {
                        Text("Claude 本地 Code 会话不区分账号，显示在第一个 Claude 账号下。")
                    }
                    if !desk.skippedImports.isEmpty {
                        Text("导入时跳过：\(desk.skippedImports.joined(separator: "、"))。仅支持 Codex 与 Claude。")
                    }
                    Text("交接目录").fontWeight(.medium)
                    Text(desk.handoffs.directory.path)
                        .textSelection(.enabled)
                }
                .foregroundStyle(.secondary)
                .padding(.top, 8)
                .fixedSize(horizontal: false, vertical: true)
            }
            .help("本机数据、授权与客户端限制")
        }
        .font(.system(size: 11))
        .fixedSize(horizontal: false, vertical: true)
    }

    private func item<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(title, systemImage: symbol).fontWeight(.semibold)
            content()
        }
    }
}
