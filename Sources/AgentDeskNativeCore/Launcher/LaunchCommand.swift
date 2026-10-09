import Foundation

public enum LaunchError: LocalizedError, Equatable {
    case unsafeAliasRoot, aliasConflict, aliasTooLong, openFailed(String)
    public var errorDescription: String? {
        switch self {
        case .unsafeAliasRoot: return "短路径目录不安全（不是本人拥有的普通目录）"
        case .aliasConflict: return "短路径位置已被其他文件占用"
        case .aliasTooLong: return "短路径仍然超过 104 字节"
        case .openFailed(let text): return text.isEmpty ? "open 命令失败" : text
        }
    }
}

/// `/usr/bin/open -n -a <app> [--env CODEX_HOME=…] --args --user-data-dir=<profile>`
public struct LaunchCommand: Equatable {
    public let arguments: [String]
    public var executable: String { "/usr/bin/open" }

    public static func make(appBundle: String, account: Account, codexHome: String?) -> LaunchCommand {
        var arguments = ["-n", "-a", appBundle]
        if account.app == .codex, let codexHome { arguments += ["--env", "CODEX_HOME=\(codexHome)"] }
        arguments += ["--args", "--user-data-dir=\(account.profilePath)"]
        return LaunchCommand(arguments: arguments)
    }

    public func run() throws {
        let process = Process()
        let errors = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let text = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            throw LaunchError.openFailed(text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
}
