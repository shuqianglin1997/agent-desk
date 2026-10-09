import Foundation

/// Metadata for a user-driven handoff, never a transcript or a model request.
public struct HandoffPreparation: Codable, Equatable, Identifiable {
    public let id: UUID
    public let sourceID: String
    public let targetID: String
    public let conversationID: String
    public let title: String
    public let createdAt: Date

    public init(sourceID: String, targetID: String, conversationID: String, title: String, createdAt: Date = Date()) {
        id = UUID()
        self.sourceID = sourceID; self.targetID = targetID
        self.conversationID = conversationID; self.title = title; self.createdAt = createdAt
    }
}

extension HandoffDocument {
    public static func preparationPrompt(savedAt file: URL) -> String {
        """
        请为当前对话整理一份供另一位 agent 接手的 Markdown 交接文档。只整理交接，不继续执行原任务。

        请写入以下绝对路径（含空格，使用时请正确引用）：
        \(file.standardizedFileURL.path)

        按需包含四部分，无关项可省略：
        1. 目标与边界：最新用户要求、完成标准、关键约束和已授权范围。
        2. 当前状态：已完成与未完成事项、实际验证结果、失败及未验证项，明确区分。
        3. 接续上下文：工作目录绝对路径、关键文件或产物、影响下一步的决策；代码任务另注明当前分支／提交及未提交改动。
        4. 下一步：按优先级列出可执行步骤、真实阻塞及仍需用户决定的问题。

        以接手后能直接继续为准，通常 500–1000 字，简单任务更短；不要为凑字数扩写，也不要为压缩遗漏关键约束。用当前事实和必要路径／命令／结果代替聊天复述，省略无关背景、废弃方案、长日志、原始对话和凭据。不确定的标“未确认”；不要把测试通过写成已部署或已验收。

        写完后只回复文件路径和一行摘要。如无法写文件，请说明未写入并返回完整 Markdown，供我手动保存。
        """
    }
}

extension HandoffStore {
    private var preparationFile: URL { directory.appendingPathComponent("pending.json") }

    public enum PreparationError: LocalizedError {
        case alreadyPending, missingDocument
        public var errorDescription: String? {
            switch self {
            case .alreadyPending: return "已有待继续的接力，请先完成或取消。"
            case .missingDocument: return "交接文档尚未生成。请先在源对话发送提示词，等文档写入后再继续；也可使用已有文档。"
            }
        }
    }

    public func pendingPreparation() throws -> HandoffPreparation? {
        guard FileManager.default.fileExists(atPath: preparationFile.path) else { return nil }
        return try JSONDecoder().decode(HandoffPreparation.self, from: Data(contentsOf: preparationFile))
    }

    /// Preserve an unreadable pending record so it cannot permanently block new preparations.
    @discardableResult
    public func archivePreparationState() throws -> URL {
        let backup = directory.appendingPathComponent("pending-unreadable-\(UUID().uuidString).json")
        try FileManager.default.moveItem(at: preparationFile, to: backup)
        return backup
    }

    /// Allocate a unique private directory, but never create a pretend handoff document.
    public func prepare(sourceID: String, targetID: String, conversationID: String, title: String) throws -> HandoffPreparation {
        guard try pendingPreparation() == nil else { throw PreparationError.alreadyPending }
        let preparation = HandoffPreparation(sourceID: sourceID, targetID: targetID, conversationID: conversationID, title: title)
        try Self.makePrivateDirectory(directory)
        try Self.makePrivateDirectory(directory.appendingPathComponent("drafts"))
        try Self.makePrivateDirectory(preparedURL(for: preparation).deletingLastPathComponent())
        try JSONEncoder().encode(preparation).write(to: preparationFile, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: preparationFile.path)
        return preparation
    }

    public func preparedURL(for preparation: HandoffPreparation) -> URL {
        directory.appendingPathComponent("drafts/\(preparation.id.uuidString)/handoff.md").standardizedFileURL
    }

    public func copyPreparedDocument(_ preparation: HandoffPreparation) throws -> (url: URL, markdown: String) {
        let file = preparedURL(for: preparation)
        guard FileManager.default.fileExists(atPath: file.path) else { throw PreparationError.missingDocument }
        return try copyDocument(file, fileName: HandoffDocument.fileName(title: preparation.title, at: Date()))
    }

    /// Cancellation removes the pending state only; any document remains available.
    public func clearPreparation(id: UUID) throws {
        guard try pendingPreparation()?.id == id else { return }
        try FileManager.default.removeItem(at: preparationFile)
    }
}
