using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;
using System.Windows.Media;
using Forms = System.Windows.Forms;

namespace AgentDeskNative.Windows;

public sealed class Tray : IDisposable
{
    private readonly Forms.NotifyIcon icon;
    private readonly System.Drawing.Icon drawing;
    private readonly Panel panel;
    private ContextMenu? menu;
    public Tray(Panel window)
    {
        panel = window;
        drawing = Brand.TrayIcon();
        icon = new Forms.NotifyIcon
        {
            Icon = drawing,
            Text = "AgentDesk Native · Codex / Claude",
            Visible = true
        };
        icon.MouseClick += (_, e) =>
        {
            if (e.Button == Forms.MouseButtons.Left)
                panel.TrayToggle();
            else if (e.Button == Forms.MouseButtons.Right)
                ShowMenu();
        };
        panel.BackgroundError += Error;
    }

    private void Error(string value) => icon.ShowBalloonTip(4000, "AgentDesk Native", value, Forms.ToolTipIcon.Warning);
    public void ShowMenu()
    {
        menu?.SetCurrentValue(ContextMenu.IsOpenProperty, false);
        menu = new ContextMenu
        {
            Placement = PlacementMode.MousePoint
        };
        void Add(string label, Action action)
        {
            var item = new MenuItem
            {
                Header = label
            };
            item.Click += (_, _) => action();
            menu.Items.Add(item);
        }

        Add("打开面板", panel.OpenPanel);
        if (panel.Model.PetEnabled)
        {
            Add(panel.Model.PetVisible ? "隐藏桌宠" : "显示桌宠", panel.TogglePet);
            Add("恢复桌宠位置", panel.ResetPet);
        }

        menu.Items.Add(new Separator());
        Add("退出 AgentDesk Native", () => Application.Current.Shutdown());
        // A popup opened while another app is in front never sees the outside click or Esc.
        // Bring an invisible AgentDesk Native window forward first so the menu dismisses like a native one.
        var owner = Host();
        owner.Show();
        owner.Activate();
        SetForegroundWindow(new WindowInteropHelper(owner).Handle);
        menu.Closed += (_, _) => owner.Hide();
        menu.IsOpen = true;
    }

    private Window? host;
    private Window Host() => host ??= new Window
    {
        WindowStyle = WindowStyle.None,
        AllowsTransparency = true,
        Background = Brushes.Transparent,
        ShowInTaskbar = false,
        Topmost = true,
        Width = 1,
        Height = 1,
        Left = -32000,
        Top = -32000
    };

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint window);

    public void Dispose()
    {
        panel.BackgroundError -= Error;
        menu?.SetCurrentValue(ContextMenu.IsOpenProperty, false);
        host?.Close();
        icon.Visible = false;
        icon.Dispose();
        drawing.Dispose();
    }
    public void Capture(string directory)
    {
        ShowMenu();
        menu!.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        menu.Arrange(new Rect(menu.DesiredSize));
        Panel.SaveImage(menu, Path.Combine(directory, "tray-menu.png"), 96);
    }
}
