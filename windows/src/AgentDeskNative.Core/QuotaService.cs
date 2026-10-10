using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AgentDeskNative.Windows;

public sealed class QuotaService(Clients clients)
{
    private readonly Dictionary<string, Quota> cache = [];
    private readonly Dictionary<string, DateTimeOffset> nextQuery = [];
    private readonly HashSet<string> busy = [];
    public Quota? Get(string id) => cache.GetValueOrDefault(id);
    public bool IsBusy(string id) => busy.Contains(id);
    public void Clear(string id)
    {
        cache.Remove(id);
        nextQuery.Remove(id);
    }

    public async Task Refresh(Account account, bool manual = false)
    {
        if (busy.Contains(account.Id) || nextQuery.GetValueOrDefault(account.Id) > DateTimeOffset.UtcNow)
            return;
        if (!manual && cache.TryGetValue(account.Id, out var recent) && !recent.Cached && DateTimeOffset.UtcNow - recent.Observed < TimeSpan.FromMinutes(5))
            return;
        busy.Add(account.Id);
        try
        {
            cache[account.Id] = account.App == "codex" ? await Codex(account) : await Claude(account);
        }
        catch (Exception e)
        {
            var detail = e is OperationCanceledException ? "查询超时" : e is InvalidOperationException or IOException ? e.Message : "额度查询失败";
            if (detail.Contains("429", StringComparison.Ordinal))
                nextQuery[account.Id] = DateTimeOffset.UtcNow.AddMinutes(5);
            Quota? fallback = null;
            try
            {
                fallback = account.App == "claude" ? ClaudeHistory(clients.ClaudeRoot(account)) : CodexRollout(account.SessionRoot);
            }
            catch (Exception fallbackError) when (fallbackError is IOException or JsonException or UnauthorizedAccessException)
            {
            }

            var previous = cache.GetValueOrDefault(account.Id);
            var best = previous != null && (fallback == null || previous.Observed > fallback.Observed) ? previous : fallback;
            cache[account.Id] = best != null ? best with
            {
                Cached = true,
                Detail = detail
            }

            : new([], DateTimeOffset.UtcNow, detail);
        }
        finally
        {
            busy.Remove(account.Id);
        }
    }

    private async Task<Quota> Codex(Account a)
    {
        var cli = clients.CodexCli() ?? throw new IOException("找不到 Codex 原生命令行工具。");
        var info = new ProcessStartInfo(cli)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        info.ArgumentList.Add("app-server");
        info.ArgumentList.Add("--listen");
        info.ArgumentList.Add("stdio://");
        info.Environment["CODEX_HOME"] = a.SessionRoot;
        using var p = Process.Start(info) ?? throw new IOException("Codex 查询进程无法启动。");
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var drain = p.StandardError.BaseStream.CopyToAsync(Stream.Null);
        async Task Send(object data)
        {
            await p.StandardInput.WriteLineAsync(JsonSerializer.Serialize(data));
            await p.StandardInput.FlushAsync();
        }

        try
        {
            await Send(new
            {
                id = 1,
                method = "initialize",
                @params = new
                {
                    clientInfo = new
                    {
                        name = "agentdesk-native",
                        version = "1"
                    },
                    capabilities = new
                    {
                        optOutNotificationMethods = Array.Empty<string>()
                    }
                }
            });
            bool accountDone = false, limitsDone = false, apiKey = false, signedIn = false;
            var windows = new List<QuotaWindow>();
            while (!accountDone || !limitsDone)
            {
                var line = await p.StandardOutput.ReadLineAsync(cancel.Token);
                if (line == null)
                    throw new IOException("Codex 查询提前退出。");
                JsonDocument doc;
                try
                {
                    doc = JsonDocument.Parse(line);
                }
                catch (JsonException)
                {
                    continue;
                }

                using (doc)
                {
                    var e = doc.RootElement;
                    var id = (int)e.Number("id", -1);
                    if (id == 1)
                    {
                        if (e.At("error").ValueKind != JsonValueKind.Undefined)
                            throw new IOException("当前 Codex 不支持额度查询。");
                        await Send(new
                        {
                            method = "initialized"
                        });
                        await Send(new
                        {
                            id = 2,
                            method = "account/read",
                            @params = new
                            {
                                refreshToken = false
                            }
                        });
                        await Send(new
                        {
                            id = 3,
                            method = "account/rateLimits/read",
                            @params = (object?)null
                        });
                    }

                    if (id == 2)
                    {
                        accountDone = true;
                        var account = e.At("result").At("account");
                        apiKey = account.Text("type") == "apiKey";
                        signedIn = account.ValueKind == JsonValueKind.Object;
                    }

                    if (id == 3)
                    {
                        limitsDone = true;
                        var result = e.At("result");
                        windows = ParseCodex(result.At("rateLimits").ValueKind == JsonValueKind.Object ? result.At("rateLimits") : result.At("rateLimitsByLimitId").At("codex"));
                    }
                }
            }

            if (windows.Count > 0)
                return new(windows, DateTimeOffset.UtcNow, "实时额度");
            if (apiKey)
                return new([], DateTimeOffset.UtcNow, "API Key 账号 · 无官方订阅额度数据");
            throw new IOException(signedIn ? "客户端未返回额度窗口。" : "尚未登录。");
        }
        finally
        {
            p.StandardInput.Close();
            if (!p.HasExited)
                p.Kill(true);
            await p.WaitForExitAsync();
            await drain;
        }
    }

    public static List<QuotaWindow> ParseCodex(JsonElement bucket)
    {
        var windows = new List<(double Minutes, QuotaWindow Value)>();
        foreach (var name in new[]
        {
            "primary",
            "secondary"
        }

        )
        {
            var w = bucket.At(name);
            var minutes = w.Number("windowDurationMins", w.Number("window_minutes", -1));
            var used = w.Number("usedPercent", w.Number("used_percent", -1));
            if (!double.IsFinite(minutes) || minutes <= 0 || minutes > 1e7 || !double.IsFinite(used) || used < 0)
                continue;
            var reset = w.Number("resetsAt", w.Number("resets_at"));
            var label = minutes == 10080 ? "周" : minutes % 1440 == 0 ? $"{minutes / 1440}天" : minutes % 60 == 0 ? $"{minutes / 60}h" : $"{minutes}分";
            windows.Add((minutes, new(label, Math.Clamp(used, 0, 100), reset > 0 ? DateTimeOffset.FromUnixTimeSeconds((long)reset) : null)));
        }

        return windows.OrderBy(w => w.Minutes).Select(w => w.Value).ToList();
    }

    private static Quota? CodexRollout(string home)
    {
        var root = Path.Combine(home, "sessions");
        if (!Directory.Exists(root))
            return null;
        foreach (var file in Directory.EnumerateFiles(root, "*.jsonl", SearchOption.AllDirectories).OrderByDescending(File.GetLastWriteTimeUtc).Take(10))
            foreach (var line in Sessions.Tail(file, 262144).Split('\n').Reverse())
            {
                if (!line.Contains("token_count", StringComparison.Ordinal))
                    continue;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var e = doc.RootElement;
                    var windows = ParseCodex(e.At("payload").At("rate_limits"));
                    if (windows.Count > 0)
                        return new(windows, e.Time("timestamp"), "本地缓存", true);
                }
                catch (JsonException)
                {
                }
            }

        return null;
    }

    public static Quota? ClaudeHistory(string root)
    {
        var file = Path.Combine(root, "plan-usage-history.json");
        if (!File.Exists(file))
            return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        var samples = doc.RootElement.At("samples");
        if (samples.ValueKind != JsonValueKind.Array)
            return null;
        var sample = samples.EnumerateArray().OrderByDescending(e => e.Number("t")).FirstOrDefault();
        if (sample.ValueKind == JsonValueKind.Undefined)
            return null;
        var time = DateTimeOffset.FromUnixTimeMilliseconds((long)sample.Number("t"));
        var windows = new List<QuotaWindow>();
        foreach (var (key, label, duration) in new[]
        {
            ("fh", "5h", 300),
            ("sd", "周", 10080)
        }

        )
        {
            var n = sample.At("u").Number(key, -1);
            if (n >= 0 && DateTimeOffset.UtcNow - time < TimeSpan.FromMinutes(duration))
                windows.Add(new(label, Math.Clamp(n, 0, 100), null));
        }

        return windows.Count > 0 ? new(windows, time, "本地历史", true) : null;
    }

    private async Task<Quota> Claude(Account a)
    {
        if (a.ThirdParty)
            return new([], DateTimeOffset.UtcNow, "第三方网关 · 未提供官方订阅额度");
        var root = clients.ClaudeRoot(a);
        var cfgFile = Path.Combine(root, "config.json");
        var stateFile = Path.Combine(root, "Local State");
        if (!File.Exists(cfgFile) || !File.Exists(stateFile))
            throw new IOException("尚无可读取的 Claude 登录授权。");
        using var cfg = JsonDocument.Parse(File.ReadAllText(cfgFile));
        using var state = JsonDocument.Parse(File.ReadAllText(stateFile));
        var encryptedKey = Convert.FromBase64String(state.RootElement.At("os_crypt").Text("encrypted_key"));
        if (encryptedKey.Length < 6 || System.Text.Encoding.ASCII.GetString(encryptedKey, 0, 5) != "DPAPI")
            throw new IOException("当前 Claude 加密格式暂不兼容。");
        var key = Unprotect(encryptedKey[5..]);
        var raw = Convert.FromBase64String(cfg.RootElement.Text("oauth:tokenCacheV2"));
        if (raw.Length < 32 || System.Text.Encoding.ASCII.GetString(raw, 0, 3) != "v10")
            throw new IOException("当前 Claude 授权格式暂不兼容。");
        var plain = new byte[raw.Length - 31];
        try
        {
            using (var aes = new AesGcm(key, 16))
                aes.Decrypt(raw.AsSpan(3, 12), raw.AsSpan(15, raw.Length - 31), raw.AsSpan(raw.Length - 16), plain);
            using var tokens = JsonDocument.Parse(plain);
            var account = cfg.RootElement.Text("lastKnownAccountUuid");
            if (account.Length == 0)
                throw new IOException("无法确认 Claude 当前账号。");
            string org = "";
            var historyFile = Path.Combine(root, "plan-usage-history.json");
            if (File.Exists(historyFile))
            {
                using var h = JsonDocument.Parse(File.ReadAllText(historyFile));
                if (h.RootElement.At("samples").ValueKind == JsonValueKind.Array)
                    org = h.RootElement.At("samples").EnumerateArray().OrderByDescending(s => s.Number("t")).FirstOrDefault().Text("org");
            }

            var candidates = tokens.RootElement.EnumerateObject().Where(p => p.Name.StartsWith("acct:" + account + "|", StringComparison.Ordinal) && p.Name.Contains(":https://api.anthropic.com:", StringComparison.Ordinal) && p.Name.Split(":https://api.anthropic.com:")[1].Split(' ').Contains("user:profile") && p.Value.Number("expiresAt") > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 30000).ToList();
            string Organization(JsonProperty p) => p.Name.Split(":https://api.anthropic.com:")[0].Split(':').Last();
            var preferred = candidates.Where(p => Organization(p) == org).ToList();
            var selected = preferred.Count > 0 ? preferred : candidates.Select(Organization).Distinct().Count() <= 1 ? candidates : [];
            if (selected.Count == 0)
                throw new IOException("Claude 授权已过期或组织不明确，请在客户端确认登录。");
            var token = selected.OrderByDescending(p => p.Value.Number("expiresAt")).First().Value.Text("token");
            if (token.Length == 0)
                throw new IOException("没有可用的 Claude 访问令牌。");
            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
            {
                Timeout = TimeSpan.FromSeconds(15)
            };
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.anthropic.com/api/oauth/usage");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("anthropic-beta", "oauth-2025-04-20");
            using var response = await http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
                throw new IOException($"Claude 额度服务 HTTP {(int)response.StatusCode}");
            using var usage = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var windows = ParseClaude(usage.RootElement);
            if (windows.Count == 0)
                throw new IOException("Claude 未返回额度窗口。");
            return new(windows, DateTimeOffset.UtcNow, "实时额度");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    public static List<QuotaWindow> ParseClaude(JsonElement usage)
    {
        var windows = new List<QuotaWindow>();
        foreach (var (name, label) in new[]
        {
            ("five_hour", "5h"),
            ("seven_day", "周"),
            ("seven_day_sonnet", "Sonnet 周"),
            ("seven_day_opus", "Opus 周")
        }

        )
        {
            var value = usage.At(name);
            var n = value.Number("utilization", -1);
            if (n >= 0)
                windows.Add(new(label, Math.Clamp(n, 0, 100), DateTimeOffset.TryParse(value.Text("resets_at"), out var t) ? t : null));
        }

        return windows;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Blob
    {
        public int Length;
        public nint Data;
    }

    private static byte[] Unprotect(byte[] bytes)
    {
        var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        var source = new Blob
        {
            Length = bytes.Length,
            Data = pin.AddrOfPinnedObject()
        };
        try
        {
            if (!CryptUnprotectData(ref source, nint.Zero, nint.Zero, nint.Zero, nint.Zero, 1, out var output))
                throw new IOException("Windows 无法解开当前用户的 Claude 授权。");
            try
            {
                var result = new byte[output.Length];
                Marshal.Copy(output.Data, result, 0, result.Length);
                return result;
            }
            finally
            {
                LocalFree(output.Data);
            }
        }
        finally
        {
            pin.Free();
        }
    }

    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptUnprotectData(ref Blob input, nint description, nint entropy, nint reserved, nint prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")]
    private static extern nint LocalFree(nint p);
}