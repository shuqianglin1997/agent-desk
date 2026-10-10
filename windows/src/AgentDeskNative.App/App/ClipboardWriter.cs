using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;

namespace AgentDeskNative.Windows;

public static class ClipboardWriter
{
    public static void Set(string text)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                Clipboard.SetText(text);
                return;
            }
            catch (COMException) when (attempt < 2)
            {
                Thread.Sleep(60);
            }
            catch (COMException e)
            {
                throw new IOException("剪贴板暂时被占用，请稍后再试。接力待办已保留。", e);
            }
        }
    }
}