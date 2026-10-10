using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace AgentDeskNative.Windows;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        bool demo = args.Contains("--demo");
        string? Option(string key)
        {
            int i = Array.IndexOf(args, key);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        using var show = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\com.agentdesk.native.windows.show");
        using var mutex = new Mutex(!demo, demo ? "Local\\com.agentdesk.native.demo." + Guid.NewGuid() : "Local\\com.agentdesk.native.windows", out var first);
        if (!demo && !first)
        {
            show.Set();
            return;
        }

        var app = new Application
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown
        };
        string? temp = demo ? Path.Combine(Path.GetTempPath(), "agentdesk-native-demo-" + Guid.NewGuid().ToString("N")) : null;
        try
        {
            var store = new Store(temp);
            using var theme = new ThemeManager(Option("--theme"));
            var panel = new Panel(store, theme, demo, args.Contains("--keep-open") || Option("--screenshot") != null, args.Contains("--inspect"));
            panel.Model.Page = Option("--page") ?? "accounts";
            using var tray = demo && !args.Contains("--tray-menu") ? null : new Tray(panel);
            var wait = demo ? null : ThreadPool.RegisterWaitForSingleObject(show, (_, _) => app.Dispatcher.BeginInvoke(panel.OpenPanel), null, -1, false);
            app.Exit += (_, _) =>
            {
                wait?.Unregister(null);
                panel.Dispose();
            };
            if (args.Contains("--show") || demo || store.Accounts.Count == 0)
                panel.OpenPanel();
            if (args.Contains("--tray-menu"))
                panel.Dispatcher.BeginInvoke(() => tray?.ShowMenu());
            if (Option("--screenshot") is string directory)
            {
                var timer = new DispatcherTimer
                {
                    Interval = TimeSpan.FromMilliseconds(800)
                };
                timer.Tick += (_, _) =>
                {
                    timer.Stop();
                    if (double.TryParse(Option("--scroll"), out double offset))
                        panel.DemoScroll(offset);
                    panel.Capture(directory, int.TryParse(Option("--dpi"), out int dpi) ? dpi : 96);
                    if (args.Contains("--tray-menu"))
                        tray?.Capture(directory);
                    app.Shutdown();
                };
                timer.Start();
            }

            app.Run();
        }
        catch (Exception e)
        {
            if (Option("--screenshot") is string dir)
            {
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "error.txt"), e.ToString());
                Environment.ExitCode = 1;
            }
            else
                MessageBox.Show(e is IOException ? e.Message : "AgentDesk Native 无法启动，请检查本机数据目录。原始文件已保留。", "AgentDesk Native", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            if (temp != null && Directory.Exists(temp))
                Directory.Delete(temp, true);
        }
    }
}
