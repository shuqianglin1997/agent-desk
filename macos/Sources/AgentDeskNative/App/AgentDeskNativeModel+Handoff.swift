import AppKit
import UniformTypeIdentifiers
import AgentDeskNativeCore

extension AgentDeskNativeModel {
    func handoff(_ row: SessionRow, from source: Account, to target: Account) {
        if let refusal = HandoffDocument.refusal(for: row.status) { message = refusal; return }
        if let pending = pendingHandoff {
            guard pending.sourceID == source.id, pending.targetID == target.id,
                  pending.conversationID == row.id else {
                message = "已有待继续的接力，请先完成或取消。"; return
            }
            copyPreparationPrompt()
            return
        }
        do {
            pendingHandoff = try handoffs.prepare(sourceID: source.id, targetID: target.id,
                                                  conversationID: row.id, title: row.title)
            copyPreparationPrompt()
        } catch { message = "无法准备接力：\(error.localizedDescription)" }
    }

    func copyPreparationPrompt() {
        guard let pending = pendingHandoff,
              let source = accounts.first(where: { $0.id == pending.sourceID }) else {
            message = "源账号已不存在，请取消这次接力。"; return
        }
        let prompt = HandoffDocument.preparationPrompt(savedAt: handoffs.preparedURL(for: pending))
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(prompt, forType: .string) else {
            message = "提示词复制失败，请重试。"; return
        }
        let ready: (LaunchOutcome) -> Void = { [weak self] outcome in
            guard case .failed = outcome else {
                self?.notify(title: "交接提示词已复制", body: "请确认原任务对话，粘贴并发送提示词。文档生成后回到 AgentDesk Native，点击“继续接力”。")
                return
            }
            self?.message = "提示词已复制，但源账号未打开；请手动打开原对话粘贴发送。"
        }
        if let row = rows(for: source).first(where: { $0.id == pending.conversationID }) {
            open(row, in: source, then: ready)
        } else { launch(source, then: ready) }
    }

    func cancelHandoffPreparation() {
        guard !completingHandoff, let pending = pendingHandoff else { return }
        do {
            try handoffs.clearPreparation(id: pending.id)
            pendingHandoff = nil
        } catch { message = "取消接力失败：\(error.localizedDescription)" }
    }

    func continueHandoff() {
        guard let pending = pendingHandoff, !completingHandoff else { return }
        copyHandoff(preparation: pending, existingFile: nil)
    }

    func useExistingHandoffDocument() {
        guard let pending = pendingHandoff, !completingHandoff else { return }
        let panel = NSOpenPanel()
        panel.title = "使用已有交接文档"
        panel.message = "选择 Markdown 文档，复制后到目标新对话粘贴发送。"
        panel.prompt = "继续接力"
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = handoffs.preparedURL(for: pending).deletingLastPathComponent()
        NSApp.activate()
        guard panel.runModal() == .OK, let file = panel.url else { return }
        copyHandoff(preparation: pending, existingFile: file)
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

    private func copyHandoff(preparation: HandoffPreparation, existingFile: URL?) {
        guard let source = accounts.first(where: { $0.id == preparation.sourceID }),
              let target = accounts.first(where: { $0.id == preparation.targetID }) else {
            message = "接力账号已不存在，请取消后重新选择。"; return
        }
        if rows(for: source).first(where: { $0.id == preparation.conversationID })?.isActive == true {
            message = "源任务仍在进行中。请等交接文档写完、任务停下后再继续。"; return
        }
        completingHandoff = true
        let handoffs = self.handoffs
        let scoped = existingFile?.startAccessingSecurityScopedResource() ?? false
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            defer { if scoped { existingFile?.stopAccessingSecurityScopedResource() } }
            let saved = Result {
                if let file = existingFile {
                    return try handoffs.copyDocument(file, fileName: HandoffDocument.fileName(title: preparation.title, at: Date()))
                }
                return try handoffs.copyPreparedDocument(preparation)
            }
            DispatchQueue.main.async {
                guard let self else { return }
                switch saved {
                case .success(let document):
                    self.deliver(document.markdown, file: document.url, preparation: preparation, from: source, to: target)
                case .failure(let error):
                    self.completingHandoff = false
                    self.message = error.localizedDescription
                }
            }
        }
    }

    private func deliver(_ markdown: String, file: URL, preparation: HandoffPreparation, from source: Account, to target: Account) {
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(HandoffDocument.clipboard(markdown: markdown, savedAt: file), forType: .string) else {
            completingHandoff = false; message = "交接内容复制失败，请重试。"; return
        }
        dismissMessage()
        launch(target) { [weak self] outcome in
            guard let self else { return }
            self.completingHandoff = false
            let result: String
            if case .failed = outcome {
                result = "文档已准备，目标启动失败"
            } else {
                result = "文档已准备，待粘贴发送"
                do {
                    try self.handoffs.clearPreparation(id: preparation.id)
                    if self.pendingHandoff?.id == preparation.id { self.pendingHandoff = nil }
                } catch { self.message = "待接力状态清除失败：\(error.localizedDescription)" }
                self.notify(title: "交接文档已复制", body: "请在 \(target.name) 新建对话，粘贴并发送。正文和绝对路径均已复制。")
            }
            let entry = HandoffLogEntry(time: Date(), source: source.name, target: target.name,
                conversation: preparation.conversationID, method: "文档接力", result: result, documentPath: file.path)
            do { try self.handoffs.appendLog(entry) }
            catch { self.notify(title: "接力记录写入失败", body: error.localizedDescription) }
            self.handoffLog = self.handoffs.recentLog(limit: .max)
        }
    }
}
