using System;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Text.Json;
using AgentDeskNative.Windows;

static class Program
{
    static void Check(bool condition, string message)
    {
        if (!condition)
            throw new Exception(message);
    }

    static void Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "agentdesk-native-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(root);
            var a = new Account
            {
                Name = "A",
                ProfilePath = Path.Combine(root, "profile a"),
                SessionRoot = Path.Combine(root, "home")
            };
            store.Add(a);
            var b = new Account
            {
                Name = "B",
                App = "claude",
                ProfilePath = Path.Combine(root, "profile b"),
                SessionRoot = Path.Combine(root, "profile b")
            };
            store.Add(b);
            Check(new Store(root).Accounts.Count == 2, "Accounts must survive restart");
            Check(new DirectoryInfo(root).GetAccessControl().AreAccessRulesProtected, "Private root must not inherit broad ACLs");
            Check(Clients.Matches("client.exe \"--user-data-dir=" + a.ProfilePath + "\"", a), "Quoted profile paths must match");
            Check(!Clients.Matches("client.exe --user-data-dir=\"" + a.ProfilePath + " extra\"", a), "Prefix path must not match another account");
            Check(!Clients.Matches("client.exe \"--user-data-dir=" + a.ProfilePath + "\" --type=renderer", a), "Renderer is not an account root");
            Check(!Clients.Matches("client.exe", a), "An independent slot must not claim default process");
            using var quota = JsonDocument.Parse("{\"primary\":{\"usedPercent\":120,\"windowDurationMins\":10080,\"resetsAt\":2000000000}}");
            var parsed = QuotaService.ParseCodex(quota.RootElement);
            Check(parsed.Single().Name == "周" && parsed.Single().Used == 100, "Name windows by duration and clamp percentage");
            Check(Sessions.Status("inProgress", false, DateTimeOffset.UtcNow) == "已停止", "Closed clients must not look busy");
            var claude = Path.Combine(root, "claude");
            var sessionRoot = Path.Combine(claude, "local-agent-mode-sessions", "org", "user");
            Directory.CreateDirectory(sessionRoot);
            File.WriteAllText(Path.Combine(sessionRoot, "local_12345678-1234-1234-1234-123456789abc.json"), "{\"sessionId\":\"12345678-1234-1234-1234-123456789abc\",\"title\":\"Metadata title\",\"lastActivityAt\":1791552004000,\"initialMessage\":\"Must never become a title\"}");
            Directory.CreateDirectory(Path.Combine(sessionRoot, "12345678"));
            File.WriteAllText(Path.Combine(sessionRoot, "12345678", "audit.jsonl"), "{\"type\":\"result\",\"is_error\":false}\n");
            var claudeSessions = Sessions.ReadClaude(claude, true);
            Check(claudeSessions.Single().Title == "Metadata title" && claudeSessions.Single().Status == "已完成", "Desktop Claude audit lifecycle and metadata titles must parse");
            // Cached parses must still follow a client that keeps appending to the same files.
            File.AppendAllText(Path.Combine(sessionRoot, "12345678", "audit.jsonl"), "{\"type\":\"user\"}\n");
            File.WriteAllText(Path.Combine(sessionRoot, "local_12345678-1234-1234-1234-123456789abc.json"), "{\"sessionId\":\"12345678-1234-1234-1234-123456789abc\",\"title\":\"Renamed metadata\",\"lastActivityAt\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "}");
            var changedSessions = Sessions.ReadClaude(claude, true);
            Check(changedSessions.Single().Title == "Renamed metadata" && changedSessions.Single().Status == "运行中", "Changed session files must not be served from the parse cache");
            Check(PanelPlacement.Overlaps(new Bounds(0, 0, 340, 570), new Bounds(300, 500, 60, 60)) && !PanelPlacement.Overlaps(new Bounds(0, 0, 340, 570), new Bounds(352, 500, 60, 60)), "Panel and pet overlap must be detected exactly");
            var ids = new System.Collections.Generic.List<string>
            {
                "a",
                "b",
                "c"
            };
            Ordering.Move(ids, "a", "c");
            Check(string.Join(",", ids) == "b,c,a", "Dragging down must move past the target");
            Ordering.Move(ids, "a", "b");
            Check(string.Join(",", ids) == "a,b,c", "Dragging up must move before the target");
            Ordering.Move(ids, "missing", "b");
            Check(ids.Count == 3, "Unknown drag sources must not mutate order");
            File.WriteAllText(Path.Combine(root, "session_index.jsonl"), "{\"id\":\"12345678-1234-1234-1234-123456789abc\",\"thread_name\":\"Generated title\"}\n{\"id\":\"12345678-1234-1234-1234-123456789abc\",\"thread_name\":\"Renamed title\"}\n{partial");
            Check(Sessions.ReadCodexTitles(root).Values.Single() == "Renamed title", "Latest indexed title wins even during concurrent append");
            var handoffs = new Handoffs(store);
            bool refused = false;
            try
            {
                handoffs.Prepare(a, b, new("s", "Task", "运行中", DateTimeOffset.UtcNow));
            }
            catch (InvalidOperationException)
            {
                refused = true;
            }

            Check(refused, "Running tasks must not hand off");
            var p = handoffs.Prepare(a, b, new("s", "CON/test@example.com", "已完成", DateTimeOffset.UtcNow));
            Check(!File.Exists(handoffs.Draft(p)), "Preparation must not fabricate a handoff document");
            Check(new Handoffs(new Store(root)).Pending?.Id == p.Id, "Pending handoff must survive restart");
            bool missing = false;
            try
            {
                handoffs.Complete();
            }
            catch (IOException)
            {
                missing = true;
            }

            Check(missing && handoffs.Pending?.Id == p.Id, "Missing documents must preserve pending for retry");
            var content = "# Real handoff\nUser supplied context";
            File.WriteAllText(handoffs.Draft(p), content);
            bool clipboardFailed = false;
            try
            {
                handoffs.Transfer(_ => throw new IOException("Clipboard busy"));
            }
            catch (IOException)
            {
                clipboardFailed = true;
            }

            Check(clipboardFailed && handoffs.History.Count == 0 && Directory.GetFiles(store.Handoffs, "*.md").Length == 0 && handoffs.Pending != null, "Clipboard failure must not commit a copy or history");
            var done = handoffs.Complete();
            Check(File.ReadAllText(done.Record.Path) == content && done.Clipboard.Contains(content) && done.Clipboard.Contains(done.Record.Path), "Clipboard must include saved body and absolute path");
            Check(handoffs.Pending != null && handoffs.History.Count == 1, "Pending survives until clipboard copying succeeds");
            handoffs.Clear();
            Check(handoffs.Pending == null, "Successful copy clears pending");
            handoffs.Forget(done.Record.Id);
            Check(File.Exists(done.Record.Path) && handoffs.History.Count == 0, "Removing a record must preserve its document");
            File.WriteAllText(Path.Combine(store.Handoffs, "pending.json"), "{broken");
            Check(handoffs.Pending == null && Directory.GetFiles(store.Handoffs, "pending.json.unreadable-*.json").Length == 1, "Corrupt handoff state must be preserved without blocking the application");
            var recoveryRoot = Path.Combine(root, "recovery");
            var recovery = new Store(recoveryRoot);
            File.WriteAllText(Path.Combine(recoveryRoot, "preferences.json"), "{broken");
            Check(new Store(recoveryRoot).Preferences.AutoQuota, "Corrupt preferences must recover to defaults");
            Check(Directory.GetFiles(recoveryRoot, "preferences.json.unreadable-*.json").Length == 1, "Corrupt preferences must be preserved");
            File.WriteAllText(Path.Combine(recoveryRoot, "accounts.json"), "{broken");
            bool badAccounts = false;
            try
            {
                _ = new Store(recoveryRoot);
            }
            catch (IOException ex)
            {
                badAccounts = ex.Message.Contains("accounts.json");
            }

            Check(badAccounts, "Corrupt accounts must block startup with their path");
            store.Preferences.SessionOrder[a.Id] = ["s"];
            store.Preferences.ExpandedAccounts.Add(a.Id);
            store.Remove(a);
            Check(!store.Preferences.SessionOrder.ContainsKey(a.Id) && !store.Preferences.ExpandedAccounts.Contains(a.Id), "Removal cleans associated preferences");
            var placed = PanelPlacement.Compute(new Bounds(0, 0, 1200, 800), new Bounds(50, 750, 60, 60), 340, 570);
            Check(placed.X == 122 && placed.Bottom == 800, "Place to the right and clamp vertically");
            var clamped = PanelPlacement.ClampPet(new Bounds(1300, 900, 100, 100), [new Bounds(0, 0, 1200, 800), new Bounds(1200, 0, 1200, 700)]);
            Check(clamped.Bottom <= 800, "Pet in a display gap must move onto a display");
            Check(SessionRouting.CanDeepLink("codex", "12345678-1234-1234-1234-123456789abc", 1), "A single Codex instance can deep-link");
            Check(!SessionRouting.CanDeepLink("codex", "12345678-1234-1234-1234-123456789abc", 2) && !SessionRouting.CanDeepLink("claude", "bad", 1), "Multiple instances and Claude cannot deep-link");
            var oldRecord = JsonSerializer.Deserialize<HandoffRecord>("{\"Id\":\"old\",\"SourceId\":\"a\",\"TargetId\":\"b\",\"Title\":\"task\",\"Path\":\"x\",\"Created\":\"2026-01-01T00:00:00Z\"}")!;
            Check(oldRecord.SourceName == "已移除账号", "Old handoff history remains readable");
            var insertion = new System.Collections.Generic.List<string>
            {
                "a",
                "b",
                "c"
            };
            Ordering.MoveBefore(insertion, "a", "c");
            Check(string.Join(",", insertion) == "b,a,c", "Insertion line means before the target");
            var scaled = PanelPlacement.Compute(new Bounds(1920, 0, 2560, 1440), new Bounds(2000, 1200, 285, 472), 510, 855, 18);
            Check(scaled.X == 2303 && scaled.Y == 585 && scaled.Width == 510, "Physical origins and scaled dimensions stay separate");
            Check(Sessions.Status("error", true, DateTimeOffset.UtcNow) == "遇到问题", "Failed tasks must remain distinct from stopped tasks");
            FixtureTests.Run(root);
            Console.WriteLine("PASS: persistence, ACLs, process isolation, quota windows, task lifecycle, handoff recovery and document preservation");
        }
        finally
        {
            if (Directory.Exists(root))
                Directory.Delete(root, true);
        }
    }
}