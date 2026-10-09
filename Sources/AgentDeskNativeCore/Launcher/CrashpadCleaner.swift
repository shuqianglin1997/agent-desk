import Foundation

/// Keeps the client's own crash-report cache (`<profile>/Crashpad/pending`) under a size limit.
/// This cache is not user data, so the oldest reports are deleted outright.
public enum CrashpadCleaner {
    public static let defaultLimit: Int64 = 100 * 1024 * 1024

    @discardableResult
    public static func prune(profilePath: String, limit: Int64 = defaultLimit) -> Int {
        let directory = URL(fileURLWithPath: profilePath).appendingPathComponent("Crashpad/pending")
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
        guard let items = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys) else { return 0 }
        var files = items.compactMap { url -> (url: URL, size: Int64, date: Date)? in
            guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { return nil }
            return (url, Int64(values.fileSize ?? 0), values.contentModificationDate ?? .distantPast)
        }.sorted { $0.date < $1.date }
        var total = files.reduce(Int64(0)) { $0 + $1.size }
        var removed = 0
        while total > limit, !files.isEmpty {
            let file = files.removeFirst()
            if (try? FileManager.default.removeItem(at: file.url)) != nil {
                total -= file.size
                removed += 1
            }
        }
        return removed
    }
}
