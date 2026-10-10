using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using AgentDeskNative.Windows;

internal static class FixtureTests
{
    private static void Check(bool condition, string message)
    {
        if (!condition)
            throw new Exception(message);
    }

    public static void Run(string root)
    {
        var fixtures = Path.Combine(AppContext.BaseDirectory, "fixtures");
        using var expected = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtures, "expected", "sessions.json")));
        var e = expected.RootElement;
        foreach (var key in Strings.All.Keys)
            Check(!string.IsNullOrWhiteSpace(Strings.Get(key)), "Missing string: " + key);
        Check(Handoffs.Prompt("D:/demo.md") == Strings.Get("handoff.prompt").Replace("{path}", "D:/demo.md"), "Shared handoff prompt");
        var home = Path.Combine(root, "fixture-home");
        Directory.CreateDirectory(home);
        File.Copy(Path.Combine(fixtures, "codex", "session_index.jsonl"), Path.Combine(home, "session_index.jsonl"));
        var sql = File.ReadAllText(Path.Combine(fixtures, "codex", "schema.sql")).Split("-- thread_history_1.sqlite (separate database)");
        CreateDatabase(Path.Combine(home, "state_5.sqlite"), sql[0]);
        CreateDatabase(Path.Combine(home, "thread_history_1.sqlite"), sql[1]);
        var account = new Account
        {
            ProfilePath = home,
            SessionRoot = home
        };
        var codex = Sessions.Read(account, new Clients()).Sessions.Single();
        Check(codex.Title == e.Text("codexTitle") && codex.Status == e.Text("status") && codex.Path == "D:/demo/rollout.jsonl", "Codex SQLite fixture expectations");
        var claude = Path.Combine(root, "fixture-claude");
        var folder = Path.Combine(claude, "local-agent-mode-sessions", "org", "user");
        Directory.CreateDirectory(Path.Combine(folder, "12345678"));
        File.Copy(Path.Combine(fixtures, "claude", "session.json"), Path.Combine(folder, "local_12345678-1234-1234-1234-123456789abc.json"));
        File.Copy(Path.Combine(fixtures, "claude", "audit.jsonl"), Path.Combine(folder, "12345678", "audit.jsonl"));
        var session = Sessions.ReadClaude(claude, true).Single();
        Check(session.Title == e.Text("claudeTitle") && session.Status == e.Text("status") && File.Exists(session.Path), "Claude shared fixture expectations");
        using var limits = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtures, "codex", "rate-limits.json")));
        using var usage = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtures, "claude", "usage.json")));
        Compare(QuotaService.ParseCodex(limits.RootElement), e.At("codexWindows"));
        Compare(QuotaService.ParseClaude(usage.RootElement), e.At("claudeWindows"));
    }

    private static void Compare(System.Collections.Generic.List<QuotaWindow> actual, JsonElement expected)
    {
        Check(actual.Count == expected.GetArrayLength(), "Fixture window count");
        for (int i = 0; i < actual.Count; i++)
            Check(actual[i].Name == expected[i].Text("Name") && actual[i].Used == expected[i].Number("Used"), "Fixture window value");
    }

    private static void CreateDatabase(string path, string sql)
    {
        Check(sqlite3_open_v2(path, out var db, 6, 0) == 0, "Create fixture SQLite database");
        try
        {
            int result = sqlite3_exec(db, sql, 0, 0, out var error);
            if (error != 0)
                sqlite3_free(error);
            Check(result == 0, "Execute fixture SQLite schema");
        }
        finally
        {
            sqlite3_close(db);
        }
    }

    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_open_v2([MarshalAs(UnmanagedType.LPUTF8Str)] string path, out nint db, int flags, nint vfs);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_exec(nint db, [MarshalAs(UnmanagedType.LPUTF8Str)] string sql, nint callback, nint data, out nint error);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void sqlite3_free(nint value);
    [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close(nint db);
}