import SwiftUI
import AgentDeskNativeCore

struct HandoffHistoryView: View {
    @ObservedObject var desk: AgentDeskNativeModel
    @State private var expanded = false
    private static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("接力记录").font(.system(size: 11, weight: .semibold))
            if expanded {
                ScrollView { records }
                    .frame(maxHeight: 220)
            } else { records }
            if desk.handoffLog.count > 5 {
                Button(expanded ? "收起" : "查看其余 \(desk.handoffLog.count - 5) 条") { expanded.toggle() }
                    .buttonStyle(.plain).font(.system(size: 11))
            }
        }
    }

    private var records: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(desk.handoffLog.prefix(expanded ? desk.handoffLog.count : 5))) { entry in
                HStack(alignment: .top, spacing: 8) {
                    Button { desk.openHandoff(entry) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(Self.time.string(from: entry.time))  \(entry.source) → \(entry.target)")
                                .font(.system(size: 11)).foregroundStyle(.primary)
                            Text("\(entry.result)")
                                .font(.system(size: 10)).foregroundStyle(.secondary)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("定位交接文档；无文件时尝试调出原会话所属账号，否则打开交接文件夹")
                    Button(role: .destructive) { desk.deleteHandoff(entry) } label: {
                        Image(systemName: "trash").font(.system(size: 11))
                    }
                    .buttonStyle(.plain).foregroundStyle(.secondary)
                    .help("删除这条记录，保留交接文档")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
