using System;

namespace HeyClicky.App.Cody;

internal static class CodyDrawingGeometry
{
    internal static RectD Project(RectD mark, RectD original, RectD current)
    {
        double scaleX = current.Width / original.Width, scaleY = current.Height / original.Height;
        return new RectD(current.X + (mark.X - original.X) * scaleX,
            current.Y + (mark.Y - original.Y) * scaleY, mark.Width * scaleX, mark.Height * scaleY);
    }

    internal static RectD? Intersection(RectD a, RectD b)
    {
        double x = Math.Max(a.X, b.X), y = Math.Max(a.Y, b.Y);
        double right = Math.Min(a.Right, b.Right), bottom = Math.Min(a.Bottom, b.Bottom);
        return right > x && bottom > y ? new RectD(x, y, right - x, bottom - y) : null;
    }

    internal static RectD Union(RectD a, RectD b)
    {
        double x = Math.Min(a.X, b.X), y = Math.Min(a.Y, b.Y);
        return new RectD(x, y, Math.Max(a.Right, b.Right) - x, Math.Max(a.Bottom, b.Bottom) - y);
    }

    internal static bool Visible(RectD mark, RectD viewport, RectD overlay) =>
        Intersection(mark, viewport) is { } clipped &&
        Intersection(clipped, overlay) is { } visible &&
        visible.Width + 2 >= mark.Width && visible.Height + 2 >= mark.Height;
}
