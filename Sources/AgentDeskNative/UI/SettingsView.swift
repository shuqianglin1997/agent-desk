import AppKit
import SwiftUI
import AgentDeskNativeCore

struct SettingsView: View {
    @ObservedObject var desk: AgentDeskNativeModel
    @ObservedObject var pet: PetModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            section("桌面入口") {
                Toggle("桌宠", isOn: Binding(get: { pet.enabled }, set: { pet.setEnabled($0) }))
                    .toggleStyle(.switch)
                if pet.enabled {
                    Text("静态浮球 · 系统外观").foregroundStyle(.secondary)
                }
            }
            Divider()
            section("额度") {
                Toggle("自动同步", isOn: $desk.automaticallySyncQuota)
                    .toggleStyle(.switch)
                    .help("每 5 分钟同步；后台不会弹出钥匙串授权")
                HStack {
                    Text("每 5 分钟").foregroundStyle(.secondary)
                    Spacer()
                    Button(desk.refreshingQuotas.isEmpty ? "立即同步" : "同步中…") {
                        desk.refreshQuotas(manual: true)
                    }
                    .disabled(!desk.refreshingQuotas.isEmpty)
                    .help("同步所有账号；也可在账号旁单独刷新")
                }
            }
            Divider()
            section("文档接力") {
                Button { desk.revealHandoffs() } label: {
                    Label("打开交接文件夹", systemImage: "folder")
                }
                .buttonStyle(.plain)
                .help(desk.handoffs.directory.path)
                if !desk.handoffLog.isEmpty { HandoffHistoryView(desk: desk) }
            }
            Divider()
            HStack {
                Spacer()
                Button("退出 AgentDesk Native") { NSApp.terminate(nil) }
            }
        }
        .font(.system(size: 11))
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).fontWeight(.semibold).foregroundStyle(.secondary)
            content()
        }
    }
}
