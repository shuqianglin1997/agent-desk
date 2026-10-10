using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using System.Windows.Media;

namespace AgentDeskNative.Windows;

public abstract class Observable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected void Changed([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
            return false;
        field = value;
        Changed(name);
        return true;
    }

    public static void Merge<T>(ObservableCollection<T> target, IEnumerable<T> ordered)
    {
        var items = ordered.ToList();
        foreach (var item in target.ToArray())
            if (!items.Contains(item))
                target.Remove(item);
        for (int i = 0; i < items.Count; i++)
        {
            int existing = target.IndexOf(items[i]);
            if (existing < 0)
                target.Insert(i, items[i]);
            else if (existing != i)
                target.Move(existing, i);
        }
    }
}

public sealed class Command(Action action, Func<bool>? can = null) : ICommand
{
    public bool CanExecute(object? parameter) => can?.Invoke() ?? true;
    public void Execute(object? parameter) => action();
    public event EventHandler? CanExecuteChanged { add => CommandManager.RequerySuggested += value; remove => CommandManager.RequerySuggested -= value; }
}

public sealed class QuotaRowModel : Observable
{
    public QuotaWindow Value { get; private set; } = new("", 0, null);
    public string Label => Value.Name;
    public string Percent => $"{Value.Used:0.#}%";
    public string ColorKey => Value.Used >= 90 ? "Red" : Value.Used >= 70 ? "Amber" : "TextPrimary";
    public string Reset => Value.Resets is not DateTimeOffset at ? "" : at <= DateTimeOffset.UtcNow ? "已重置 · 待更新用量" : at - DateTimeOffset.UtcNow is var left && left.TotalHours >= 24 ? $"{(int)Math.Ceiling(left.TotalDays)} 天后重置" : $"{Math.Max(1, (int)Math.Ceiling(left.TotalHours))} 小时后重置";
    public string Tip => $"已用 {Value.Used:0.#}% · 剩余 {100 - Value.Used:0.#}%\n{Value.Resets?.LocalDateTime:yyyy-MM-dd HH:mm}";

    public void Update(QuotaWindow value)
    {
        if (Value != value)
        {
            Value = value;
            Changed(nameof(Label));
            Changed(nameof(Percent));
            Changed(nameof(ColorKey));
            Changed(nameof(Tip));
        }

        Changed(nameof(Reset));
    }
}

public sealed class SessionModel : Observable
{
    public AccountModel Account
    {
        get;
    }
    public Session Value
    {
        get; private set;
    }
    public string Title => Value.Title;
    public string Status => Value.Status;
    public string Time => Relative(Value.Updated);
    public string Symbol => Status switch
    {
        "运行中" => "●",
        "等待输入" => "◉",
        "已完成" => "✓",
        "遇到问题" or "已停止" => "!",
        _ => "·"
    };
    public string ColorKey => Status switch
    {
        "运行中" or "已完成" => "StatusGreen",
        "等待输入" => "Amber",
        "遇到问题" or "已停止" => "Red",
        _ => "TextSecondary"
    };
    public string Tip => $"{Status} · {Value.Updated.LocalDateTime:M/d HH:mm}\n{Value.Cwd}";
    public Command Open
    {
        get;
    }

    public SessionModel(AccountModel account, Session value)
    {
        Account = account;
        Value = value;
        Open = new Command(() => account.Owner.Run(() => account.Owner.OpenSession(account.Value, Value)));
    }

    public void Update(Session value)
    {
        if (Value != value)
        {
            Value = value;
            Changed(nameof(Title));
            Changed(nameof(Status));
            Changed(nameof(Symbol));
            Changed(nameof(ColorKey));
            Changed(nameof(Tip));
        }

        Changed(nameof(Time));
    }

    public static string Relative(DateTimeOffset date)
    {
        var age = DateTimeOffset.UtcNow - date;
        return age.TotalMinutes < 1 ? "刚刚" : age.TotalHours < 1 ? $"{(int)age.TotalMinutes} 分钟前" : age.TotalDays < 1 ? $"{(int)age.TotalHours} 小时前" : $"{(int)age.TotalDays} 天前";
    }
}

public sealed class AccountModel : Observable
{
    public PanelModel Owner
    {
        get;
    }
    public Account Value
    {
        get;
    }

    private readonly Dictionary<string, SessionModel> sessions = [];
    public ObservableCollection<SessionModel> Active { get; } = [];
    public ObservableCollection<SessionModel> Recent { get; } = [];
    public ObservableCollection<QuotaRowModel> Quotas { get; } = [];

    private Snapshot snapshot = new(false, [], "", 0);
    private Quota? quota;
    private bool busy;
    public string Name => Value.Name;
    public bool Running => snapshot.Running;
    public bool Missing => !System.IO.Directory.Exists(Value.ProfilePath);
    public string OpenLabel => Missing ? "重新定位…" : Running ? "前台" : "启动";
    public string Empty => Missing ? "数据目录不存在" : snapshot.Sessions.Count == 0 ? Strings.Get("account.empty") : "";
    public string QuotaDetail => Quotas.Count > 0 ? "" : busy ? "查询中…" : quota?.Detail.StartsWith("API Key", StringComparison.Ordinal) == true ? "不限" : quota?.Detail ?? "暂无数据";
    public bool HasQuotaDetail => QuotaDetail.Length > 0;
    // As on macOS, the divider only separates in-progress rows from finished ones.
    public bool HasDivider => Active.Count > 0 && Recent.Count > 0;
    public bool HasEmpty => Empty.Length > 0;
    public string Cache => quota?.Cached == true ? "缓存 · " + SessionModel.Relative(quota.Observed) : "";
    public string QuotaTip => quota?.Detail ?? "";

    public bool Busy
    {
        get => busy;
        set
        {
            if (Set(ref busy, value))
            {
                Changed(nameof(QuotaDetail));
                Changed(nameof(HasQuotaDetail));
                CommandManager.InvalidateRequerySuggested();
            }
        }
    }

    public bool Expanded => Owner.Store.Preferences.ExpandedAccounts.Contains(Value.Id);
    public bool HasMore => snapshot.Sessions.Count(s => s.Status is not ("运行中" or "等待输入")) > 3;
    public string MoreLabel => Expanded ? "收起" : "更多";
    public Command Open
    {
        get;
    }
    public Command Refresh
    {
        get;
    }
    public Command More
    {
        get;
    }

    public AccountModel(PanelModel owner, Account account)
    {
        Owner = owner;
        Value = account;
        Open = new Command(() => owner.Run(() => owner.Demo ? DemoOpen() : Missing ? owner.Relocate(Value) : owner.Clients.Open(Value)));
        Refresh = new Command(() => owner.Run(() => owner.Refresh(Value)), () => !Busy && !Missing);
        More = new Command(() =>
        {
            if (!owner.Store.Preferences.ExpandedAccounts.Remove(Value.Id))
                owner.Store.Preferences.ExpandedAccounts.Add(Value.Id);
            owner.Store.Save();
            owner.MergeAccounts();
        });
    }

    private System.Threading.Tasks.Task DemoOpen()
    {
        Owner.Notify("演示模式，不打开客户端。");
        return System.Threading.Tasks.Task.CompletedTask;
    }

    public void Update(Snapshot next, Quota? q)
    {
        if (snapshot.Running != next.Running)
        {
            snapshot = next;
            Changed(nameof(Running));
            Changed(nameof(OpenLabel));
        }
        else
            snapshot = next;
        if (quota != q)
        {
            quota = q;
            Changed(nameof(Cache));
            Changed(nameof(QuotaTip));
            Changed(nameof(QuotaDetail));
        }

        var rows = new List<QuotaRowModel>();
        foreach (var window in q?.Windows ?? [])
        {
            var row = Quotas.FirstOrDefault(r => r.Label == window.Name) ?? new QuotaRowModel();
            row.Update(window);
            rows.Add(row);
        }

        Merge(Quotas, rows);
        var ordered = Ordering.Apply(next.Sessions, Owner.Store.Preferences.SessionOrder.GetValueOrDefault(Value.Id));
        var live = new List<SessionModel>();
        var stopped = new List<SessionModel>();
        foreach (var session in ordered)
        {
            if (!sessions.TryGetValue(session.Id, out var row))
                sessions[session.Id] = row = new SessionModel(this, session);
            row.Update(session);
            (session.Status is "运行中" or "等待输入" ? live : stopped).Add(row);
        }

        foreach (var id in sessions.Keys.Except(ordered.Select(s => s.Id)).ToArray())
            sessions.Remove(id);
        Merge(Active, live);
        Merge(Recent, stopped.Take(Expanded ? 15 : 3));
        Changed(nameof(Name));
        Changed(nameof(Missing));
        Changed(nameof(OpenLabel));
        Changed(nameof(Empty));
        Changed(nameof(QuotaDetail));
        Changed(nameof(HasQuotaDetail));
        Changed(nameof(HasDivider));
        Changed(nameof(HasEmpty));
        Changed(nameof(HasMore));
        Changed(nameof(MoreLabel));
    }
}

public sealed class GroupModel : Observable
{
    public PanelModel Owner
    {
        get;
    }
    public string App
    {
        get;
    }
    public string Name => App == "codex" ? "Codex" : "Claude";
    public ImageSource? Icon => Owner.ClientIcon(App);
    public string Initial => Name[..1];
    public ObservableCollection<AccountModel> Accounts { get; } = [];
    public bool Expanded => !Owner.Store.Preferences.Collapsed.Contains(App);
    public string Count => Expanded ? "" : Accounts.Count.ToString();
    public Command Toggle
    {
        get;
    }

    public GroupModel(PanelModel owner, string app)
    {
        Owner = owner;
        App = app;
        Toggle = new Command(() =>
        {
            if (!owner.Store.Preferences.Collapsed.Remove(App))
                owner.Store.Preferences.Collapsed.Add(App);
            owner.Store.Save();
            Notify();
        });
    }

    public void Notify()
    {
        Changed(nameof(Expanded));
        Changed(nameof(Count));
        Changed(nameof(Icon));
    }
}

public sealed record HistoryModel(string Id, string Label, string Title, string Path, Command Open, Command Forget);
public sealed record DiscoveredModel(string App, string Label, bool HasAccounts, Command Add, Command Dismiss);