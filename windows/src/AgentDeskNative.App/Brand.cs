using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace AgentDeskNative.Windows;
/// Uses the same stacked-layers paths and palette as shared/assets/AppIcon.svg.
public static class Brand
{
    /// `round` fills a circle instead of the app-icon squircle, for the native desktop orb.
    public static DrawingImage Image(bool round = false)
    {
        var visual = new DrawingGroup();
        using (var c = visual.Open())
        {
            var fill = new SolidColorBrush(Color.FromRgb(232, 235, 239));
            if (round)
                c.DrawEllipse(fill, null, new Point(512, 512), 412, 412);
            else
                c.DrawRoundedRectangle(fill, null, new Rect(100, 100, 824, 824), 185, 185);
            var pen = new Pen(new SolidColorBrush(Color.FromRgb(71, 83, 99)), 40)
            {
                LineJoin = PenLineJoin.Round,
                StartLineCap = PenLineCap.Round,
                EndLineCap = PenLineCap.Round
            };
            c.DrawGeometry(new SolidColorBrush(Color.FromRgb(248, 250, 252)), pen, Geometry.Parse("M280 390 L512 260 L744 390 L512 520 Z"));
            c.DrawGeometry(null, pen, Geometry.Parse("M280 510 L512 640 L744 510 M280 630 L512 760 L744 630"));
        }

        var image = new DrawingImage(visual);
        image.Freeze();
        return image;
    }

    public static System.Drawing.Icon TrayIcon()
    {
        var visual = new DrawingVisual();
        using (var c = visual.RenderOpen())
            c.DrawImage(Image(), new Rect(0, 0, 32, 32));
        var bitmap = new RenderTargetBitmap(32, 32, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = new MemoryStream();
        encoder.Save(stream);
        stream.Position = 0;
        using var drawing = new System.Drawing.Bitmap(stream);
        var handle = drawing.GetHicon();
        try
        {
            using var icon = System.Drawing.Icon.FromHandle(handle);
            return (System.Drawing.Icon)icon.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(nint handle);
}