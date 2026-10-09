import Foundation

public struct RunningProcess: Equatable {
    public let pid: Int32
    public let args: String
    public init(pid: Int32, args: String) { self.pid = pid; self.args = args }
}

/// Identifies which client process belongs to an account by its exact `--user-data-dir` argument.
/// This also sees clients started by agent-desk or by hand. Arguments are only held in memory.
public enum ProcessMatcher {
    /// Parses `ps -axww -o pid=,args=` output.
    public static func parse(_ text: String) -> [RunningProcess] {
        text.split(separator: "\n").compactMap { line in
            let trimmed = line.drop { $0 == " " }
            guard let space = trimmed.firstIndex(of: " "), let pid = Int32(trimmed[..<space]) else { return nil }
            return RunningProcess(pid: pid, args: String(trimmed[trimmed.index(after: space)...]))
        }
    }

    /// The main (non-helper) app process started with exactly this user-data-dir (so `open`/`grep` lines never match).
    /// For a client's own default data dir, a main process started without any `--user-data-dir` (Dock, Finder) also counts.
    public static func owner(of profilePath: String, in processes: [RunningProcess],
                             home: String = NSHomeDirectory()) -> RunningProcess? {
        let flag = "--user-data-dir=\(profilePath)"
        let defaultExecutables = defaultDataDirs(home: home)[profilePath] ?? []
        return processes.first { process in
            guard !process.args.contains(" --type="), !process.args.contains("crashpad_handler") else { return false }
            guard let range = process.args.range(of: flag) else {
                return !process.args.contains("--user-data-dir=")
                    && defaultExecutables.contains { process.args.contains($0) }
            }
            guard process.args[..<range.lowerBound].contains(".app/Contents/MacOS/") else { return false }
            return range.upperBound == process.args.endIndex || process.args[range.upperBound] == " "
        }
    }

    /// Where each client keeps its data when started without `--user-data-dir`, and its main executables.
    public static func defaultDataDirs(home: String = NSHomeDirectory()) -> [String: [String]] {
        [
            AppKind.codex.defaultProfilePath(home: home):
                ["/ChatGPT.app/Contents/MacOS/ChatGPT", "/Codex.app/Contents/MacOS/Codex"],
            AppKind.claude.defaultProfilePath(home: home): ["/Claude.app/Contents/MacOS/Claude"]
        ]
    }

    /// Returns nil when `ps` cannot run; callers then treat every client as not running.
    public static func snapshot() -> [RunningProcess]? {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axww", "-o", "pid=,args="]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 4, execute: timeout)
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        timeout.cancel()
        guard process.terminationReason == .exit, process.terminationStatus == 0 else { return nil }
        return parse(String(decoding: data, as: UTF8.self))
    }
}
