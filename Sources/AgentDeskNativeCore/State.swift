import Foundation

public enum TaskStatus: String {
    case running, completed, failed, interrupted, waiting, unknown
    /// Running or waiting for the user: shown above finished conversations.
    public var isActive: Bool { self == .running || self == .waiting }
    public var label: String {
        switch self {
        case .running: return "进行中"
        case .completed: return "已完成"
        case .failed: return "遇到问题"
        case .interrupted: return "已中断"
        case .waiting: return "等你回应"
        case .unknown: return "无记录"
        }
    }
}

public struct CodexTask: Identifiable, Equatable {
    public let scope = "session"
    public let id: String
    public let title: String
    public let status: TaskStatus
    public let turnID: String
    public let updatedAt: Date
    public let source: String
    /// The session's rollout jsonl, used only for "copy path" and "show in Finder". Never read during polling.
    public let rolloutPath: String?
    public init(id: String, title: String, status: TaskStatus, turnID: String, updatedAt: Date, source: String,
                rolloutPath: String? = nil) {
        self.id = id; self.title = title; self.status = status; self.turnID = turnID
        self.updatedAt = updatedAt; self.source = source; self.rolloutPath = rolloutPath
    }
}

public struct CodexSnapshot: Equatable {
    public let scope = "session"
    public var tasks: [CodexTask]
    public var available: Bool
    public var detail: String
    public init(tasks: [CodexTask] = [], available: Bool = false, detail: String = "正在连接 Codex") {
        self.tasks = tasks; self.available = available; self.detail = detail
    }
}

public enum SessionPolicy {
    public static func threadURL(_ id: String) -> URL? {
        guard UUID(uuidString: id) != nil else { return nil }
        return URL(string: "codex://threads/\(id)")
    }

    public static func status(raw: String?, updatedAt: Date, now: Date, appRunning: Bool, waiting: Bool) -> TaskStatus {
        if raw == "completed" { return .completed }
        if raw == "failed" { return .failed }
        if raw == "interrupted" { return .interrupted }
        guard raw == "inProgress" || raw == "running" else { return .unknown }
        // A turn that never finished while its app is gone (or long stale) was cut off. Never call it completed.
        guard appRunning, now.timeIntervalSince(updatedAt) < 30 * 60 else { return .interrupted }
        return waiting ? .waiting : .running
    }
}
