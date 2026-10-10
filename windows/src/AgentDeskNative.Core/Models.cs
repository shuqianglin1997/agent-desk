using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

namespace AgentDeskNative.Windows;

public sealed class Account
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string App { get; set; } = "codex";
    public string ProfilePath { get; set; } = "";
    public string SessionRoot { get; set; } = "";
    public bool Default
    {
        get; set;
    }
    public bool ThirdParty
    {
        get; set;
    }
}

public sealed record Session(string Id, string Title, string Status, DateTimeOffset Updated, string Cwd = "", string Path = "");
public sealed record QuotaWindow(string Name, double Used, DateTimeOffset? Resets);
public sealed record Quota(List<QuotaWindow> Windows, DateTimeOffset Observed, string Detail, bool Cached = false);
public sealed record Client(string App, string Executable, string DefaultProfile, string DefaultSessions);
public sealed record Running(int Pid, string Executable, string CommandLine, long Handle);
public sealed record Snapshot(bool Running, List<Session> Sessions, string Detail, long Handle);
public sealed class Preferences
{
    public bool AutoQuota { get; set; } = true;
    public bool PetEnabled
    {
        get; set;
    }
    public bool PetVisible { get; set; } = true;
    public double? PetLeft
    {
        get; set;
    }
    public double? PetTop
    {
        get; set;
    }
    public List<string> GroupOrder { get; set; } = ["codex", "claude"];
    public Dictionary<string, List<string>> SessionOrder { get; set; } = [];
    public List<string> DismissedDefaults { get; set; } = [];
    public List<string> ExpandedAccounts { get; set; } = [];
    public List<string> Collapsed { get; set; } = [];
}

public sealed class Store
{
    public static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    public string Root
    {
        get;
    }
    public List<Account> Accounts
    {
        get; private set;
    }
    public Preferences Preferences
    {
        get;
    }
    public string Handoffs => Path.Combine(Root, "handoffs");
    public string? RecoveryDetail
    {
        get; private set;
    }

    public Store(string? root = null)
    {
        Root = root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AgentDeskNative");
        PrivateDirectory(Root);
        try
        {
            Accounts = Read<List<Account>>("accounts.json") ?? [];
        }
        catch (JsonException e)
        {
            throw new IOException("账号文件无法读取，请检查：" + Path.Combine(Root, "accounts.json"), e);
        }

        try
        {
            Preferences = Read<Preferences>("preferences.json") ?? new();
        }
        catch (JsonException)
        {
            File.Move(Path.Combine(Root, "preferences.json"), Path.Combine(Root, "preferences.json.unreadable-" + Guid.NewGuid().ToString("N") + ".json"));
            Preferences = new();
            RecoveryDetail = "偏好文件无法读取，已保留备份并恢复默认设置。";
        }
    }

    public T? Read<T>(string name) => File.Exists(Path.Combine(Root, name)) ? JsonSerializer.Deserialize<T>(File.ReadAllText(Path.Combine(Root, name)), Json) : default;
    public void Save()
    {
        Write("accounts.json", Accounts);
        Write("preferences.json", Preferences);
    }

    public void Write<T>(string name, T value)
    {
        var target = Path.Combine(Root, name);
        PrivateDirectory(Path.GetDirectoryName(target)!);
        var temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(value, Json));
            File.Move(temp, target, true);
        }
        finally
        {
            if (File.Exists(temp))
                File.Delete(temp);
        }
    }

    public static void PrivateDirectory(string path)
    {
        if (Directory.Exists(path))
            return;
        var acl = new DirectorySecurity();
        acl.SetAccessRuleProtection(true, false);
        acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User!, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        FileSystemAclExtensions.Create(new DirectoryInfo(path), acl);
    }

    public Account Create(string name, string app)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("请输入账号名称。");
        var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".agentdesk-native", "profiles", Guid.NewGuid().ToString("N")[..10]);
        PrivateDirectory(profile);
        var account = new Account
        {
            Name = name.Trim(),
            App = app,
            ProfilePath = profile,
            SessionRoot = app == "codex" ? Path.Combine(profile, "codex-home") : profile
        };
        PrivateDirectory(account.SessionRoot);
        Add(account);
        return account;
    }

    public void Add(Account account)
    {
        if (string.IsNullOrWhiteSpace(account.Name))
            throw new InvalidOperationException("请输入账号名称。");
        account.ProfilePath = Path.GetFullPath(account.ProfilePath);
        account.SessionRoot = Path.GetFullPath(account.SessionRoot);
        if (Accounts.Any(a => a.App == account.App && SamePath(a.ProfilePath, account.ProfilePath)))
            throw new InvalidOperationException("这个客户端目录已经添加。");
        Accounts.Add(account);
        Save();
    }

    public void Remove(Account account)
    {
        Accounts.Remove(account);
        Preferences.SessionOrder.Remove(account.Id);
        Preferences.ExpandedAccounts.Remove(account.Id);
        Save();
    }

    public static bool SamePath(string a, string b) => string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
}

public static class J
{
    public static JsonElement At(this JsonElement e, string key) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) ? v : default;
    public static string Text(this JsonElement e, string key, string fallback = "") => e.At(key).ValueKind == JsonValueKind.String ? e.At(key).GetString() ?? fallback : fallback;
    public static double Number(this JsonElement e, string key, double fallback = 0) => e.At(key).TryNumber(fallback);
    public static double TryNumber(this JsonElement e, double fallback = 0) => e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out var d) ? d : fallback;
    public static DateTimeOffset Time(this JsonElement e, string key) => DateTimeOffset.TryParse(e.Text(key), out var t) ? t : DateTimeOffset.FromUnixTimeMilliseconds((long)e.Number(key));
}