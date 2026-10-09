import SwiftUI

struct HandoffPreparationView: View {
    @ObservedObject var desk: AgentDeskNativeModel

    var body: some View {
        if let pending = desk.pendingHandoff {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Label("待继续接力", systemImage: "doc.on.clipboard").fontWeight(.semibold)
                    Spacer()
                    Menu {
                        Button("使用已有文档…") { desk.useExistingHandoffDocument() }
                        Button("打开交接文件夹") { desk.revealHandoffs() }
                        Button("取消接力", role: .destructive) { desk.cancelHandoffPreparation() }
                    } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).fixedSize()
                    .disabled(desk.completingHandoff)
                    .accessibilityLabel("接力选项")
                }
                Text(pending.title).lineLimit(1).help(pending.title)
                let source = desk.accounts.first { $0.id == pending.sourceID }?.name ?? "源账号已移除"
                let target = desk.accounts.first { $0.id == pending.targetID }?.name ?? "目标账号已移除"
                Text("\(source) → \(target)").lineLimit(1).foregroundStyle(.secondary)
                    .help("\(source) → \(target)")
                Text("在源对话粘贴提示词并发送，文档生成后继续。")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("复制提示词") { desk.copyPreparationPrompt() }
                    Spacer()
                    Button(desk.completingHandoff ? "准备中…" : "继续接力") { desk.continueHandoff() }
                }
                .disabled(desk.completingHandoff)
            }
            .font(.system(size: 11))
            .padding(10)
            .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}
