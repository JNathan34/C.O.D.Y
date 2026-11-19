using System;

namespace HeyClicky.App.Cody;

internal static class CodyDrawingGeometry
{
    // A product photograph often includes white padding outside the object the
    // user circled. Its retained image still supplies the correct translation.
    // Reject large page/background images and neighbouring pictures.
    internal static bool FitsImage(RectD mark, RectD image) =>
        image.Contains(new PointD(mark.X + mark.Width / 2, mark.Y + mark.Height / 2)) &&
        image.Width <= mark.Width * 4 && image.Height <= mark.Height * 4 &&
        image.Width * image.Height <= mark.Width * mark.Height * 6 &&
        Intersection(mark, image) is { } overlap &&
        overlap.Width * overlap.Height >= mark.Width * mark.Height * .6;

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
