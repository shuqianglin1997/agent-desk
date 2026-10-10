using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using Microsoft.VisualBasic.FileIO;

namespace AgentDeskNative.Windows;

public sealed class PanelModel : Observable, IDisposable
{
    public Store Store
    {
        get;
    }
    public Clients Clients { get; } = new();
    public QuotaService Quotas
    {
        get;
    }
    public Handoffs Handoffs
    {
        get;
    }
    public bool Demo
    {
        get;
    }
    public bool Interacting
    {
        get; private set;
    }
    public bool Sorting
    {
        get; set;
    }

    public Action? ConfigurationChanged;
    public Action? RequestHide;
    public Func<string, string, string?>? Prompt;
    public Func<Account, (bool Confirm, bool Recycle)>? ConfirmDelete;
    public Func<string, bool>? Confirm;
    public event Action<string>? BackgroundError;
    public ObservableCollection<GroupModel> Groups { get; } = [];
    public ObservableCollection<DiscoveredModel> Discovered { get; } = [];
    public ObservableCollection<HistoryModel> History { get; } = [];

    private readonly Dictionary<string, AccountModel> accounts = [];
    private readonly Dictionary<string, GroupModel> groups = [];
    private readonly Dictionary<string, ImageSource?> icons = [];
    private readonly Dictionary<string, Snapshot> snapshots = [];
    private readonly Dictionary<string, Quota> demoQuotas = [];
    private readonly DispatcherTimer pollTimer = new();
    private readonly DispatcherTimer clock = new()
    {
        Interval = TimeSpan.FromSeconds(30)
    };
    private readonly DispatcherTimer messageTimer = new()
    {
        Interval = TimeSpan.FromSeconds(6)
    };
    private bool polling, disposed, started;
    private DateTimeOffset lastQuota;
    private string page = "accounts", message = "", newName = "";
    private int newKind;
    private bool allHistory;
    public string Page
    {
        get => page;
        set
        {
            if (Set(ref page, value))
            {
                Changed(nameof(Title));
                Changed(nameof(IsAccounts));
                Changed(nameof(IsSettings));
                Changed(nameof(IsInfo));
                Changed(nameof(IsAdd));
            }
        }
    }

    public string Title => Page switch
    {
        "settings" => "设置",
        "info" => "信息",
        "add" => "新建账号",
        _ => "AgentDesk Native"
    };
    public bool IsAccounts => Page == "accounts";
    public bool IsSettings => Page == "settings";
    public bool IsInfo => Page == "info";
    public bool IsAdd => Page == "add";

    public string Message
    {
        get => message;
        private set
        {
            Set(ref message, value);
            Changed(nameof(HasMessage));
        }
    }

    public bool HasMessage => Message.Length > 0;

    public string NewName
    {
        get => newName;
        set
        {
            Set(ref newName, value);
            CommandManager.InvalidateRequerySuggested();
        }
    }

    public int NewKind
    {
        get => newKind;
        set
        {
            Set(ref newKind, value);
            Changed(nameof(NewCodex));
            Changed(nameof(NewClaude));
        }
    }

    public bool NewCodex
    {
        get => NewKind == 0;
        set
        {
            if (value)
                NewKind = 0;
        }
    }

    public bool NewClaude
    {
        get => NewKind == 1;
        set
        {
            if (value)
                NewKind = 1;
        }
    }

    public bool ThirdParty
    {
        get; set;
    }

    public bool PetEnabled
    {
        get => Store.Preferences.PetEnabled;
        set
        {
            Store.Preferences.PetEnabled = value;
            Store.Preferences.PetVisible = value;
            Configure();
            Changed();
            Changed(nameof(PetVisible));
        }
    }

    public bool PetVisible => Store.Preferences.PetVisible;

    public bool AutoQuota
    {
        get => Store.Preferences.AutoQuota;
        set
        {
            Store.Preferences.AutoQuota = value;
            Store.Save();
            Changed();
        }
    }

    public bool HasPending => Handoffs.Pending != null;
    public string PendingTitle => Handoffs.Pending?.Title ?? "";
    public string PendingRoute => Handoffs.Pending is { } p ? AccountName(p.SourceId) + " → " + AccountName(p.TargetId) : "";
    public bool HandoffBusy
    {
        get; private set;
    }
    public string ContinueLabel => HandoffBusy ? "准备中…" : "继续接力";
    public string HistoryMore => allHistory ? "收起记录" : $"查看其余 {Math.Max(0, Handoffs.History.Count - 5)} 条";
    public bool HasHistoryMore => Handoffs.History.Count > 5;
    public bool NoAccounts => Store.Accounts.Count == 0;
    public string DataPath => Store.Handoffs;
    public Account? BusyAccount => Store.Accounts.FirstOrDefault(a => snapshots.TryGetValue(a.Id, out var s) && s.Sessions.Any(t => t.Status is "运行中" or "等待输入"));
    public Command Info
    {
        get;
    }
    public Command Settings
    {
        get;
    }
    public Command Add
    {
        get;
    }
    public Command CancelAdd
    {
        get;
    }
    public Command Create
    {
        get;
    }
    public Command Import
    {
        get;
    }
    public Command TogglePet
    {
        get;
    }
    public Command ClearMessage
    {
        get;
    }
    public Command RefreshAllCommand
    {
        get;
    }
    public Command RevealHandoffs
    {
        get;
    }
    public Command FinishHandoff
    {
        get;
    }
    public Command ExistingHandoff
    {
        get;
    }
    public Command CopyPrompt
    {
        get;
    }
    public Command CancelHandoff
    {
        get;
    }
    public Command MoreHistory
    {
        get;
    }
    public Command DiscoverAgain
    {
        get;
    }
    public Command TaskbarSettings
    {
        get;
    }
    public Command Quit { get; } = new(() => Application.Current.Shutdown());

    public PanelModel(Store store, bool demo)
    {
        Store = store;
        Demo = demo;
        Quotas = new QuotaService(Clients);
        Handoffs = new Handoffs(store);
        Info = new(() => Navigate("info"));
        Settings = new(() => Navigate("settings"));
        Add = new(() => Navigate("add"));
        CancelAdd = new(() => Page = "accounts");
        Create = new(() => Run(CreateAccount), () => !Interacting && !string.IsNullOrWhiteSpace(NewName));
        Import = new(() => Run(ImportAccount));
        TogglePet = new(() =>
        {
            Store.Preferences.PetVisible = !PetVisible;
            Configure();
            Changed(nameof(PetVisible));
        });
        ClearMessage = new(() => Message = "");
        RefreshAllCommand = new(() => Run(RefreshAll));
        RevealHandoffs = new(() => Run(() =>
        {
            Store.PrivateDirectory(Store.Handoffs);
            Reveal(Store.Handoffs);
        }));
        FinishHandoff = new(() => Run(() => Finish(false)), () => !HandoffBusy);
        ExistingHandoff = new(() => Run(() => Finish(true)), () => !HandoffBusy);
        CopyPrompt = new(() => Run(() =>
        {
            var p = Handoffs.Pending ?? throw new IOException("没有待继续的接力。");
            ClipboardWriter.Set(Handoffs.Prompt(Handoffs.Draft(p)));
        }));
        CancelHandoff = new(() => Run(() =>
        {
            Handoffs.Clear();
            UpdateHandoffs();
        }));
        MoreHistory = new(() =>
        {
            allHistory = !allHistory;
            UpdateHandoffs();
        });
        DiscoverAgain = new(() => Run(async () =>
        {
            await Clients.Discover();
            icons.Clear();
            MergeAccounts();
        }));
        TaskbarSettings = new(() => Run(() => Process.Start(new ProcessStartInfo("ms-settings:taskbar") { UseShellExecute = true })?.Dispose()));
        messageTimer.Tick += (_, _) =>
        {
            Message = "";
            messageTimer.Stop();
        };
        pollTimer.Tick += async (_, _) => await Poll();
        clock.Tick += (_, _) => MergeAccounts();
        if (Demo)
            PopulateDemo();
        MergeAccounts();
        UpdateHandoffs();
        if (Store.RecoveryDetail is { } recovery)
            Notify(recovery);
    }

    public async Task Start()
    {
        if (Demo)
            return;
        await Execute(async () =>
        {
            await Clients.Discover();
            icons.Clear();
            await Poll();
            if (AutoQuota)
                await RefreshAll();
        });
        clock.Start();
        if (pollTimer.Interval <= TimeSpan.Zero)
            pollTimer.Interval = TimeSpan.FromSeconds(20);
        pollTimer.Start();
        started = true;
    }
    public void Opened()
    {
        if (Demo || !started || !AutoQuota)
            return;
        Run(async () =>
        {
            foreach (var account in Store.Accounts.ToArray())
                await Refresh(account, false);
        });
    }

    public void SetVisible(bool panel, bool pet) => pollTimer.Interval = TimeSpan.FromSeconds(panel || pet ? 5 : 20);
    private void Configure()
    {
        Store.Save();
        ConfigurationChanged?.Invoke();
    }

    private void Navigate(string destination) => Page = Page == destination ? "accounts" : destination;
    public void Notify(string value)
    {
        Message = value;
        messageTimer.Stop();
        messageTimer.Start();
        BackgroundError?.Invoke(value);
    }

    public void Run(Action action) => Run(() =>
    {
        action();
        return Task.CompletedTask;
    });
    public async void Run(Func<Task> action) => await Execute(action);
    private async Task Execute(Func<Task> action)
    {
        Interacting = true;
        CommandManager.InvalidateRequerySuggested();
        try
        {
            await action();
        }
        catch (Exception e)
        {
            Notify(e is IOException or InvalidOperationException ? e.Message : "操作失败，请稍后重试。");
        }
        finally
        {
            Interacting = false;
            CommandManager.InvalidateRequerySuggested();
        }
    }

    private async Task Poll()
    {
        if (polling || disposed || Demo)
            return;
        polling = true;
        try
        {
            await Task.Run(() => Clients.Scan());
            var list = Store.Accounts.ToArray();
            var reads = await Task.Run(() => list.Select(a => (a.Id, Snapshot: Sessions.Read(a, Clients))).ToArray());
            foreach (var (id, snapshot) in reads)
                snapshots[id] = snapshot;
            MergeAccounts();
            ConfigurationChanged?.Invoke();
            if (AutoQuota && DateTimeOffset.UtcNow - lastQuota > TimeSpan.FromMinutes(5))
                Run(RefreshAll);
        }
        catch
        {
            Notify("无法刷新客户端状态，请稍后重试。");
        }
        finally
        {
            polling = false;
        }
    }

    public async Task Refresh(Account account, bool manual = true)
    {
        if (Demo)
            return;
        if (accounts.TryGetValue(account.Id, out var vm))
            vm.Busy = true;
        try
        {
            await Quotas.Refresh(account, manual);
        }
        finally
        {
            if (vm != null)
                vm.Busy = false;
            MergeAccounts();
        }
    }

    private async Task RefreshAll()
    {
        lastQuota = DateTimeOffset.UtcNow;
        foreach (var account in Store.Accounts.ToArray())
            await Refresh(account);
    }

    public List<Session> AllSessions => snapshots.Values.SelectMany(s => s.Sessions).ToList();

    public void MergeAccounts()
    {
        if (Sorting)
            return;
        foreach (var id in accounts.Keys.Except(Store.Accounts.Select(a => a.Id)).ToArray())
            accounts.Remove(id);
        foreach (var a in Store.Accounts)
        {
            if (!accounts.TryGetValue(a.Id, out var vm))
                accounts[a.Id] = vm = new AccountModel(this, a);
            vm.Update(snapshots.GetValueOrDefault(a.Id) ?? new Snapshot(false, [], "", 0), Demo ? demoQuotas.GetValueOrDefault(a.Id) : Quotas.Get(a.Id));
        }

        var ordered = new List<GroupModel>();
        foreach (var app in Store.Preferences.GroupOrder)
        {
            if (!groups.TryGetValue(app, out var vm))
                groups[app] = vm = new GroupModel(this, app);
            Merge(vm.Accounts, Store.Accounts.Where(a => a.App == app).Select(a => accounts[a.Id]));
            vm.Notify();
            if (vm.Accounts.Count > 0)
                ordered.Add(vm);
        }

        Merge(Groups, ordered);
        var discoveries = new List<DiscoveredModel>();
        foreach (var client in Clients.Installed.Where(c => Clients.Processes.Any(p => Store.SamePath(p.Executable, c.Executable) && Clients.Matches(p.CommandLine, new Account { Default = true, ProfilePath = c.DefaultProfile })) && !Store.Accounts.Any(a => a.App == c.App && a.Default) && !Store.Preferences.DismissedDefaults.Contains(c.App)))
        {
            var app = client.App;
            var existing = Discovered.FirstOrDefault(d => d.App == app);
            discoveries.Add(existing ?? new DiscoveredModel(app, "发现直接打开的 " + Label(app), Store.Accounts.Any(a => a.App == app), new(() => AddDefault(client)), new(() =>
            {
                Store.Preferences.DismissedDefaults.Add(app);
                Store.Save();
                MergeAccounts();
            })));
        }

        if (Demo && discoveries.Count == 0)
            discoveries.Add(new("codex", "发现直接打开的 Codex", true, new(() => Notify("演示模式")), new(() => Discovered.Clear())));
        Merge(Discovered, discoveries);
        Changed(nameof(NoAccounts));
    }

    private bool darkIcons;
    /// Dark panels need the package's white "unplated" logo; the exe icon is the light-mode glyph.
    public void UseDarkIcons(bool dark)
    {
        if (darkIcons == dark && icons.Count > 0)
            return;
        darkIcons = dark;
        icons.Clear();
        foreach (var group in Groups)
            group.Notify();
    }

    public ImageSource? ClientIcon(string app)
    {
        if (icons.TryGetValue(app, out var icon))
            return icon;
        try
        {
            var path = Clients.Installed.FirstOrDefault(c => c.App == app)?.Executable;
            var assets = path == null ? null : Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(path)!)!, "assets");
            var logo = assets == null ? null : Path.Combine(assets, "Square44x44Logo.targetsize-32_altform-" + (darkIcons ? "unplated" : "lightunplated") + ".png");
            if (logo != null && File.Exists(logo))
                icon = LoadImage(logo);
            else
            {
                using var extracted = path == null ? null : System.Drawing.Icon.ExtractAssociatedIcon(path);
                if (extracted != null)
                {
                    icon = System.Windows.Interop.Imaging.CreateBitmapSourceFromHIcon(extracted.Handle, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                    icon.Freeze();
                }
            }
        }
        catch
        {
        }

        if (icon == null)
        {
            var folder = Path.Combine(AppContext.BaseDirectory, "Resources", "ClientIcons");
            var bundled = Path.Combine(folder, app + "-dark.png");
            if (!darkIcons || !File.Exists(bundled))
                bundled = Path.Combine(folder, app + ".png");
            if (File.Exists(bundled))
                icon = LoadImage(bundled);
        }

        icons[app] = icon;
        return icon;
    }

    private static BitmapImage LoadImage(string file)
    {
        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.UriSource = new Uri(file);
        bitmap.EndInit();
        bitmap.Freeze();
        return bitmap;
    }

    public async Task OpenSession(Account account, Session session)
    {
        if (Demo)
        {
            Notify("演示模式，不打开客户端。");
            return;
        }

        await Clients.Open(account);
        int count = Clients.Processes.Count(p => p.Executable.EndsWith("ChatGPT.exe", StringComparison.OrdinalIgnoreCase) && !Clients.Arguments(p.CommandLine).Any(a => a.StartsWith("--type", StringComparison.Ordinal) || a == "--crashpad-handler"));
        if (SessionRouting.CanDeepLink(account.App, session.Id, count))
            Process.Start(new ProcessStartInfo("codex://threads/" + session.Id) { UseShellExecute = true })?.Dispose();
        RequestHide?.Invoke();
    }

    private async Task CreateAccount()
    {
        if (Demo)
        {
            Notify("演示模式，不创建真实账号。");
            return;
        }

        var account = Store.Create(NewName, NewKind == 0 ? "codex" : "claude");
        NewName = "";
        Page = "accounts";
        MergeAccounts();
        await Clients.Open(account);
    }

    private Task ImportAccount()
    {
        var folder = new OpenFolderDialog
        {
            Title = "选择客户端数据目录"
        };
        if (folder.ShowDialog() != true)
            return Task.CompletedTask;
        var app = NewKind == 0 ? "codex" : "claude";
        if (Store.Accounts.Any(a => a.App == app && Store.SamePath(a.ProfilePath, folder.FolderName)))
            throw new IOException("这个目录已被其他账号引用。");
        var client = Clients.Installed.FirstOrDefault(c => c.App == app);
        bool isDefault = client != null && Store.SamePath(client.DefaultProfile, folder.FolderName);
        Store.Add(new Account { Name = string.IsNullOrWhiteSpace(NewName) ? Label(app) + " 账号" : NewName.Trim(), App = app, ProfilePath = folder.FolderName, SessionRoot = isDefault ? client!.DefaultSessions : app == "codex" ? Path.Combine(folder.FolderName, "codex-home") : folder.FolderName, Default = isDefault, ThirdParty = !isDefault && app == "claude" && ThirdParty });
        Page = "accounts";
        MergeAccounts();
        return Task.CompletedTask;
    }

    public Task Relocate(Account account)
    {
        var folder = new OpenFolderDialog
        {
            Title = "重新定位账号数据目录"
        };
        if (folder.ShowDialog() != true)
            return Task.CompletedTask;
        if (Store.Accounts.Any(a => a.Id != account.Id && a.App == account.App && Store.SamePath(a.ProfilePath, folder.FolderName)))
            throw new IOException("这个目录已被其他账号引用。");
        account.ProfilePath = folder.FolderName;
        var client = Clients.Installed.FirstOrDefault(c => c.App == account.App);
        account.Default = client != null && Store.SamePath(client.DefaultProfile, folder.FolderName);
        if (account.Default)
            account.ThirdParty = false;
        account.SessionRoot = account.Default ? client!.DefaultSessions : account.App == "codex" ? Path.Combine(folder.FolderName, "codex-home") : folder.FolderName;
        Store.Save();
        Quotas.Clear(account.Id);
        snapshots.Remove(account.Id);
        MergeAccounts();
        return Task.CompletedTask;
    }

    public void Rename(Account account)
    {
        var name = Prompt?.Invoke("账号名称", account.Name);
        if (string.IsNullOrWhiteSpace(name))
            return;
        account.Name = name.Trim();
        Store.Save();
        MergeAccounts();
    }

    public void Remove(Account account)
    {
        if (Handoffs.Pending is { } pending && (pending.SourceId == account.Id || pending.TargetId == account.Id))
            throw new IOException("请先完成或取消这个账号的待接力任务。");
        var choice = ConfirmDelete?.Invoke(account) ?? (false, false);
        if (!choice.Item1)
            return;
        if (choice.Item2 && !account.Default && Directory.Exists(account.ProfilePath))
        {
            if (Store.SamePath(account.ProfilePath, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)) || Store.SamePath(account.ProfilePath, Store.Root))
                throw new IOException("不能回收用户目录或 AgentDesk Native 数据根目录。");
            FileSystem.DeleteDirectory(account.ProfilePath, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin);
        }

        Store.Remove(account);
        Quotas.Clear(account.Id);
        snapshots.Remove(account.Id);
        MergeAccounts();
    }

    public void SwitchDefault(Account account, Client client)
    {
        if (Store.Accounts.Any(a => a.Id != account.Id && a.App == client.App && a.Default))
            throw new IOException("默认数据已被另一个账号引用。");
        if (Confirm?.Invoke("改用直接打开的 " + Label(client.App) + " 数据？原目录将保留。") != true)
            return;
        account.ProfilePath = client.DefaultProfile;
        account.SessionRoot = client.DefaultSessions;
        account.Default = true;
        account.ThirdParty = false;
        Store.Save();
        Quotas.Clear(account.Id);
        snapshots.Remove(account.Id);
        MergeAccounts();
    }

    private void AddDefault(Client client)
    {
        Store.Add(new Account { App = client.App, Name = Label(client.App) + " 默认账号", ProfilePath = client.DefaultProfile, SessionRoot = client.DefaultSessions, Default = true });
        MergeAccounts();
        if (AutoQuota)
            Run(RefreshAll);
    }

    public void BeginHandoff(Account source, Account target, Session session)
    {
        var pending = Handoffs.Prepare(source, target, session);
        try
        {
            ClipboardWriter.Set(Handoffs.Prompt(Handoffs.Draft(pending)));
        }
        finally
        {
            UpdateHandoffs();
        }

        if (!Demo)
            Run(async () =>
            {
                await Clients.Open(source);
                RequestHide?.Invoke();
            });
    }

    private async Task Finish(bool choose)
    {
        string? path = null;
        if (choose)
        {
            var picker = new OpenFileDialog
            {
                Filter = "Markdown|*.md",
                CheckFileExists = true
            };
            if (picker.ShowDialog() != true)
                return;
            path = picker.FileName;
        }

        var pending = Handoffs.Pending ?? throw new IOException("没有待继续的接力。");
        var target = Store.Accounts.FirstOrDefault(a => a.Id == pending.TargetId) ?? throw new IOException("目标账号已移除。");
        HandoffBusy = true;
        Changed(nameof(HandoffBusy));
        Changed(nameof(ContinueLabel));
        try
        {
            Handoffs.Transfer(ClipboardWriter.Set, path);
            UpdateHandoffs();
            if (!Demo)
                await Clients.Open(target);
            Notify("接力文档已复制，请在目标新对话粘贴发送。");
        }
        finally
        {
            HandoffBusy = false;
            Changed(nameof(HandoffBusy));
            Changed(nameof(ContinueLabel));
        }
    }

    private string AccountName(string id) => Store.Accounts.FirstOrDefault(a => a.Id == id)?.Name ?? "已移除账号";
    public void UpdateHandoffs()
    {
        Changed(nameof(HasPending));
        Changed(nameof(PendingTitle));
        Changed(nameof(PendingRoute));
        Changed(nameof(HistoryMore));
        Changed(nameof(HasHistoryMore));
        var records = Handoffs.History.Take(allHistory ? int.MaxValue : 5).Select(r => History.FirstOrDefault(h => h.Id == r.Id) ?? new HistoryModel(r.Id, $"{r.Created.LocalDateTime:MM-dd HH:mm} {r.SourceName} → {r.TargetName}", r.Title, r.Path, new(() => Run(() => Reveal(r.Path))), new(() =>
        {
            Handoffs.Forget(r.Id);
            UpdateHandoffs();
        })));
        Merge(History, records);
        if (Handoffs.RecoveryDetail is { } recovery)
            Notify(recovery);
    }

    public static string Label(string app) => app == "codex" ? "Codex" : "Claude";
    public static void Reveal(string path)
    {
        var info = new ProcessStartInfo("explorer.exe")
        {
            UseShellExecute = false
        };
        info.ArgumentList.Add(File.Exists(path) ? "/select," + path : path);
        Process.Start(info)?.Dispose();
    }

    private void PopulateDemo()
    {
        foreach (var (app, name, missing) in new[]
        {
            ("codex", "Omnix 工作", false),
            ("codex", "个人项目", true),
            ("claude", "Claude 研究", false)
        }

        )
        {
            var path = Path.Combine(Store.Root, name);
            if (!missing)
                Directory.CreateDirectory(path);
            var a = new Account
            {
                App = app,
                Name = name,
                ProfilePath = path,
                SessionRoot = path
            };
            Store.Add(a);
            var now = DateTimeOffset.UtcNow;
            var list = new List<Session>
            {
                new(Guid.NewGuid().ToString(), "完善 Windows 端原生体验", "运行中", now.AddMinutes(-2)),
                new(Guid.NewGuid().ToString(), "确认交互与验收结果", "等待输入", now.AddMinutes(-5)),
                new(Guid.NewGuid().ToString(), "整理账号隔离方案", "已完成", now.AddMinutes(-22)),
                new(Guid.NewGuid().ToString(), "检查网络请求", "遇到问题", now.AddHours(-1)),
                new(Guid.NewGuid().ToString(), "同步项目进度", "已完成", now.AddHours(-3)),
                new(Guid.NewGuid().ToString(), "验证测试样本", "已完成", now.AddDays(-1))
            };
            snapshots[a.Id] = new Snapshot(!missing, list, "", 1);
            demoQuotas[a.Id] = new Quota([new("5h", app == "codex" ? 72 : 92, now.AddHours(3)), new("周", 36, now.AddDays(4))], now.AddMinutes(-8), missing ? "网络暂不可用" : "", missing);
        }

        var source = Store.Accounts[0];
        var target = Store.Accounts[2];
        Handoffs.Prepare(source, target, new Session("demo", "把实现与验证交给下一位 agent", "已完成", DateTimeOffset.UtcNow));
        var history = Enumerable.Range(0, 7).Select(i => new HandoffRecord("demo-" + i, source.Id, target.Id, "交接文档已保存", Path.Combine(Store.Root, "demo.md"), DateTimeOffset.UtcNow.AddHours(-i), source.Name, target.Name)).ToList();
        Store.Write("handoffs/history.json", history);
        Store.Preferences.PetEnabled = true;
        Store.Preferences.PetVisible = true;
    }

    public void Dispose()
    {
        disposed = true;
        pollTimer.Stop();
        clock.Stop();
        messageTimer.Stop();
    }
}
