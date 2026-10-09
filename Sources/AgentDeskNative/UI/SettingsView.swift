import AppKit
import SwiftUI
import AgentDeskNativeCore

struct SettingsView: View {
    @ObservedObject var desk: AgentDeskNativeModel
    @ObservedObject var pet: PetModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("开启桌宠", isOn: Binding(get: { pet.enabled }, set: { pet.setEnabled($0) }))
                    .toggleStyle(.switch)
                if pet.enabled {
                    Text("静态浮球，保持 macOS 原生外观。爪印控制显示与隐藏；可拖动定位，单击打开面板。")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }

            }
            .font(.system(size: 11))
            VStack(alignment: .leading, spacing: 8) {
                Toggle("自动同步额度（每 5 分钟）", isOn: $desk.automaticallySyncQuota)
                    .toggleStyle(.switch)
                Button(desk.refreshingQuotas.isEmpty ? "立即同步所有账号" : "正在同步…") {
                    desk.refreshQuotas(manual: true)
                }
                .disabled(!desk.refreshingQuotas.isEmpty)
                Text("打开面板也会同步；账号旁的刷新按钮可立即重试。后台同步不会弹出钥匙串授权，遇到限流会延后重试。")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .font(.system(size: 11))
            if !desk.skippedImports.isEmpty {
                Text("从 agent-desk 导入时跳过了：\(desk.skippedImports.joined(separator: "、"))。AgentDesk Native 只支持 Codex 和 Claude。")
                    .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if desk.accounts.filter({ $0.app == .claude }).count > 1 {
                Text("Claude 的本地 Code 会话不区分账号，统一显示在第一个 Claude 账号下。")
                    .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Text("文档接力").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                Spacer()
                Button("打开交接文件夹") { desk.revealHandoffs() }.buttonStyle(.plain).font(.system(size: 11))
            }
            Text(desk.handoffs.directory.path).font(.system(size: 10)).foregroundStyle(.secondary)
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if !desk.handoffLog.isEmpty { HandoffHistoryView(desk: desk) }
            Text("平时读取任务元数据、会话标题和工作目录。接力只复制你选择的交接文档，不提取聊天正文；请在目标新对话手动粘贴并发送。文档只保存在本机。查询 Claude 额度时会读取对应客户端的登录授权，仅在内存中使用，不保存到 AgentDesk Native 文件或日志。")
                .font(.system(size: 10)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("退出 AgentDesk Native") { NSApp.terminate(nil) }
            }
        }
    }
}
