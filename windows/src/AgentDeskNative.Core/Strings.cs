using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace AgentDeskNative.Windows;

public static class Strings
{
    private static readonly Dictionary<string, string> values = Load();
    public static IReadOnlyDictionary<string, string> All => values;

    private static Dictionary<string, string> Load()
    {
        using var stream = typeof(Strings).Assembly.GetManifestResourceStream("AgentDeskNative.Strings.zh-CN.json") ?? throw new IOException("缺少共享文案资源。");
        return JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!;
    }

    public static string Get(string key) => values.TryGetValue(key, out var value) ? value : throw new KeyNotFoundException(key);
}