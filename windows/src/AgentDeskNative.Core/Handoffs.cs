using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace AgentDeskNative.Windows;

public sealed record PendingHandoff(string Id, string SourceId, string TargetId, string SessionId, string Title, DateTimeOffset Created);
public sealed record HandoffRecord(string Id, string SourceId, string TargetId, string Title, string Path, DateTimeOffset Created, string SourceName = "已移除账号", string TargetName = "已移除账号");
public sealed record PreparedHandoff(PendingHandoff Pending, HandoffRecord Record, string Body, string Clipboard);
public sealed class Handoffs(Store store)
{
    public string? RecoveryDetail
    {
        get; private set;
    }
    public PendingHandoff? Pending => ReadState<PendingHandoff>("pending.json");
    public List<HandoffRecord> History => ReadState<List<HandoffRecord>>("history.json") ?? [];

    private T? ReadState<T>(string name)
    {
        try
        {
            return store.Read<T>("handoffs/" + name);
        }
        catch (JsonException)
        {
            var original = Path.Combine(store.Handoffs, name);
            File.Move(original, Path.Combine(store.Handoffs, name + ".unreadable-" + Guid.NewGuid().ToString("N") + ".json"));
            RecoveryDetail = "一份接力记录无法读取，已在交接文件夹保留原始备份。";
            return default;
        }
    }

    public string Draft(PendingHandoff p) => Path.Combine(store.Handoffs, "drafts", p.Id, "handoff.md");
    public PendingHandoff Prepare(Account source, Account target, Session session)
    {
        if (Pending != null)
            throw new InvalidOperationException("已有待继续的接力，请先完成或取消。");
        if (session.Status is "运行中" or "等待输入")
            throw new InvalidOperationException("这个对话仍在进行或等待回应，请先在原账号里停下任务。");
        var p = new PendingHandoff(Guid.NewGuid().ToString("N"), source.Id, target.Id, session.Id, session.Title, DateTimeOffset.UtcNow);
        Store.PrivateDirectory(Path.GetDirectoryName(Draft(p))!);
        store.Write("handoffs/pending.json", p);
        return p;
    }

    public static string Prompt(string path) => Strings.Get("handoff.prompt").Replace("{path}", path);
    public PreparedHandoff Read(string? source = null)
    {
        var p = Pending ?? throw new InvalidOperationException("没有待继续的接力。");
        var file = source ?? Draft(p);
        if (!File.Exists(file))
            throw new IOException("交接文档尚未生成。请先在源对话发送提示词；也可选择已有 Markdown。");
        if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("请选择实际 Markdown 文件，不能使用链接。");
        if (!string.Equals(Path.GetExtension(file), ".md", StringComparison.OrdinalIgnoreCase))
            throw new IOException("请选择 Markdown 文档。");
        if (new FileInfo(file).Length > 8 * 1024 * 1024)
            throw new IOException("文档超过 8 MB，请精简后继续。");
        var markdown = File.ReadAllText(file, new UTF8Encoding(false, true));
        if (string.IsNullOrWhiteSpace(markdown))
            throw new IOException("交接文档为空。");
        Store.PrivateDirectory(store.Handoffs);
        var name = SafeName(p.Title);
        var saved = Path.Combine(store.Handoffs, $"{DateTime.Now:yyyyMMdd-HHmm}-{name}-{Guid.NewGuid().ToString("N")[..8]}.md");
        var record = new HandoffRecord(Guid.NewGuid().ToString("N"), p.SourceId, p.TargetId, p.Title, saved, DateTimeOffset.UtcNow, store.Accounts.FirstOrDefault(a => a.Id == p.SourceId)?.Name ?? "已移除账号", store.Accounts.FirstOrDefault(a => a.Id == p.TargetId)?.Name ?? "已移除账号");
        return new PreparedHandoff(p, record, markdown, Clipboard(markdown, saved));
    }

    public HandoffRecord Commit(PreparedHandoff prepared)
    {
        if (Pending?.Id != prepared.Pending.Id)
            throw new IOException("待接力任务已经改变，请重试。");
        var saved = prepared.Record.Path;
        using (var stream = new FileStream(saved, FileMode.CreateNew, FileAccess.Write))
        {
            stream.Write(Encoding.UTF8.GetBytes(prepared.Body));
        }

        try
        {
            var history = History;
            history.Insert(0, prepared.Record);
            store.Write("handoffs/history.json", history);
        }
        catch
        {
            File.Delete(saved);
            throw;
        }

        return prepared.Record;
    }

    public HandoffRecord Transfer(Action<string> copy, string? source = null)
    {
        var prepared = Read(source);
        copy(prepared.Clipboard);
        var record = Commit(prepared);
        Clear();
        return record;
    }

    public (HandoffRecord Record, string Clipboard) Complete(string? source = null)
    {
        var prepared = Read(source);
        return (Commit(prepared), prepared.Clipboard);
    }

    public static string SafeName(string title)
    {
        var clean = System.Text.RegularExpressions.Regex.Replace(title, @"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", "邮箱已隐藏");
        clean = new string(clean.Select(c => Path.GetInvalidFileNameChars().Contains(c) || char.IsControl(c) ? ' ' : c).ToArray()).Trim(' ', '.');
        return clean.Length == 0 ? "对话" : clean[..Math.Min(40, clean.Length)];
    }

    public static string Clipboard(string body, string saved) => $"{Strings.Get("handoff.clipboardPreamble")}\n\n交接文档绝对路径：\n{saved}\n\n以下是文档正文；如无法读取文件，请使用这份正文。\n\n{body}";
    public void Clear()
    {
        var path = Path.Combine(store.Handoffs, "pending.json");
        if (File.Exists(path))
            File.Delete(path);
    }

    public void Forget(string id) => store.Write("handoffs/history.json", History.Where(r => r.Id != id).ToList());
}