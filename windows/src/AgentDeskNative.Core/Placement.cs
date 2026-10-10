using System;
using System.Collections.Generic;
using System.Linq;

namespace AgentDeskNative.Windows;

public readonly record struct Bounds(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;
    public double Bottom => Y + Height;
}

public static class PanelPlacement
{
    public static Bounds Compute(Bounds workArea, Bounds? pet, double width, double height, double gap = 12)
    {
        double x = workArea.Right - width - gap;
        double y = workArea.Bottom - height - gap;
        if (pet is Bounds p)
        {
            x = p.X - width - gap;
            if (x < workArea.X)
                x = p.Right + gap;
            y = p.Bottom - height;
        }

        return Clamp(new Bounds(x, y, width, height), workArea);
    }

    public static bool Overlaps(Bounds a, Bounds b) => a.X < b.Right && b.X < a.Right && a.Y < b.Bottom && b.Y < a.Bottom;

    public static Bounds Clamp(Bounds rect, Bounds area) => rect with
    {
        X = Math.Clamp(rect.X, area.X, Math.Max(area.X, area.Right - rect.Width)),
        Y = Math.Clamp(rect.Y, area.Y, Math.Max(area.Y, area.Bottom - rect.Height))
    };
    public static Bounds ClampPet(Bounds pet, IReadOnlyList<Bounds> screens)
    {
        if (screens.Count == 0)
            return pet;
        var area = screens.OrderByDescending(s => Math.Max(0, Math.Min(s.Right, pet.Right) - Math.Max(s.X, pet.X)) * Math.Max(0, Math.Min(s.Bottom, pet.Bottom) - Math.Max(s.Y, pet.Y))).ThenBy(s => Math.Pow(Math.Clamp(pet.X, s.X, s.Right) - pet.X, 2) + Math.Pow(Math.Clamp(pet.Y, s.Y, s.Bottom) - pet.Y, 2)).First();
        return Clamp(pet, area);
    }
}

public static class SessionRouting
{
    public static bool CanDeepLink(string app, string id, int mainCodexProcesses) => app == "codex" && Guid.TryParse(id, out _) && mainCodexProcesses <= 1;
}