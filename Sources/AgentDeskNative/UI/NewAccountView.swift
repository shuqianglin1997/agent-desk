import SwiftUI
import AgentDeskNativeCore

struct NewAccountView: View {
    @ObservedObject var desk: AgentDeskNativeModel
    let close: () -> Void
    @State private var name = ""
    @State private var app: AppKind = .codex

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("客户端", selection: $app) {
                ForEach(AppKind.allCases, id: \.self) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)
            TextField("名称，例如 Omnix", text: $name).textFieldStyle(.roundedBorder)
            Text("创建后会立刻启动一次客户端，请在里面登录。").font(.system(size: 11)).foregroundStyle(.secondary)
            HStack {
                Button("取消", action: close)
                Spacer()
                Button("创建并启动") { if desk.create(name: name, app: app) { close() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }
}
