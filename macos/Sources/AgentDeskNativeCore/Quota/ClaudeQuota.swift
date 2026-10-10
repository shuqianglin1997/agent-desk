import Foundation
import Security
import LocalAuthentication
import CommonCrypto

/// Uses only the selected desktop profile's current account and profile-scoped login.
/// Credentials stay in memory; no refresh token is used and no client login state is changed.
public enum ClaudeQuota {
    public enum Failure: Error, Equatable {
        case noLogin, keychainLocked, incompatibleCache, expired, noUsageScope, rateLimited(TimeInterval), http(Int), network, unreadable
        public var reason: String {
            switch self {
            case .noLogin: return "请先登录这个 Claude 客户端"
            case .keychainLocked: return "需要访问 Claude 登录信息，请点击刷新并允许钥匙串访问"
            case .incompatibleCache: return "无法读取此版本 Claude 的登录信息"
            case .expired: return "Claude 登录授权已过期，请打开客户端更新登录后重试"
            case .noUsageScope: return "当前 Claude 登录没有额度查询权限，请更新客户端并重新登录"
            case .rateLimited: return "Claude 暂时限制额度查询，稍后自动重试"
            case .http(let code): return "Claude 额度查询失败（HTTP \(code)）"
            case .network: return "无法连接 Claude 额度服务"
            case .unreadable: return "Claude 没有返回可识别的额度"
            }
        }
    }

    /// Blocking, at most 15 seconds for the request; call off the main thread.
    public static func live(dataDir: URL, interactive: Bool = false) -> Result<QuotaValue, Failure> {
        do {
            let config = try JSONSerialization.jsonObject(with: Data(contentsOf: dataDir.appendingPathComponent("config.json"))) as? [String: Any]
            guard let config, let account = config["lastKnownAccountUuid"] as? String, !account.isEmpty,
                  let encrypted = config["oauth:tokenCacheV2"] as? String else { return .failure(.noLogin) }
            let password: Data
            switch storagePassword(interactive: interactive) {
            case .success(let value): password = value
            case .failure(let error): return .failure(error)
            }
            guard let entries = decrypt(encrypted, password: password) else { return .failure(.incompatibleCache) }
            let org = latestOrganization(dataDir: dataDir)
            let token: String
            switch selectToken(entries, account: account, organization: org, now: Date()) {
            case .success(let value): token = value
            case .failure(let error): return .failure(error)
            }
            return request(token: token)
        } catch { return .failure(.noLogin) }
    }

    static func selectToken(_ entries: [String: Any], account: String, organization: String?, now: Date) -> Result<String, Failure> {
        let matching = entries.compactMap { key, value -> (String, [String: Any])? in
            guard key.hasPrefix("acct:\(account)|"), let entry = value as? [String: Any] else { return nil }
            let parts = key.components(separatedBy: ":https://api.anthropic.com:")
            guard parts.count == 2, parts[1].split(separator: " ").contains("user:profile"),
                  let org = parts[0].split(separator: ":").last.map(String.init),
                  !org.isEmpty else { return nil }
            return (org, entry)
        }
        guard !matching.isEmpty else { return .failure(.noUsageScope) }
        let valid = matching.filter {
            guard let expiry = QuotaParser.number($0.1["expiresAt"]) else { return false }
            return expiry > now.timeIntervalSince1970 * 1000 + 30_000
        }
        guard !valid.isEmpty else { return .failure(.expired) }
        // History can survive account changes. Use its organization only if this current account
        // has valid authorization for it; otherwise a unique current organization is sufficient.
        let preferred = valid.filter { $0.0 == organization }
        let scoped = preferred.isEmpty ? valid : preferred
        guard Set(scoped.map { $0.0 }).count == 1 else { return .failure(.noLogin) }
        let ranked = scoped.map { $0.1 }.sorted {
            (QuotaParser.number($0["expiresAt"]) ?? 0) > (QuotaParser.number($1["expiresAt"]) ?? 0)
        }
        guard let entry = ranked.first, let token = entry["token"] as? String, !token.isEmpty else { return .failure(.expired) }
        return .success(token)
    }

    private static func latestOrganization(dataDir: URL) -> String? {
        guard let data = try? Data(contentsOf: dataDir.appendingPathComponent("plan-usage-history.json")),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let samples = object["samples"] as? [[String: Any]] else { return nil }
        return samples.max { (QuotaParser.number($0["t"]) ?? 0) < (QuotaParser.number($1["t"]) ?? 0) }?["org"] as? String
    }

    private static func storagePassword(interactive: Bool) -> Result<Data, Failure> {
        let context = LAContext()
        context.interactionNotAllowed = !interactive
        context.localizedReason = "AgentDesk Native 需要查询此 Claude 账号的额度"
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "Claude Safe Storage", kSecAttrAccount as String: "Claude Key",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return .failure(.keychainLocked) }
        return .success(data)
    }

    /// Electron's macOS safeStorage envelope; reject unknown formats instead of guessing.
    static func decrypt(_ encoded: String, password: Data) -> [String: Any]? {
        guard let raw = Data(base64Encoded: encoded), raw.starts(with: Data("v10".utf8)), raw.count > 3 else { return nil }
        let salt = Array("saltysalt".utf8)
        var key = [UInt8](repeating: 0, count: 16)
        let derived = password.withUnsafeBytes { pass in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pass.baseAddress?.assumingMemoryBound(to: Int8.self),
                                password.count, salt, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), 1003, &key, key.count)
        }
        guard derived == kCCSuccess else { return nil }
        let body = raw.dropFirst(3), iv = [UInt8](repeating: 32, count: 16)
        var output = [UInt8](repeating: 0, count: body.count + 16), length = 0
        let status = body.withUnsafeBytes { bytes in
            CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                    key, key.count, iv, bytes.baseAddress, body.count, &output, output.count, &length)
        }
        guard status == kCCSuccess else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(output.prefix(length)))) as? [String: Any]
    }

    static func windows(_ object: [String: Any]) -> [QuotaWindow] {
        [("five_hour", 300), ("seven_day", 10080)].compactMap { name, minutes in
            guard let row = object[name] as? [String: Any], let used = QuotaParser.number(row["utilization"]),
                  used.isFinite, (0...100).contains(used) else { return nil }
            let reset = (row["resets_at"] as? String).flatMap(ISO8601.parse)
            return QuotaWindow(minutes: minutes, usedPercent: used, resetsAt: reset)
        }
    }

    private final class NoRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    }

    private static func request(token: String) -> Result<QuotaValue, Failure> {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/api/oauth/usage")!, timeoutInterval: 15)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForResource = 15
        let session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let done = DispatchSemaphore(value: 0)
        var answer: Result<QuotaValue, Failure> = .failure(.network)
        let task = session.dataTask(with: request) { data, response, _ in
            defer { done.signal() }
            guard let response = response as? HTTPURLResponse else { return }
            switch response.statusCode {
            case 200:
                guard let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    answer = .failure(.unreadable); return
                }
                let found = windows(object)
                answer = found.isEmpty ? .failure(.unreadable) : .success(.windows(found))
            case 401: answer = .failure(.expired)
            case 403: answer = .failure(.noUsageScope)
            case 429: answer = .failure(.rateLimited(max(600, Double(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 600)))
            default: answer = .failure(.http(response.statusCode))
            }
        }
        task.resume()
        guard done.wait(timeout: .now() + 16) == .success else { task.cancel(); return .failure(.network) }
        return answer
    }
}
