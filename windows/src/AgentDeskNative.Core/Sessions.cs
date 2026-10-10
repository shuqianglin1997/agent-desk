using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace AgentDeskNative.Windows;
/// SQLite is opened READONLY; live WAL files remain visible. No client database is modified.
public sealed class ReadDatabase : IDisposable
{
    private nint db;
    public ReadDatabase(string path)
    {
        if (!File.Exists(path) || sqlite3_open_v2(path, out db, 1, nint.Zero) != 0)
        {
            Dispose();
            throw new IOException("会话数据库暂不可读。");
        }

        sqlite3_busy_timeout(db, 150);
    }

    public List<string?[]> Rows(string sql, string? argument = null)
    {
        nint statement = 0;
        try
        {
            if (sqlite3_prepare_v2(db, sql, -1, out statement, nint.Zero) != 0)
                throw new IOException("当前客户端数据结构暂不兼容。");
            if (argument != null)
                sqlite3_bind_text(statement, 1, argument, -1, (nint)(-1));
            var rows = new List<string?[]>();
            int result;
            while ((result = sqlite3_step(statement)) == 100)
                rows.Add(Enumerable.Range(0, sqlite3_column_count(statement)).Select(i => Marshal.PtrToStringUTF8(sqlite3_column_text(statement, i))).ToArray());
            if (result != 101)
                throw new IOException("客户端数据库忙，请稍后重试。");
            return rows;
        }
        finally
        {
            if (statement != 0)
                sqlite3_finalize(statement);
        }
    }

    public void Dispose()
    {
        if (db != 0)
        {
            sqlite3_close(db);
            db = 0;
        }
    }

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_open_v2([MarshalAs(UnmanagedType.LPUTF8Str)] string file, out nint db, int flags, nint vfs);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close(nint db);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_busy_timeout(nint db, int ms);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_prepare_v2(nint db, [MarshalAs(UnmanagedType.LPUTF8Str)] string sql, int bytes, out nint statement, nint tail);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_bind_text(nint statement, int index, [MarshalAs(UnmanagedType.LPUTF8Str)] string value, int bytes, nint destructor);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_step(nint statement);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_column_count(nint statement);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern nint sqlite3_column_text(nint statement, int index);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_finalize(nint statement);
}

public static class Sessions
{
    public static Snapshot Read(Account account, Clients clients)
    {
        var p = clients.Find(account);
        try
        {
            var sessions = account.App == "codex" ? Codex(account.SessionRoot, p != null) : ReadClaude(clients.ClaudeRoot(account), p != null);
            return new(p != null, sessions.OrderBy(s => s.Status == "等待输入" ? 0 : s.Status == "运行中" ? 1 : 2).ThenByDescending(s => s.Updated).ToList(), sessions.Count == 0 ? "暂无本地会话" : "本机状态 · 每 5 秒更新", p?.Handle ?? 0);
        }
        catch (IOException e)
        {
            return new(p != null, [], e.Message, p?.Handle ?? 0);
        }
        catch
        {
            return new(p != null, [], "当前会话数据暂不可读。", p?.Handle ?? 0);
        }
    }

    public static string Status(string raw, bool running, DateTimeOffset updated, bool waiting = false)
    {
        if (raw is "completed" or "complete" or "finished")
            return "已完成";
        if (raw is "failed" or "error")
            return "遇到问题";
        if (raw is "interrupted" or "cancelled")
            return "已停止";
        if (raw is "inProgress" or "running" or "in_progress")
            return running && DateTimeOffset.UtcNow - updated < TimeSpan.FromHours(24) ? waiting ? "等待输入" : "运行中" : "已停止";
        return "状态未知";
    }

    private static List<Session> Codex(string home, bool running)
    {
        if (!Directory.Exists(home))
            return [];
        var statePath = Directory.GetFiles(home, "state_*.sqlite").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
        if (statePath == null)
            return [];
        using var state = new ReadDatabase(statePath);
        var titles = ReadCodexTitles(home);
        var rows = state.Rows("SELECT id,title,updated_at,cwd,rollout_path,source FROM threads WHERE archived=0 AND agent_path IS NULL AND source NOT LIKE '{%' ORDER BY updated_at DESC LIMIT 40");
        ReadDatabase? history = null;
        try
        {
            history = new ReadDatabase(Path.Combine(home, "thread_history_1.sqlite"));
        }
        catch (IOException)
        {
        }

        using (history)
        {
            return rows.Where(r => Guid.TryParse(r[0], out _)).Select(r =>
            {
                var updated = DateTimeOffset.FromUnixTimeSeconds(long.TryParse(r[2], out var t) ? t : 0);
                string raw = "", turnId = "";
                bool waiting = false;
                if (history != null)
                {
                    var turn = history.Rows("SELECT turn_id,status FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1", r[0]).FirstOrDefault();
                    raw = turn?[1] ?? "";
                    turnId = turn?[0] ?? "";
                    var tool = history.Rows("SELECT json_extract(item_json,'$.tool'),json_extract(item_json,'$.status') FROM thread_items WHERE thread_id=?1 AND item_type IN ('mcpToolCall','dynamicToolCall') AND turn_id=(SELECT turn_id FROM thread_turns WHERE thread_id=?1 ORDER BY rollout_ordinal DESC LIMIT 1) ORDER BY rollout_ordinal DESC LIMIT 1", r[0]).FirstOrDefault();
                    waiting = tool?[0]?.Contains("request_user_input", StringComparison.Ordinal) == true && tool?[1] == "inProgress";
                }

                if (r[4] is string rollout && File.Exists(rollout) && FileMemo.Get("rollout:" + rollout, [rollout], () => LastLifecycle(rollout)) is RolloutEvent last)
                {
                    raw = last.Raw;
                    if (last.TurnId != turnId)
                        waiting = false;
                    if (last.Time > updated)
                        updated = last.Time;
                }

                var title = titles.GetValueOrDefault(r[0]!) ?? r[1] ?? "Codex 聊天";
                return new Session(r[0]!, title[..Math.Min(140, title.Length)], Status(raw, running || r[5] == "exec", updated, waiting), updated, r[3] ?? "", r[4] ?? "");
            }).ToList();
        }
    }

    private sealed record RolloutEvent(string Raw, string TurnId, DateTimeOffset Time);
    private static RolloutEvent? LastLifecycle(string rollout)
    {
        foreach (var line in Tail(rollout, 524288).Split('\n').Reverse())
        {
            if (!line.Contains("task_started", StringComparison.Ordinal) && !line.Contains("task_complete", StringComparison.Ordinal) && !line.Contains("turn_aborted", StringComparison.Ordinal))
                continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var e = doc.RootElement;
                if (e.Text("type") != "event_msg")
                    continue;
                var payload = e.At("payload");
                var next = payload.Text("type") switch
                {
                    "task_started" => "inProgress",
                    "task_complete" => "completed",
                    "turn_aborted" => "interrupted",
                    _ => ""
                };
                if (next.Length == 0)
                    continue;
                return new RolloutEvent(next, payload.Text("turn_id"), e.Time("timestamp"));
            }
            catch (JsonException)
            {
            }
        }

        return null;
    }

    public static Dictionary<string, string> ReadCodexTitles(string home)
    {
        var index = Path.Combine(home, "session_index.jsonl");
        return FileMemo.Get("titles:" + index, [index], () => ReadTitles(index));
    }

    private static Dictionary<string, string> ReadTitles(string index)
    {
        var result = new Dictionary<string, string>();
        try
        {
            using var file = new FileStream(index, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(file);
            while (reader.ReadLine() is string line)
            {
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var entry = doc.RootElement;
                    var id = entry.Text("id");
                    var title = entry.Text("thread_name");
                    if (Guid.TryParse(id, out _) && !string.IsNullOrWhiteSpace(title))
                        result[id] = title;
                }
                catch (JsonException)
                {
                } // A concurrent append may leave its last line unfinished.
            }
        }
        catch (IOException)
        {
        }

        return result;
    }

    public static string Tail(string path, int bytes)
    {
        using var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var offset = Math.Max(0, f.Length - bytes);
        f.Position = offset;
        using var reader = new StreamReader(f, Encoding.UTF8);
        if (offset > 0)
            reader.ReadLine();
        return reader.ReadToEnd();
    }

    public static List<Session> ReadClaude(string profile, bool running)
    {
        var root = Path.Combine(profile, "local-agent-mode-sessions");
        if (!Directory.Exists(root))
            return [];
        var files = Directory.EnumerateFiles(root, "*.json", SearchOption.AllDirectories).OrderByDescending(File.GetLastWriteTimeUtc).Take(120);
        var result = new List<Session>();
        foreach (var file in files)
        {
            try
            {
                if (FileMemo.Get("claude:" + file, [file], () => ClaudeMetadata(file)) is not ClaudeEntry entry)
                    continue;
                var raw = entry.Raw;
                if (entry.Log != null && File.Exists(entry.Log) && FileMemo.Get("audit:" + entry.Log, [entry.Log], () => AuditLifecycle(entry.Log)) is string lifecycle)
                    raw = lifecycle;
                if (raw == "inProgress" && DateTimeOffset.UtcNow - entry.Updated > TimeSpan.FromMinutes(30))
                    raw = "interrupted";
                result.Add(new(entry.Id, entry.Title, Status(raw, running, entry.Updated), entry.Updated, entry.Cwd, file));
            }
            catch (IOException)
            {
            }
            catch (JsonException)
            {
            }
        }

        return result.OrderByDescending(s => s.Updated).Take(40).ToList();
    }

    private sealed record ClaudeEntry(string Id, string Title, DateTimeOffset Updated, string Raw, string Cwd, string? Log);
    private static ClaudeEntry? ClaudeMetadata(string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        var e = doc.RootElement;
        if (e.At("isArchived").ValueKind == JsonValueKind.True)
            return null;
        if (e.Text("id").Length == 0 && e.Text("sessionId").Length == 0)
            return null;
        var id = e.Text("id", e.Text("sessionId"));
        var title = e.Text("title", e.Text("name", "Claude 会话"));
        var updated = e.At("lastActivityAt").ValueKind != JsonValueKind.Undefined ? e.Time("lastActivityAt") : new DateTimeOffset(File.GetLastWriteTimeUtc(file), TimeSpan.Zero);
        // Read structured lifecycle only. Do not take the initial prompt as a display title.
        // Desktop local_<UUID>.json stores its audit stream in the UUID's 8-char prefix.
        var sessionId = id.StartsWith("local_", StringComparison.Ordinal) ? id[6..] : id;
        var shortId = sessionId.Length >= 8 ? sessionId[..8] : "";
        string? log = System.Text.RegularExpressions.Regex.IsMatch(shortId, "^[0-9a-fA-F]{8}$") ? Path.Combine(Path.GetDirectoryName(file)!, shortId, "audit.jsonl") : null;
        return new ClaudeEntry(id, title[..Math.Min(title.Length, 140)], updated, e.Text("status"), e.Text("cwd"), log);
    }

    private static string? AuditLifecycle(string log)
    {
        foreach (var line in Tail(log, 131072).Split('\n').Reverse())
        {
            if (!line.Contains("\"result\"", StringComparison.Ordinal) && !line.Contains("\"init\"", StringComparison.Ordinal) && !line.Contains("\"assistant\"", StringComparison.Ordinal) && !line.Contains("\"user\"", StringComparison.Ordinal))
                continue;
            try
            {
                using var row = JsonDocument.Parse(line);
                var v = row.RootElement;
                if (v.Text("type") == "result")
                    return v.At("is_error").ValueKind == JsonValueKind.True ? "error" : "completed";
                if (v.At("isMeta").ValueKind == JsonValueKind.True || v.At("isSidechain").ValueKind == JsonValueKind.True)
                    continue;
                if (v.Text("type") == "assistant")
                {
                    var stop = v.At("message").Text("stop_reason");
                    return stop.Length > 0 && stop != "tool_use" ? "completed" : "inProgress";
                }

                if (v.Text("type") == "user" || v.Text("subtype") == "init")
                    return "inProgress";
            }
            catch (JsonException)
            {
            }
        }

        return null;
    }
}

/// Reuses a parse result while every source file keeps its length and write time.
/// Polling every few seconds then reads only files that actually changed.
internal static class FileMemo
{
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (string Stamp, object? Value)> cache = new(StringComparer.OrdinalIgnoreCase);
    public static T Get<T>(string key, string[] files, Func<T> read)
    {
        var stamp = string.Join("|", files.Select(Stamp));
        if (cache.TryGetValue(key, out var hit) && hit.Stamp == stamp)
            return (T)hit.Value!;
        var value = read();
        if (cache.Count > 4000)
            cache.Clear();
        cache[key] = (stamp, value);
        return value;
    }

    private static string Stamp(string path)
    {
        try
        {
            // An open handle's length is current even while a client keeps appending.
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return stream.Length + ":" + File.GetLastWriteTimeUtc(path).Ticks;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return "-";
        }
    }
}