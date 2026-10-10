using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace AgentDeskNative.Windows;

internal static class NativeWindow
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public int Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Margins
    {
        public int Left;
        public int Right;
        public int Top;
        public int Bottom;
    }

    private delegate bool MonitorProc(nint monitor, nint dc, nint rect, nint data);
    // Keep global monitor origins in physical pixels. Never divide an origin by
    // a different monitor's DPI: mixed-DPI monitors do not share a DIP plane.
    public static Bounds Area(Window? window = null)
    {
        nint monitor;
        if (window != null)
            monitor = MonitorFromWindow(new WindowInteropHelper(window).EnsureHandle(), 2);
        else
        {
            GetCursorPos(out var point);
            monitor = MonitorFromPoint(point, 2);
        }

        return Work(monitor);
    }

    public static List<Bounds> Screens()
    {
        var result = new List<Bounds>();
        EnumDisplayMonitors(0, 0, (monitor, dc, rect, data) =>
        {
            result.Add(Work(monitor));
            return true;
        }, 0);
        return result;
    }

    private static Bounds Work(nint monitor)
    {
        var info = new MonitorInfo
        {
            Size = Marshal.SizeOf<MonitorInfo>()
        };
        GetMonitorInfo(monitor, ref info);
        return new Bounds(info.Work.Left, info.Work.Top, info.Work.Right - info.Work.Left, info.Work.Bottom - info.Work.Top);
    }

    public static double Scale(Bounds area)
    {
        var monitor = MonitorFromPoint(new Point { X = (int)(area.X + area.Width / 2), Y = (int)(area.Y + area.Height / 2) }, 2);
        GetDpiForMonitor(monitor, 0, out var x, out _);
        return x > 0 ? x / 96d : 1;
    }

    public static Bounds Rectangle(Window window)
    {
        GetWindowRect(new WindowInteropHelper(window).EnsureHandle(), out var rect);
        return new Bounds(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
    }

    public static void Move(Window window, double x, double y) => SetWindowPos(new WindowInteropHelper(window).EnsureHandle(), 0, (int)Math.Round(x), (int)Math.Round(y), 0, 0, 0x0015);
    public static Bounds PrimaryArea() => Work(MonitorFromPoint(new Point(), 1));
    public static void Apply(Window window, bool dark)
    {
        var handle = new WindowInteropHelper(window).Handle;
        int enabled = dark ? 1 : 0;
        DwmSetWindowAttribute(handle, 20, ref enabled, sizeof(int));
        int rounded = 2;
        DwmSetWindowAttribute(handle, 33, ref rounded, sizeof(int));
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
            return;
        var margins = new Margins
        {
            Left = -1,
            Right = -1,
            Top = -1,
            Bottom = -1
        };
        DwmExtendFrameIntoClientArea(handle, ref margins);
        int backdrop = 3;
        DwmSetWindowAttribute(handle, 38, ref backdrop, sizeof(int));
        if (HwndSource.FromHwnd(handle)?.CompositionTarget is { } target)
            target.BackgroundColor = Colors.Transparent;
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")]
    private static extern nint MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll")]
    private static extern nint MonitorFromWindow(nint window, uint flags);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(nint window, out Rect rect);
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(nint window, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(nint dc, nint clip, MonitorProc callback, nint data);
    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(nint monitor, int type, out uint x, out uint y);
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);
    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(nint window, ref Margins margins);
}