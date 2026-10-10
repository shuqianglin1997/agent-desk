import Foundation

/// A fresh directory under the system temporary directory.
func makeTempDir() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("desk-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// A fresh directory with a short path, for tests that depend on the 104-byte socket limit.
func makeShortDir() throws -> URL {
    let url = URL(fileURLWithPath: "/tmp/desk-t-\(UUID().uuidString.prefix(8).lowercased())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}
