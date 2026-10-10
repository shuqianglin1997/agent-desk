import SwiftUI

struct PanelInfoView: View {
    @ObservedObject var desk: AgentDeskNativeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            item("账号与任务", symbol: "rectangle.stack") {
                Text("点账号或会话调出客户端，右键查看更多操作。分组可收起；分组、账号可拖动排序。会话整行可拖动，仅限同一账号、同一状态分区。")
            }
            item("额度", symbol: "gauge.with.dots.needle.50percent") {
                Text("百分比为已用额度，悬停查看剩余。打开面板会同步，也可手动刷新。")
                Text("同步失败时保留缓存；标记表示记录时间，悬停警示查看原因。")
                    .foregroundStyle(.secondary)
            }
            item("文档接力", symbol: "doc.on.clipboard") {
                Text("右键已停下的任务 → 接力到…，在源对话粘贴提示词。文档生成后回到面板点“继续接力”，再到目标新对话粘贴发送。")
            }
            item("桌面入口", symbol: "pawprint") {
                Text("在设置开启原生浮球，爪印控制显示与隐藏。单击打开面板，双击调出忙碌账号，拖动换位置。始终保持系统外观。")
            }
            Divider()
            PanelDisclosure("数据与限制") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("平时只读任务元数据。接力仅处理指定的交接文档，不提取或自动发送聊天；副本保存在本机。")
                    Text("Claude 额度使用对应账号授权，仅在内存中使用。首次手动同步可能需要钥匙串授权；后台不弹提示。")
                    Text("Codex 单实例可直接定位对话；多实例时只调出所属客户端。Claude 目前只调出客户端，需自行选择会话。")
                    Text("Claude 桌面会话按账号目录读取。“Code”表示本机 Claude Code 历史，仅显示在默认客户端卡片；其登录账号可能与桌面客户端不同。")
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
