using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Shapes;

namespace AgentDeskNative.Windows;

internal static class Icons
{
    private static Geometry Gear()
    {
        var ring = new StreamGeometry();
        using (var ctx = ring.Open())
        {
            bool first = true;
            for (int tooth = 0; tooth < 8; tooth++)
                foreach (var (offset, radius) in new[]
                {
                    (-22.5, 7.6),
                    (-14.0, 7.6),
                    (-10.0, 10.0),
                    (10.0, 10.0),
                    (14.0, 7.6)
                }

                )
                {
                    double angle = (tooth * 45 + offset) * Math.PI / 180;
                    var point = new Point(12 + radius * Math.Cos(angle), 12 + radius * Math.Sin(angle));
                    if (first)
                    {
                        ctx.BeginFigure(point, false, true);
                        first = false;
                    }
                    else
                        ctx.LineTo(point, true, false);
                }
        }

        return new GeometryGroup
        {
            Children =
            {
                ring,
                new EllipseGeometry(new Point(12, 12), 3.2, 3.2)
            }
        };
    }

    private static Geometry Paw()
    {
        var shape = new GeometryGroup();
        shape.Children.Add(Geometry.Parse("M12,11 C9,11 8,14 6,16 C3,20 6,23 9,21 C11,20 13,20 15,21 C18,23 21,20 18,16 C16,14 15,11 12,11 Z"));
        foreach (var (x, y, angle) in new[]
        {
            (4.0, 10.0, -25.0),
            (8.5, 5.0, -12.0),
            (15.5, 5.0, 12.0),
            (20.0, 10.0, 25.0)
        }

        )
            shape.Children.Add(new EllipseGeometry(new Point(x, y), 1.7, 2.5) { Transform = new RotateTransform(angle, x, y) });
        return shape;
    }

    public static FrameworkElement Make(string name, bool button = true)
    {
        var data = name switch
        {
            "info" => "M12,2 A10,10 0 1 1 11.99,2 M12,10 L12,17 M12,6 L12,7",
            "refresh" => "M20,9 A8,8 0 1 0 20,16 M20,3 L20,9 14,9",
            "trash" => "M4,6 L20,6 M9,3 L15,3 M6,6 L7,21 17,21 18,6 M10,10 L10,17 M14,10 L14,17",
            "close" => "M6,6 L18,18 M18,6 L6,18",
            "accounts" => "M4,4 L20,4 20,20 4,20 Z M8,8 L16,8 M8,12 L16,12 M8,16 L13,16",
            "quota" => "M12,3 A9,9 0 1 0 21,12 M12,3 L12,12 21,12 M16,3 L16,8 21,8",
            "handoff" => "M4,8 L18,8 M14,4 L18,8 14,12 M20,16 L6,16 M10,12 L6,16 10,20",
            "desktop" => "M4,4 L20,4 20,16 4,16 Z M12,16 L12,21 M8,21 L16,21",
            _ => "M12,4 L12,20 M4,12 L20,12"
        };
        var path = new Path
        {
            Data = name == "settings" ? Gear() : name == "pet" ? Paw() : Geometry.Parse(data),
            StrokeThickness = 1.6,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round,
            Width = 24,
            Height = 24
        };
        if (button)
            path.SetBinding(Shape.StrokeProperty, new Binding("Foreground") { RelativeSource = new RelativeSource(RelativeSourceMode.FindAncestor, typeof(Button), 1) });
        else
            path.SetResourceReference(Shape.StrokeProperty, "TextSecondary");
        return new Viewbox
        {
            Width = 16,
            Height = 16,
            Child = path
        };
    }
}