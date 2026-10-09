import Foundation

public enum OpenAction: Equatable {
    case openURL(URL)
    case activateOnly
}

/// Decides whether clicking a conversation may also open a deep link after the account's client is in front.
/// Values come from probe T1 (`docs/probes/2026-10-t1.md`). Until proven, only the client is brought forward.
public enum SessionRouting {
    /// Whether `codex://threads/<id>` goes to the frontmost Codex instance when several are running.
    public static let codexURLFollowsFrontInstance = false
    /// Link format that opens a Claude Code session, with `{id}` for the session UUID; nil when unsupported.
    public static let claudeSessionURLTemplate: String? = nil

    public static func codex(threadID: String, runningCodexInstances: Int) -> OpenAction {
        guard let url = SessionPolicy.threadURL(threadID) else { return .activateOnly }
        return runningCodexInstances <= 1 || codexURLFollowsFrontInstance ? .openURL(url) : .activateOnly
    }

    public static func claude(sessionID: String) -> OpenAction {
        guard let template = claudeSessionURLTemplate, UUID(uuidString: sessionID) != nil,
              let url = URL(string: template.replacingOccurrences(of: "{id}", with: sessionID.lowercased())) else {
            return .activateOnly
        }
        return .openURL(url)
    }
}
