import Foundation

/// Finds the `codex` command-line tool in the same order as agent-desk's `codexCliCandidates` (macOS part).
public enum CodexCLI {
    /// npm's name for this machine's architecture.
    public static var hostArch: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }

    public static func candidates(env: [String: String], home: String, arch: String = hostArch) -> [String] {
        var results: [String] = [], seen: Set<String> = [], packageRoots: [String] = []
        func add(_ path: String) { if seen.insert(path).inserted { results.append(path) } }
        func addRoot(_ root: String) { if !packageRoots.contains(root) { packageRoots.append(root) } }

        let explicit = env["AGENTDESK_NATIVE_CODEX_CLI"] ?? env["CODEX_CLI_PATH"]
        if let explicit { add(explicit) }
        for dir in (env["PATH"] ?? "").split(separator: ":").map(String.init) where !dir.isEmpty {
            add((dir as NSString).appendingPathComponent("codex"))
            let prefix = (dir as NSString).deletingLastPathComponent
            addRoot((prefix as NSString).appendingPathComponent("lib/node_modules/@openai/codex"))
        }
        add("\(home)/.local/bin/codex")
        add("\(home)/.npm-global/bin/codex")
        add("/opt/homebrew/bin/codex")
        add("/usr/local/bin/codex")
        // Recent ChatGPT desktop builds bundle Codex; older installs have Codex.app instead.
        add("/Applications/ChatGPT.app/Contents/Resources/codex")
        add("\(home)/Applications/ChatGPT.app/Contents/Resources/codex")
        add("/Applications/Codex.app/Contents/Resources/codex")
        add("\(home)/Applications/Codex.app/Contents/Resources/codex")
        for prefix in ["\(home)/.npm-global", "/opt/homebrew", "/usr/local"] {
            addRoot("\(prefix)/lib/node_modules/@openai/codex")
        }

        // Native binaries inside npm packages work without Node and Finder's reduced PATH, so they go first
        // (after an explicit override).
        let triple = arch == "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
        var native: [String] = []
        for root in packageRoots {
            for vendor in ["\(root)/node_modules/@openai/codex-darwin-\(arch)/vendor", "\(root)/vendor"] {
                let path = "\(vendor)/\(triple)/codex/codex"
                if seen.insert(path).inserted { native.append(path) }
            }
        }
        results.insert(contentsOf: native, at: explicit == nil ? 0 : 1)
        return results
    }

    public static func locate(env: [String: String] = ProcessInfo.processInfo.environment,
                              home: String = NSHomeDirectory(), arch: String = hostArch) -> String? {
        firstUsable(candidates(env: env, home: home, arch: arch))
    }

    /// The first candidate that is an executable file and not a Node script (AgentDeskNative has no Node runtime).
    public static func firstUsable(_ candidates: [String]) -> String? {
        let fm = FileManager.default
        return candidates.first { path in
            var isDirectory: ObjCBool = false
            guard fm.fileExists(atPath: path, isDirectory: &isDirectory), !isDirectory.boolValue,
                  fm.isExecutableFile(atPath: path) else { return false }
            let target = URL(fileURLWithPath: path).resolvingSymlinksInPath().pathExtension
            return target != "js" && target != "mjs"
        }
    }
}
