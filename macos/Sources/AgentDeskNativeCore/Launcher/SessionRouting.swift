import Foundation

public enum OpenAction: Equatable {
    case openURL(URL)
    case activateOnly
}

/// Multi-instance deep links cannot reliably target the selected account.
public enum SessionRouting {
    public static func codex(threadID: String, runningCodexInstances: Int) -> OpenAction {
        guard let url = SessionPolicy.threadURL(threadID) else { return .activateOnly }
        return runningCodexInstances <= 1 ? .openURL(url) : .activateOnly
    }
}
