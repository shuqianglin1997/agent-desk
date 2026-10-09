import CryptoKit
import Foundation

/// Codex creates `<CODEX_HOME>/ipc/ipc.sock`; macOS limits socket paths to 104 bytes including NUL.
/// Long account directories get a private short symlink. Sessions still live in the real directory.
public enum RuntimeHome {
    public static let sunPathLimit = 104

    public static func socketPathBytes(_ sessionRoot: String) -> Int {
        (sessionRoot as NSString).appendingPathComponent("ipc/ipc.sock").utf8.count
    }

    public static func needsAlias(_ sessionRoot: String) -> Bool {
        socketPathBytes(sessionRoot) >= sunPathLimit
    }

    public static func defaultAliasRoot() -> URL {
        URL(fileURLWithPath: "/tmp/agentdesk-native-codex-\(getuid())")
    }

    static func aliasName(_ accountID: String) -> String {
        String(SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined().prefix(16))
    }

    /// Returns the CODEX_HOME to pass to Codex.
    public static func resolve(accountID: String, sessionRoot: String, aliasRoot: URL = defaultAliasRoot()) throws -> String {
        let fm = FileManager.default
        try fm.createDirectory(atPath: sessionRoot, withIntermediateDirectories: true)
        let real = URL(fileURLWithPath: sessionRoot).resolvingSymlinksInPath().path
        guard needsAlias(real) else { return real }

        try fm.createDirectory(at: aliasRoot, withIntermediateDirectories: true)
        var info = stat()
        guard lstat(aliasRoot.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR, info.st_uid == getuid() else {
            throw LaunchError.unsafeAliasRoot
        }
        chmod(aliasRoot.path, 0o700)

        let alias = aliasRoot.appendingPathComponent(aliasName(accountID)).path
        if let target = try? fm.destinationOfSymbolicLink(atPath: alias) {
            if target != real { try fm.removeItem(atPath: alias) }
        } else if fm.fileExists(atPath: alias) {
            throw LaunchError.aliasConflict
        }
        if (try? fm.destinationOfSymbolicLink(atPath: alias)) == nil {
            try fm.createSymbolicLink(atPath: alias, withDestinationPath: real)
        }
        guard !needsAlias(alias) else { throw LaunchError.aliasTooLong }
        return alias
    }
}
