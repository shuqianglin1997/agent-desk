import Foundation

/// Formatting shared by the manual document-copy workflow. No conversation or model is read.
public enum HandoffDocument {
    /// The fixed first line of what goes on the clipboard.
    public static let clipboardPreamble = "这是从另一个账号接力过来的任务，请先阅读下面的交接文档，核对实际环境与当前状态后继续。"
    /// Keep the body usable even if a receiving client cannot access the local file.
    public static func clipboard(markdown: String, savedAt file: URL) -> String {
        clipboardPreamble + "\n\n交接文档绝对路径：\n" + file.standardizedFileURL.path
            + "\n\n以下是文档正文；如无法读取文件，请使用这份正文。\n\n" + markdown
    }

    /// `<yyyyMMdd-HHmm>-<title><suffix>.md`, with characters unsafe in file names replaced by spaces.
    public static func fileName(title: String, at date: Date, suffix: String = "", calendar: Calendar = .current) -> String {
        let unsafe = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t")
        var clean = redactingEmails(title).components(separatedBy: unsafe).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        while clean.hasPrefix(".") { clean.removeFirst() }   // never a hidden file
        clean = String(clean.prefix(40)).trimmingCharacters(in: .whitespaces)
        if clean.isEmpty { clean = "对话" }
        return "\(format(date, "yyyyMMdd-HHmm", calendar))-\(clean)\(suffix).md"
    }

    /// A conversation that is still running or waiting for the owner cannot be handed off.
    public static func refusal(for status: TaskStatus) -> String? {
        status == .running || status == .waiting
            ? "这个对话还在进行中或在等你回应。请先在原账号里停下这个任务，再接力。" : nil
    }

    public static func redactingEmails(_ text: String) -> String {
        text.replacingOccurrences(of: #"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#,
                                  with: "[邮箱已隐藏]", options: .regularExpression)
    }

    static func format(_ date: Date, _ pattern: String, _ calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}
