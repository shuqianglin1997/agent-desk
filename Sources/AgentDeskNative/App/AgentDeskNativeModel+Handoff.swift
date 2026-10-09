import AppKit
import UniformTypeIdentifiers
import AgentDeskNativeCore

extension AgentDeskNativeModel {
    /// Select a document explicitly; AgentDeskNative does not read the conversation or ask an AI to write one.
    func handoff(_ row: SessionRow, from source: Account, to target: Account) {
        if let refusal = HandoffDocument.refusal(for: row.status) {
            message = refusal
            return
        }
        let panel = NSOpenPanel()
        panel.title = "选择交接文档 → \(target.name)"
        panel.message = "选择已准备好的 Markdown 文档。AgentDesk Native 保存副本并复制正文和绝对路径；请在目标账号新建对话、粘贴并发送。"
        panel.prompt = "复制交接文档"
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        NSApp.activate()
        guard panel.runModal() == .OK, let file = panel.url else { return }
        copyHandoff(file, row: row, from: source, to: target)
    }

    func revealHandoffs() {
        do {
            try FileManager.default.createDirectory(at: handoffs.directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            NSWorkspace.shared.open(handoffs.directory)
        } catch { message = "无法打开交接文件夹：\(error.localizedDescription)" }
    }

    func openHandoff(_ entry: HandoffLogEntry) {
        if let file = handoffs.document(for: entry) {
            NSWorkspace.shared.activateFileViewerSelecting([file])
        } else if let source = accounts.first(where: { $0.name == entry.source }),
                  let row = rows(for: source).first(where: { $0.id == entry.conversation }) {
            open(row, in: source)
        } else {
            revealHandoffs()
        }
    }

    func deleteHandoff(_ entry: HandoffLogEntry) {
        do {
            try handoffs.removeLogEntry(id: entry.id)
            handoffLog = handoffs.recentLog(limit: .max)
        } catch { message = "删除记录失败：\(error.localizedDescription)" }
    }

    private func copyHandoff(_ file: URL, row: SessionRow, from source: Account, to target: Account) {
        let handoffs = self.handoffs
        message = "正在复制交接文档…"
        let scoped = file.startAccessingSecurityScopedResource()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            defer { if scoped { file.stopAccessingSecurityScopedResource() } }
            let saved = Result { try handoffs.copyDocument(file, fileName: HandoffDocument.fileName(title: row.title, at: Date())) }
            DispatchQueue.main.async {
                guard let self else { return }
                switch saved {
                case .success(let document):
                    self.deliver(document.markdown, file: document.url, row: row, from: source, to: target, method: "文档接力")
                case .failure(let error):
                    self.notify(title: "交接文档复制失败", body: error.localizedDescription)
                    self.logHandoff(row: row, from: source, to: target, method: "文档接力", result: "失败：复制出错")
                }
            }
        }
    }

    /// Copies the document behind the fixed opening line, brings the target forward and records the handoff.
    private func deliver(_ markdown: String, file: URL, row: SessionRow, from source: Account, to target: Account, method: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(HandoffDocument.clipboard(markdown: markdown, savedAt: file), forType: .string)
        let done = "交接文档已复制到剪贴板，请在 \(target.name) 新建对话，粘贴并发送。绝对路径已附在文档顶部。"
        dismissMessage()
        launch(target) { [weak self] outcome in
            guard let self else { return }
            if case .failed = outcome {
                self.logHandoff(row: row, from: source, to: target, method: method, result: "文档已准备，目标启动失败", documentPath: file.path)
            } else {
                self.notify(title: "交接文档已复制", body: done)
                self.logHandoff(row: row, from: source, to: target, method: method, result: "文档已准备，待粘贴发送", documentPath: file.path)
            }
        }
    }

    private func logHandoff(row: SessionRow, from source: Account, to target: Account, method: String, result: String, documentPath: String? = nil) {
        let entry = HandoffLogEntry(time: Date(), source: source.name, target: target.name, conversation: row.id,
                                    method: method, result: result, documentPath: documentPath)
        do { try handoffs.appendLog(entry) } catch { notify(title: "接力记录写入失败", body: error.localizedDescription) }
        handoffLog = handoffs.recentLog(limit: .max)
    }
}
