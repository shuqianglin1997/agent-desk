using System;
using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;
using global::Windows.UI.ViewManagement;

namespace AgentDeskNative.Windows;

public sealed class ThemeManager : IDisposable
{
    private readonly UISettings ui = new();
    private readonly string? forced;
    private ResourceDictionary? current;
    public string Name { get; private set; } = "Light";

    public event Action? Changed;
    public ThemeManager(string? theme)
    {
        forced = theme;
        Application.Current.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("/AgentDeskNative;component/Theme/Controls.xaml", UriKind.Relative) });
        foreach (var pair in Strings.All)
            Application.Current.Resources[pair.Key] = pair.Value;
        Apply();
        SystemEvents.UserPreferenceChanged += PreferencesChanged;
        ui.ColorValuesChanged += ColorsChanged;
    }

    public void Apply()
    {
        var light = (int?)Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) != 0;
        Name = forced?.ToLowerInvariant() switch
        {
            "light" => "Light",
            "dark" => "Dark",
            _ => light ? "Light" : "Dark"
        };
        var next = new ResourceDictionary
        {
            Source = new Uri($"/AgentDeskNative;component/Theme/Tokens.{Name}.xaml", UriKind.Relative)
        };
        var color = ui.GetColorValue(UIColorType.Accent);
        // An achromatic system accent makes selected navigation look like
        // ordinary text. Keep the readable Fluent accent from the palette.
        int chroma = Math.Max(color.R, Math.Max(color.G, color.B)) - Math.Min(color.R, Math.Min(color.G, color.B));
        var accent = chroma >= 16 ? Color.FromRgb(color.R, color.G, color.B) : ((SolidColorBrush)next["Accent"]).Color;
        next["Accent"] = new SolidColorBrush(Soften(accent, Name == "Light"));

        if (current != null)
            Application.Current.Resources.MergedDictionaries.Remove(current);
        Application.Current.Resources.MergedDictionaries.Insert(0, next);
        current = next;
        Changed?.Invoke();
    }

    /// Keeps the user's accent hue but caps saturation and fixes lightness, so vivid system
    /// colors sit calmly on the small panel and white or black text on them stays readable.
    public static Color Soften(Color color, bool light)
    {
        double r = color.R / 255d, g = color.G / 255d, b = color.B / 255d;
        double max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), delta = max - min;
        double hue = delta == 0 ? 0 : max == r ? 60 * (((g - b) / delta % 6 + 6) % 6) : max == g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
        double lightness = (max + min) / 2, saturation = delta == 0 ? 0 : delta / (1 - Math.Abs(2 * lightness - 1));
        saturation = Math.Min(saturation, light ? .58 : .62);
        lightness = light ? Math.Clamp(lightness, .36, .44) : Math.Clamp(lightness, .64, .72);
        double c = (1 - Math.Abs(2 * lightness - 1)) * saturation, x = c * (1 - Math.Abs(hue / 60 % 2 - 1)), m = lightness - c / 2;
        var (rr, gg, bb) = hue < 60 ? (c, x, 0d) : hue < 120 ? (x, c, 0d) : hue < 180 ? (0d, c, x) : hue < 240 ? (0d, x, c) : hue < 300 ? (x, 0d, c) : (c, 0d, x);
        return Color.FromRgb((byte)Math.Round((rr + m) * 255), (byte)Math.Round((gg + m) * 255), (byte)Math.Round((bb + m) * 255));
    }

    private void PreferencesChanged(object sender, UserPreferenceChangedEventArgs e) => Application.Current.Dispatcher.BeginInvoke(Apply);
    private void ColorsChanged(UISettings sender, object args) => Application.Current.Dispatcher.BeginInvoke(Apply);
    public void Dispose()
    {
        SystemEvents.UserPreferenceChanged -= PreferencesChanged;
        ui.ColorValuesChanged -= ColorsChanged;
    }
}

public static class Hint
{
    public static readonly DependencyProperty TextProperty = DependencyProperty.RegisterAttached("Text", typeof(string), typeof(Hint), new PropertyMetadata(""));
    public static string GetText(DependencyObject value) => (string)value.GetValue(TextProperty);
    public static void SetText(DependencyObject value, string text) => value.SetValue(TextProperty, text);
}