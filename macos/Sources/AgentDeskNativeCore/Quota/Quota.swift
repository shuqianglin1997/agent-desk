import Foundation

/// One rate-limit window, such as the 5-hour or the weekly one.
public struct QuotaWindow: Equatable {
    public let minutes: Int
    /// Clamped to 0...100.
    public let usedPercent: Double
    public let resetsAt: Date?

    public init(minutes: Int, usedPercent: Double, resetsAt: Date?) {
        self.minutes = minutes
        self.usedPercent = min(max(usedPercent, 0), 100)
        self.resetsAt = resetsAt
    }

    /// Named by length: Codex reports the weekly window as `primary` on plans that have only that one.
    public var label: String {
        switch minutes {
        case 300: return "5h"
        case 10080: return "周"
        case let value where value % 1440 == 0: return "\(value / 1440)天"
        case let value where value % 60 == 0: return "\(value / 60)h"
        default: return "\(minutes)分"
        }
    }

    /// A cached value whose window has already rolled over says nothing about current use.
    public func hasReset(now: Date) -> Bool { resetsAt.map { $0 <= now } ?? false }
}

public enum QuotaValue: Equatable {
    case windows([QuotaWindow])
    /// No limit applies; the text explains why and is shown as help.
    case unlimited(String)
    case signedOut
    case noData
}

public enum QuotaParser {
    /// Reads a `{primary, secondary}` bucket in the app-server's camelCase or the rollout's snake_case.
    public static func windows(_ bucket: [String: Any]?) -> [QuotaWindow] {
        guard let bucket else { return [] }
        return ["primary", "secondary"].compactMap { key -> QuotaWindow? in
            guard let window = bucket[key] as? [String: Any],
                  let used = number(window["usedPercent"] ?? window["used_percent"]),
                  let minutes = number(window["windowDurationMins"] ?? window["window_minutes"]),
                  used.isFinite, minutes.isFinite, minutes > 0, minutes < 1e7 else { return nil }
            let resets = number(window["resetsAt"] ?? window["resets_at"]).map { Date(timeIntervalSince1970: $0) }
            return QuotaWindow(minutes: Int(minutes), usedPercent: used, resetsAt: resets)
        }
        .sorted { $0.minutes < $1.minutes }
    }

    public static func planType(_ bucket: [String: Any]?) -> String? {
        (bucket?["planType"] ?? bucket?["plan_type"]) as? String
    }

    /// Classifies a live answer. `accountResult` is the `account/read` result and `rateLimits` the
    /// `account/rateLimits/read` result; either is nil when that request failed.
    /// Returns nil when the answer cannot be trusted, so the caller reports a failed live query.
    public static func classify(accountResult: [String: Any]?, rateLimits: [String: Any]?) -> QuotaValue? {
        // `rateLimits` and `rateLimitsByLimitId.codex` describe the same windows; use one, never both.
        let bucket = (rateLimits?["rateLimits"] as? [String: Any])
            ?? ((rateLimits?["rateLimitsByLimitId"] as? [String: Any])?["codex"] as? [String: Any])
        let found = windows(bucket)
        // Real windows are stronger evidence than the optional account metadata.
        if !found.isEmpty { return .windows(found) }
        guard let accountResult else { return nil }
        guard let account = accountResult["account"] as? [String: Any] else { return .signedOut }
        if account["type"] as? String == "apiKey" {
            return .unlimited("这个账号用 API Key 按量计费，没有订阅额度")
        }
        let plan = (account["planType"] as? String) ?? planType(bucket) ?? ""
        if ["enterprise", "team", "business"].contains(where: { plan.lowercased().hasPrefix($0) }) {
            return .unlimited("\(plan) 套餐没有返回限额窗口")
        }
        return rateLimits == nil ? nil : .noData
    }

    static func number(_ value: Any?) -> Double? { (value as? NSNumber)?.doubleValue }
}

public enum QuotaFormat {
    /// How long ago a cached value was observed.
    public static func age(_ date: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "刚刚" }
        if seconds < 3600 { return "\(Int(seconds / 60)) 分钟前" }
        if seconds < 86400 { return "\(Int(seconds / 3600)) 小时前" }
        return "\(Int(seconds / 86400)) 天前"
    }

    /// A reset time: the clock time when it is today, otherwise the date.
    public static func reset(_ date: Date, now: Date, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = calendar.isDate(date, inSameDayAs: now) ? "HH:mm" : "M/d"
        return formatter.string(from: date)
    }

    /// The time remaining before a reset, or its weekday and time for a wait of at least 24 hours.
    public static func resetCountdown(_ date: Date, now: Date, calendar: Calendar = .current) -> String {
        let remaining = date.timeIntervalSince(now)
        guard remaining > 0 else { return "已重置" }
        if remaining < 60 { return "不到1分钟后重置" }
        if remaining < 86400 {
            let minutes = Int(remaining / 60)
            let hours = minutes / 60
            if hours == 0 { return "\(minutes)分钟后重置" }
            let remainder = minutes % 60
            return remainder == 0 ? "\(hours)小时后重置" : "\(hours)小时\(remainder)分后重置"
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "EEE HH:mm"
        return "\(formatter.string(from: date)) 重置"
    }

    /// An exact reset time, including its date and time zone, for the window's hover help.
    public static func resetTimestamp(_ date: Date, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd EEEE HH:mm:ss ZZZZZ"
        return formatter.string(from: date)
    }
}
