import XCTest
@testable import AgentDeskNativeCore

final class CodexCLITests: XCTestCase {
    func testCandidateOrderMatchesAgentDesk() {
        let list = CodexCLI.candidates(env: ["PATH": "/p/bin:/q/bin", "CODEX_CLI_PATH": "/x/codex"], home: "/h", arch: "arm64")
        let native = { (root: String) in [
            "\(root)/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex",
            "\(root)/vendor/aarch64-apple-darwin/codex/codex"] }
        let expected = ["/x/codex"]
            + native("/p/lib/node_modules/@openai/codex") + native("/q/lib/node_modules/@openai/codex")
            + native("/h/.npm-global/lib/node_modules/@openai/codex")
            + native("/opt/homebrew/lib/node_modules/@openai/codex") + native("/usr/local/lib/node_modules/@openai/codex")
            + ["/p/bin/codex", "/q/bin/codex", "/h/.local/bin/codex", "/h/.npm-global/bin/codex",
               "/opt/homebrew/bin/codex", "/usr/local/bin/codex",
               "/Applications/ChatGPT.app/Contents/Resources/codex", "/h/Applications/ChatGPT.app/Contents/Resources/codex",
               "/Applications/Codex.app/Contents/Resources/codex", "/h/Applications/Codex.app/Contents/Resources/codex"]
        XCTAssertEqual(list, expected)
        XCTAssertEqual(CodexCLI.candidates(env: [:], home: "/h", arch: "x64").first,
                       "/h/.npm-global/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/codex/codex")
        // AGENTDESK_NATIVE_CODEX_CLI wins over CODEX_CLI_PATH; duplicates appear once.
        let explicit = CodexCLI.candidates(env: ["AGENTDESK_NATIVE_CODEX_CLI": "/y/codex", "CODEX_CLI_PATH": "/x/codex", "PATH": "/h/.local/bin"], home: "/h")
        XCTAssertEqual(explicit.first, "/y/codex")
        XCTAssertFalse(explicit.contains("/x/codex"))
        XCTAssertEqual(explicit.filter { $0 == "/h/.local/bin/codex" }.count, 1)
    }

    func testLocatePrefersNativeBinaryAndSkipsNodeScripts() throws {
        let root = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: root) }
        let fm = FileManager.default
        func executable(_ relative: String) throws -> String {
            let url = root.appendingPathComponent(relative)
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try "#!/bin/sh\n".write(to: url, atomically: true, encoding: .utf8)
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
            return url.path
        }
        let script = try executable("lib/node_modules/@openai/codex/bin/codex.js")
        try fm.createDirectory(at: root.appendingPathComponent("bin"), withIntermediateDirectories: true)
        try fm.createSymbolicLink(atPath: root.appendingPathComponent("bin/codex").path, withDestinationPath: script)
        let home = root.appendingPathComponent("home").path
        let env = ["PATH": root.appendingPathComponent("bin").path]

        let native = try executable("lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex")
        XCTAssertEqual(CodexCLI.locate(env: env, home: home, arch: "arm64"), native)

        // Checked on an explicit list, so a codex really installed on this machine cannot interfere.
        let local = try executable("home/.local/bin/codex")
        let jsLink = root.appendingPathComponent("bin/codex").path
        // bin/codex points at a .js file, which needs Node: skipped. Directories and missing files too.
        XCTAssertEqual(CodexCLI.firstUsable([jsLink, root.path, root.appendingPathComponent("missing").path, local]), local)
        XCTAssertNil(CodexCLI.firstUsable([jsLink]))
    }
}
