using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace AgentDeskNative.Windows;

internal sealed class Hotkey : IDisposable
{
    private readonly HwndSource source;
    private readonly Action toggle;
    public bool Registered
    {
        get;
    }

    public Hotkey(Window window, Action action)
    {
        toggle = action;
        source = HwndSource.FromHwnd(new WindowInteropHelper(window).EnsureHandle())!;
        source.AddHook(Hook);
        Registered = RegisterHotKey(source.Handle, 0x5043, 0x4003, 0x50); // Ctrl+Alt+P, no repeat
    }

    private nint Hook(nint hwnd, int msg, nint w, nint l, ref bool handled)
    {
        if (msg == 0x0312 && w == 0x5043)
        {
            handled = true;
            toggle();
        }

        return 0;
    }

    public void Dispose()
    {
        if (Registered)
            UnregisterHotKey(source.Handle, 0x5043);
        source.RemoveHook(Hook);
    }

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(nint hwnd, int id, uint modifiers, uint key);
    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(nint hwnd, int id);
}