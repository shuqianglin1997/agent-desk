import Foundation

/// One line of `handoffs/log.jsonl`.
public struct HandoffLogEntry: Codable, Equatable, Identifiable {
    public let recordID: String?
    public let documentPath: String?
    public var id: String {
        recordID ?? "\(time.timeIntervalSince1970)|\(source)|\(target)|\(conversation)|\(method)|\(result)"
    }
    public let time: Date
    public let source: String
    public let target: String
    public let conversation: String
    public let method: String
    public let result: String

    public init(time: Date, source: String, target: String, conversation: String, method: String, result: String, documentPath: String? = nil) {
        self.recordID = UUID().uuidString; self.documentPath = documentPath
        self.time = time; self.source = source; self.target = target
        self.conversation = conversation; self.method = method; self.result = result
    }
}

/// Handoff documents and the handoff log under `<root>/handoffs` (folder 0700, files 0600). Documents are never overwritten; selected log entries can be removed.
public final class HandoffStore {
    public let directory: URL
    private var logURL: URL { directory.appendingPathComponent("log.jsonl") }

    public init(root: URL) { directory = root.appendingPathComponent("handoffs") }

    public enum DocumentError: LocalizedError {
        case empty
        public var errorDescription: String? { "交接文档为空，请选择有正文的 Markdown 文件。" }
    }

    /// Copy the explicitly selected document, without moving or modifying its source.
    /// Return exactly the saved body for the clipboard, including the existing email redaction.
    public func copyDocument(_ source: URL, fileName: String) throws -> (url: URL, markdown: String) {
        let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular else {
            throw CocoaError(.fileReadUnsupportedScheme, userInfo: [NSFilePathErrorKey: source.path])
        }
        let markdown = HandoffDocument.redactingEmails(try String(contentsOf: source, encoding: .utf8))
        guard !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw DocumentError.empty }
        return (try save(markdown, fileName: fileName), markdown)
    }

    /// Writes `markdown` with an exclusive create (O_EXCL), so an existing file is never overwritten, even under a race.
    public func save(_ markdown: String, fileName: String) throws -> URL {
        try Self.validateFileName(fileName)
        try Self.makePrivateDirectory(directory)
        var index = 1
        while true {
            let url = directory.appendingPathComponent(Self.candidateName(fileName, index: index))
            let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            if fd == -1 {
                if errno == EEXIST { index += 1; continue }
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
            let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
            do {
                try handle.write(contentsOf: Data(HandoffDocument.redactingEmails(markdown).utf8))
            } catch {
                try? FileManager.default.removeItem(at: url)
                throw error
            }
            return url
        }
    }

    public func appendLog(_ entry: HandoffLogEntry) throws {
        try Self.makePrivateDirectory(directory)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var line = try encoder.encode(entry)
        line.append(UInt8(ascii: "\n"))
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        let handle = try FileHandle(forWritingTo: logURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
    }

    /// The newest entries first.
    public func recentLog(limit: Int = 20) -> [HandoffLogEntry] {
        guard let data = try? Data(contentsOf: logURL) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let entries = data.split(separator: UInt8(ascii: "\n")).compactMap { try? decoder.decode(HandoffLogEntry.self, from: Data($0)) }
        return Array(entries.suffix(limit).reversed())
    }

    /// Remove only the selected log entry, preserving other records (including unrecognized lines) and documents.
    public func removeLogEntry(id: String) throws {
        guard FileManager.default.fileExists(atPath: logURL.path) else { return }
        let data = try Data(contentsOf: logURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let lines = data.split(separator: UInt8(ascii: "\n"))
        var removed = false
        let kept = lines.filter { line in
            if !removed, (try? decoder.decode(HandoffLogEntry.self, from: Data(line)))?.id == id {
                removed = true
                return false
            }
            return true
        }
        guard kept.count != lines.count else { return }
        var output = Data()
        for line in kept { output.append(contentsOf: line); output.append(UInt8(ascii: "\n")) }
        try output.write(to: logURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: logURL.path)
    }

    /// New records use an exact path. For legacy records, resolve only an unambiguous same-minute file.
    public func document(for entry: HandoffLogEntry) -> URL? {
        func regular(_ url: URL) -> Bool {
            (try? FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeRegular
        }
        if let path = entry.documentPath {
            let url = URL(fileURLWithPath: path).standardizedFileURL
            return url.deletingLastPathComponent().path == directory.standardizedFileURL.path && regular(url) ? url : nil
        }
        // Failures/timeouts/cancellations need their source conversation, not an unrelated document.
        guard entry.result == "已交付" || entry.result.hasPrefix("文档已准备") else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmm"
        let prefix = formatter.string(from: entry.time) + "-"
        let candidates = ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []).filter {
            $0.lastPathComponent.hasPrefix(prefix) && $0.pathExtension == "md"
                && regular($0)
        }
        return candidates.count == 1 ? candidates.first : nil
    }

    static func makePrivateDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    /// Rejects names that could leave the handoff folder or are otherwise not a plain file name.
    private static func validateFileName(_ name: String) throws {
        guard !name.isEmpty, !name.contains("/"), !name.contains("\0"),
              name != ".", name != "..", !name.hasPrefix("..") else {
            throw CocoaError(.fileWriteInvalidFileName, userInfo: [NSFilePathErrorKey: name])
        }
    }

    /// `name` for index 1, then `name-2`, `name-3`… for each further candidate.
    private static func candidateName(_ fileName: String, index: Int) -> String {
        if index == 1 { return fileName }
        let base = (fileName as NSString).deletingPathExtension
        let ext = (fileName as NSString).pathExtension
        return ext.isEmpty ? "\(base)-\(index)" : "\(base)-\(index).\(ext)"
    }

}
