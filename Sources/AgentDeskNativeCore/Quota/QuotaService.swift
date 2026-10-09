import Foundation

/// What the panel shows for one account's quota.
public struct QuotaDisplay: Equatable {
    public var value: QuotaValue?
    public var observedAt: Date?
    /// Local history or a last-known value retained after a failed live query.
    public var cached: Bool
    /// Why the last live query failed; nil when it succeeded or has not finished.
    public var liveFailure: String?
    public var liveFailed: Bool { liveFailure != nil }
    /// Identifies Claude so missing cached windows can be labelled without affecting Codex.
    public var isClaude: Bool

    public init(value: QuotaValue?, observedAt: Date?, cached: Bool, liveFailure: String?, isClaude: Bool = false) {
        self.value = value; self.observedAt = observedAt; self.cached = cached; self.liveFailure = liveFailure
        self.isClaude = isClaude
    }

    /// A Claude account: the newest usage the desktop client recorded, or nothing found.
    public static func claude(_ cache: CachedQuota?) -> QuotaDisplay {
        QuotaDisplay(value: cache.map { .windows($0.windows) }, observedAt: cache?.observedAt, cached: true,
                     liveFailure: nil, isClaude: true)
    }

    public static let empty = QuotaDisplay(value: nil, observedAt: nil, cached: true, liveFailure: nil)

    /// Shows a cached value, unless a live value at least as new is already showing.
    public static func withCache(_ current: QuotaDisplay?, _ cache: CachedQuota?) -> QuotaDisplay? {
        guard let cache else { return current }
        if let current, (current.observedAt ?? .distantPast) >= cache.observedAt { return current }
        return QuotaDisplay(value: .windows(cache.windows), observedAt: cache.observedAt, cached: true,
                            liveFailure: current?.liveFailure)
    }

    public func applyingClaude(_ live: Result<QuotaValue, ClaudeQuota.Failure>, now: Date) -> QuotaDisplay {
        switch live {
        case .success(let value):
            return QuotaDisplay(value: value, observedAt: now, cached: false, liveFailure: nil, isClaude: true)
        case .failure(let failure):
            var copy = self
            copy.liveFailure = failure.reason
            if copy.value != nil { copy.cached = true }
            return copy
        }
    }

    /// A live success replaces what is shown; a failure keeps it and records why.
    public func applying(_ live: Result<QuotaValue, CodexAppServer.Failure>, now: Date) -> QuotaDisplay {
        switch live {
        case .success(let value):
            return QuotaDisplay(value: value, observedAt: now, cached: false, liveFailure: nil)
        case .failure(let failure):
            var copy = self
            copy.liveFailure = failure.reason
            if copy.value != nil { copy.cached = true }
            return copy
        }
    }
}

/// At most one live query per account per interval. An attempt counts when it starts, so a slow query
/// is never started twice.
public struct QuotaThrottle {
    public let interval: TimeInterval
    private var last: [String: Date] = [:]

    public init(interval: TimeInterval = 300) { self.interval = interval }

    public mutating func reset(_ id: String) { last[id] = nil }

    public mutating func allow(_ id: String, now: Date) -> Bool {
        if let previous = last[id], now.timeIntervalSince(previous) < interval { return false }
        last[id] = now
        return true
    }
}

public enum CodexQuota {
    /// Blocking: runs the account's Codex app-server for up to 10 seconds. Call off the main thread.
    public static func live(_ account: Account) -> Result<QuotaValue, CodexAppServer.Failure> {
        guard let cli = CodexCLI.locate() else { return .failure(.notFound) }
        switch CodexAppServer.query(cli: cli, codexHome: account.sessionRoot) {
        case .failure(let failure):
            return .failure(failure)
        case .success(let answer):
            guard let value = QuotaParser.classify(accountResult: answer.account, rateLimits: answer.rateLimits) else {
                return .failure(.unreadable)
            }
            return .success(value)
        }
    }
}
