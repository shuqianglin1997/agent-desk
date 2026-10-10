using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace AgentDeskNative.Windows;

public static class Processes
{
    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString
    {
        public ushort Length;
        public ushort MaximumLength;
        public nint Buffer;
    }

    public static List<Running> Scan()
    {
        var results = new List<Running>();
        foreach (var name in new[]
        {
            "ChatGPT",
            "Claude"
        }

        )
        {
            foreach (var process in Process.GetProcessesByName(name))
            {
                using (process)
                {
                    try
                    {
                        var executable = process.MainModule?.FileName;
                        var command = CommandLine(process.Id);
                        if (!string.IsNullOrEmpty(executable) && command != null)
                            results.Add(new Running(process.Id, executable, command, process.MainWindowHandle.ToInt64()));
                    }
                    catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or NotSupportedException)
                    {
                    }
                }
            }
        }

        return results;
    }

    private static string? CommandLine(int pid)
    {
        var handle = OpenProcess(0x1000, false, pid);
        if (handle == 0)
            return null;
        try
        {
            NtQueryInformationProcess(handle, 60, 0, 0, out var length);
            if (length < Marshal.SizeOf<UnicodeString>() || length > 131072)
                return null;
            var buffer = Marshal.AllocHGlobal(length);
            try
            {
                if (NtQueryInformationProcess(handle, 60, buffer, length, out _) != 0)
                    return null;
                var value = Marshal.PtrToStructure<UnicodeString>(buffer);
                long start = buffer.ToInt64(), end = start + length, text = value.Buffer.ToInt64();
                if (value.Length % 2 != 0 || text < start || text + value.Length > end)
                    return null;
                return Marshal.PtrToStringUni(value.Buffer, value.Length / 2);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    [DllImport("kernel32.dll")]
    private static extern nint OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(nint handle);
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(nint process, int information, nint buffer, int size, out int returned);
}