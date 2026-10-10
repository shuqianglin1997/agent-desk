using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using Microsoft.Win32;
using System.Windows.Threading;

namespace AgentDeskNative.Windows;

public sealed class PetWindow : Window
{
    private readonly Store store;
    private readonly Action click, doubleClick;
    private readonly Border orb;
    private readonly DispatcherTimer single = new()
    {
        Interval = TimeSpan.FromMilliseconds(280)
    };
    private Point anchor;
    private double left, top;
    private bool dragging, pressed;
    public PetWindow(Store state, Action onClick, Action onDoubleClick, bool inspection = false)
    {
        store = state;
        click = onClick;
        doubleClick = onDoubleClick;
        Title = "原生桌宠";
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = inspection;
        ShowActivated = false;
        Topmost = true;
        // One solid brand-colored ball: the icon's own fill is the circle, so no ring or gap shows.
        orb = new Border
        {
            Width = 44,
            Height = 44,
            Child = new Image
            {
                Source = Brand.Image(round: true),
                Width = 44,
                Height = 44
            },
            Effect = new DropShadowEffect
            {
                BlurRadius = 10,
                ShadowDepth = 2,
                Opacity = .28
            }
        };
        Width = 60;
        Height = 60;
        Content = new Grid { Children = { orb } };
        ToolTip = "单击展开 / 收起面板 · 双击调出忙碌账号 · 拖动移动 · 右键菜单";
        var menu = new ContextMenu();
        foreach (var (label, action) in new[]
        {
            ("打开 AgentDesk Native", click),
            ("恢复桌宠位置", (Action)ResetPosition),
            ("隐藏桌宠", (Action)(() =>
            {
                store.Preferences.PetVisible = false;
                store.Save();
                Hide();
            })),
            ("退出 AgentDesk Native", (Action)(() => Application.Current.Shutdown()))
        }

        )
        {
            var item = new MenuItem
            {
                Header = label
            };
            item.Click += (_, _) => action();
            menu.Items.Add(item);
        }

        ContextMenu = menu;
        Left = store.Preferences.PetLeft ?? SystemParameters.WorkArea.Right - 210;
        Top = store.Preferences.PetTop ?? SystemParameters.WorkArea.Bottom - 240;
        MouseLeftButtonDown += (_, e) =>
        {
            if (e.ClickCount == 2)
            {
                single.Stop();
                doubleClick();
                return;
            }

            anchor = PointToScreen(e.GetPosition(this));
            var rect = NativeWindow.Rectangle(this);
            left = rect.X;
            top = rect.Y;
            pressed = true;
            dragging = false;
            CaptureMouse();
        };
        MouseMove += (_, e) =>
        {
            if (!pressed)
                return;
            if (e.LeftButton != MouseButtonState.Pressed)
            {
                FinishDrag();
                ReleaseMouseCapture();
                return;
            }

            var point = PointToScreen(e.GetPosition(this));
            var delta = point - anchor;
            if (Math.Abs(delta.X) + Math.Abs(delta.Y) > 5)
                dragging = true;
            if (dragging)
            {
                single.Stop();
                NativeWindow.Move(this, left + delta.X, top + delta.Y);
            }
        };
        MouseLeftButtonUp += (_, _) =>
        {
            if (!pressed)
                return;
            var moved = dragging;
            FinishDrag();
            ReleaseMouseCapture();
            if (!moved)
            {
                single.Stop();
                single.Start();
            }
        };
        LostMouseCapture += (_, _) => FinishDrag();
        single.Tick += (_, _) =>
        {
            single.Stop();
            click();
        };
        SystemEvents.DisplaySettingsChanged += DisplayChanged;
        Closed += (_, _) =>
        {
            single.Stop();
            SystemEvents.DisplaySettingsChanged -= DisplayChanged;
        };
        Configure();
    }

    private void FinishDrag()
    {
        var moved = dragging;
        pressed = false;
        dragging = false;
        if (!moved)
            return;
        Configure();
        store.Preferences.PetLeft = Left;
        store.Preferences.PetTop = Top;
        store.Save();
    }

    public void Configure()
    {
        var physical = NativeWindow.Rectangle(this);
        double scale = NativeWindow.Scale(NativeWindow.Area(this));
        var placed = PanelPlacement.ClampPet(physical with
        {
            Width = Width * scale,
            Height = Height * scale
        }, NativeWindow.Screens());
        NativeWindow.Move(this, placed.X, placed.Y);
    }

    /// Moves to a physical-pixel origin, keeps it on screen and remembers it like a drag would.
    public void MoveTo(double x, double y)
    {
        NativeWindow.Move(this, x, y);
        Configure();
        store.Preferences.PetLeft = Left;
        store.Preferences.PetTop = Top;
        store.Save();
    }

    public void ResetPosition()
    {
        var primary = NativeWindow.PrimaryArea();
        double scale = NativeWindow.Scale(primary);
        NativeWindow.Move(this, primary.Right - (Width + 28) * scale, primary.Bottom - (Height + 28) * scale);
        Configure();
        store.Preferences.PetLeft = Left;
        store.Preferences.PetTop = Top;
        store.Save();
    }

    private void DisplayChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(Configure);
}