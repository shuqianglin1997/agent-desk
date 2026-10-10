using System;
using System.Collections.Generic;
using System.Linq;

namespace AgentDeskNative.Windows;

public static class Ordering
{
    public static void MoveBefore<T>(List<T> order, T source, T target)
    {
        if (!order.Contains(source) || !order.Contains(target) || EqualityComparer<T>.Default.Equals(source, target))
            return;
        order.Remove(source);
        order.Insert(order.IndexOf(target), source);
    }

    public static void Move(List<string> order, string source, string target)
    {
        int from = order.IndexOf(source), to = order.IndexOf(target);
        if (from < 0 || to < 0 || from == to)
            return;
        order.RemoveAt(from);
        order.Insert(to, source);
    }

    public static List<Session> Apply(List<Session> sessions, List<string>? order) => order == null ? sessions : sessions.OrderBy(s =>
    {
        var i = order.IndexOf(s.Id);
        return i < 0 ? int.MaxValue : i;
    }).ToList();
}

public static class MediaPolicy
{
    public static string Classify(string source, string? type)
    {
        if (type == "Video")
            return "video";
        // Browsers often advertise every Media Session as Music, including video.
        var id = source.ToLowerInvariant();
        if (new[]
        {
            "chrome",
            "msedge",
            "firefox",
            "brave",
            "opera",
            "vivaldi",
            "arc",
            "browser"
        }.Any(id.Contains))
            return "unknown";
        return type == "Music" ? "music" : "unknown";
    }
}