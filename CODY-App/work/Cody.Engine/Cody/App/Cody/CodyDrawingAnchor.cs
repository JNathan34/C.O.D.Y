using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.App.Cody;

// Match the pixels inside a highlight against the browser's current content.
// Screen coordinates in this class are in the original screenshot's pixel grid.
internal sealed class CodyDrawingAnchor
{
    private const int Radius = 9;
    private const int Step = 3;
    private const int Samples = 49;
    private const int MaxError = 15 * Samples;
    private readonly record struct Patch(int X, int Y, byte[] Pixels, int Contrast);
    private readonly Patch[] patches;
    private readonly int width;
    private readonly int height;

    internal CodyDrawingAnchor(byte[] image, int width, int height, double x, double y, double w, double h)
    {
        this.width = width;
        this.height = height;
        var candidates = new List<Patch>();
        // Avoid the outline itself and sample several parts of the highlighted object.
        foreach (double fy in new[] { 0.25, 0.5, 0.75 })
        foreach (double fx in new[] { 0.25, 0.5, 0.75 })
        {
            int px = (int)Math.Round(x + w * fx);
            int py = (int)Math.Round(y + h * fy);
            if (px < Radius || py < Radius || px >= width - Radius || py >= height - Radius) continue;
            if (candidates.Any(p => Math.Abs(p.X - px) < Step && Math.Abs(p.Y - py) < Step)) continue;
            var pixels = new byte[Samples];
            int index = 0;
            for (int dy = -Radius; dy <= Radius; dy += Step)
            for (int dx = -Radius; dx <= Radius; dx += Step)
                pixels[index++] = image[(py + dy) * width + px + dx];
            int contrast = pixels.Max() - pixels.Min();
            double mean = pixels.Average(p => (double)p);
            if (contrast >= 45 && pixels.Average(p => Math.Abs(p - mean)) >= 10)
                candidates.Add(new Patch(px, py, pixels, contrast));
        }
        patches = candidates.OrderByDescending(p => p.Contrast).Take(5).ToArray();
    }

    internal bool HasFeatures => patches.Length > 0;

    internal (int X, int Y)? Locate(byte[] image, int left, int top, int right, int bottom,
        (int X, int Y) previous, (int X, int Y) windowOffset)
    {
        if (!HasFeatures) return null;
        left = Math.Max(Radius, left + Radius);
        top = Math.Max(Radius, top + Radius);
        right = Math.Min(width - Radius, right - Radius);
        bottom = Math.Min(height - Radius, bottom - Radius);
        int best = MaxError + 1;
        int second = MaxError + 1;
        (int X, int Y) match = default;

        int Score(Patch patch, int x, int y)
        {
            int px = patch.X + x, py = patch.Y + y;
            if (px < left || px >= right || py < top || py >= bottom) return MaxError + 1;
            int error = 0, i = 0;
            for (int dy = -Radius; dy <= Radius; dy += Step)
            {
                int start = (py + dy) * width + px - Radius;
                for (int dx = 0; dx <= 2 * Radius; dx += Step)
                    error += Math.Abs(image[start + dx] - patch.Pixels[i++]);
                if (error > MaxError) break;
            }
            return error;
        }

        void Check(int x, int y)
        {
            int sum = 0, good = 0;
            foreach (var patch in patches)
            {
                int score = Score(patch, x, y);
                if (score <= MaxError) { sum += score; good++; }
            }
            // When several regions are distinct, require agreement so a repeated
            // button or product card cannot relocate the drawing on its own.
            if (good < Math.Min(2, patches.Length)) return;
            int error = (sum + (patches.Length - good) * MaxError) / patches.Length;
            bool adjacent = Math.Abs(x - match.X) <= Step && Math.Abs(y - match.Y) <= Step;
            if (error < best)
            {
                if (!adjacent) second = Math.Min(second, best);
                best = error;
                match = (x, y);
            }
            else if (!adjacent) second = Math.Min(second, error);
        }

        // A stationary page or a short scroll can usually be confirmed locally.
        for (int dy = -2; dy <= 2; dy++)
        for (int dx = -2; dx <= 2; dx++) Check(previous.X + dx, previous.Y + dy);
        if (best <= 6 * Samples) return match;

        int minY = top - patches.Max(p => p.Y);
        int maxY = bottom - patches.Min(p => p.Y);
        int minX = left - patches.Max(p => p.X);
        int maxX = right - patches.Min(p => p.X);
        for (int delta = -2; delta <= 2; delta++)
        {
            for (int y = minY; y < maxY; y++)
            {
                Check(previous.X + delta, y);
                if (Math.Abs(windowOffset.X - previous.X) > 2) Check(windowOffset.X + delta, y);
            }
            for (int x = minX; x < maxX; x++)
            {
                Check(x, previous.Y + delta);
                if (Math.Abs(windowOffset.Y - previous.Y) > 2) Check(x, windowOffset.Y + delta);
            }
        }
        return best <= MaxError && second - best >= 2 * Samples ? match : null;
    }
}
