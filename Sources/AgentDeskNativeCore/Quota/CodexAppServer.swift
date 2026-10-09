import Foundation

/// Asks one account's Codex for its plan and rate limits over the app-server JSON-RPC protocol on stdio.
public enum CodexAppServer {
    public struct Answer {
        /// `account/read` result reduced to `requiresOpenaiAuth` and `account.{type, planType}`; nil if it failed.
        public var account: [String: Any]?
        /// `account/rateLimits/read` result; nil if it failed (API-key accounts always fail here).
        public var rateLimits: [String: Any]?
    }

    public enum Failure: Error, Equatable {
        case notFound, startFailed, timedOut, exited, initializeFailed, unreadable

        public var reason: String {
            switch self {
            case .notFound: return "找不到 Codex 命令行工具"
            case .startFailed: return "Codex 命令行工具无法启动"
            case .timedOut: return "查询超时（10 秒）"
            case .exited: return "Codex 提前退出"
            case .initializeFailed: return "这个版本的 Codex 不支持额度查询"
            case .unreadable: return "Codex 没有返回可识别的额度"
            }
        }
    }

    /// Protocol state: initialize → (initialized, account/read, account/rateLimits/read) → both answers.
    struct Exchange {
        static let initialize: [String: Any] = ["id": 1, "method": "initialize", "params": [
            "clientInfo": ["name": "agentdesk-native", "title": "AgentDesk Native", "version": "1"],
            "capabilities": ["optOutNotificationMethods": [String]()]]]

        private var answer = Answer()
        private var accountDone = false, limitsDone = false

        /// Returns the messages to send next, and the outcome once it is known.
        mutating func receive(_ message: [String: Any]) -> (send: [[String: Any]], done: Result<Answer, Failure>?) {
            guard let id = (message["id"] as? NSNumber)?.intValue else { return ([], nil) }   // a notification
            switch id {
            case 1:
                if message["error"] != nil { return ([], .failure(.initializeFailed)) }
                return ([["method": "initialized"],
                         ["id": 2, "method": "account/read", "params": ["refreshToken": false]],
                         ["id": 3, "method": "account/rateLimits/read", "params": NSNull()]], nil)
            case 2:
                accountDone = true
                answer.account = (message["result"] as? [String: Any]).map(Self.withoutIdentity)
            case 3:
                limitsDone = true
                answer.rateLimits = message["result"] as? [String: Any]
            default:
                return ([], nil)
            }
            return ([], accountDone && limitsDone ? .success(answer) : nil)
        }

        /// Keeps only what classification needs; the email and other identity fields are dropped at once.
        private static func withoutIdentity(_ result: [String: Any]) -> [String: Any] {
            var kept: [String: Any] = ["requiresOpenaiAuth": result["requiresOpenaiAuth"] as? Bool ?? false]
            if let account = result["account"] as? [String: Any] {
                kept["account"] = account.filter { $0.key == "type" || $0.key == "planType" }
            }
            return kept
        }
    }

    private final class OutcomeBox { var result: Result<Answer, Failure>? }

    /// Serialises writes to the child's stdin with closing it; once closed, sends are no-ops.
    private final class StdinWriter {
        private let handle: FileHandle
        private let lock = NSLock()
        private var closed = false
        init(_ handle: FileHandle) { self.handle = handle }

        func send(_ message: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
            lock.lock(); defer { lock.unlock() }
            if !closed { try? handle.write(contentsOf: data + Data([10])) }
        }

        func close() {
            lock.lock(); defer { lock.unlock() }
            if !closed { closed = true; try? handle.close() }
        }
    }
    private static let ignoreBrokenPipe: Void = { signal(SIGPIPE, SIG_IGN) }()

    /// Starts `codex app-server`, runs the exchange and ends the process. Blocks for at most `timeout` seconds.
    public static func query(cli: String, codexHome: String, timeout: TimeInterval = 10) -> Result<Answer, Failure> {
        _ = ignoreBrokenPipe   // a child that exits early must not take AgentDeskNative down with SIGPIPE
        let process = Process()
        process.executableURL = URL(fileURLWithPath: cli)
        process.arguments = ["app-server", "--listen", "stdio://"]
        var environment = ProcessInfo.processInfo.environment
        environment["CODEX_HOME"] = codexHome
        process.environment = environment
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice   // may contain local paths; never read
        do { try process.run() } catch { return .failure(.startFailed) }

        let writer = StdinWriter(input.fileHandleForWriting)
        let send = writer.send
        send(Exchange.initialize)

        let box = OutcomeBox()
        let finished = DispatchSemaphore(value: 0)
        let reader = output.fileHandleForReading
        DispatchQueue.global(qos: .utility).async {
            defer { finished.signal() }
            var exchange = Exchange(), buffer = Data()
            while true {
                let chunk = reader.availableData
                if chunk.isEmpty { box.result = .failure(.exited); return }   // end of file: the process quit
                buffer.append(chunk)
                if buffer.count > 4 << 20 { box.result = .failure(.unreadable); return }
                while let end = buffer.firstIndex(of: 10) {
                    let line = Data(buffer[buffer.startIndex..<end])
                    buffer.removeSubrange(buffer.startIndex...end)
                    // Lines that are not JSON-RPC (logs) are skipped.
                    guard let message = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
                    let step = exchange.receive(message)
                    step.send.forEach(send)
                    if let done = step.done { box.result = done; return }
                }
            }
        }

        let waited = finished.wait(timeout: .now() + timeout)
        if process.isRunning { process.terminate() }
        let pid = process.processIdentifier
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1) {
            if process.isRunning { kill(pid, SIGKILL) }
        }
        // Closing stdin also on timeout gives a child that outlives the kill (e.g. a wrapper's
        // grandchild) EOF, so it exits, releases stdout and lets the reader finish.
        writer.close()
        if waited == .timedOut { return .failure(.timedOut) }
        return box.result ?? .failure(.exited)
    }
}
