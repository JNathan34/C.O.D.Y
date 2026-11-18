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
    private const int GridWidth = 2 * Radius / Step + 1;
    private const int Samples = GridWidth * GridWidth;
    private const int MaxError = 15 * Samples;
    private readonly record struct Patch(int X, int Y, byte[] Pixels, int Detail);
    private readonly Patch[] patches;
    private readonly int width;
    private readonly int height;

    internal CodyDrawingAnchor(byte[] image, int width, int height, double x, double y, double w, double h)
    {
        this.width = width;
        this.height = height;
        var candidates = new List<Patch>();
        double insetX = Math.Min(w / 2, Radius + 2);
        double insetY = Math.Min(h / 2, Radius + 2);
        // Avoid the outline itself and sample several parts of the highlighted object.
        foreach (double fy in new[] { 0.15, 0.35, 0.5, 0.65, 0.85 })
        foreach (double fx in new[] { 0.08, 0.22, 0.4, 0.6, 0.78, 0.92 })
        {
            int px = (int)Math.Round(x + insetX + (w - 2 * insetX) * fx);
            int py = (int)Math.Round(y + insetY + (h - 2 * insetY) * fy);
            if (px < Radius || py < Radius || px >= width - Radius || py >= height - Radius) continue;
            if (candidates.Any(p => Math.Abs(p.X - px) < Step * 2 && Math.Abs(p.Y - py) < Step * 2)) continue;
            var pixels = new byte[Samples];
            int index = 0;
            for (int dy = -Radius; dy <= Radius; dy += Step)
            for (int dx = -Radius; dx <= Radius; dx += Step)
                pixels[index++] = image[(py + dy) * width + px + dx];
            int contrast = pixels.Max() - pixels.Min();
            double mean = pixels.Average(p => (double)p);
            int horizontalEdges = 0, verticalEdges = 0;
            for (int i = 0; i < pixels.Length; i++)
            {
                if (i % GridWidth != 0 && Math.Abs(pixels[i] - pixels[i - 1]) >= 18) horizontalEdges++;
                if (i >= GridWidth && Math.Abs(pixels[i] - pixels[i - GridWidth]) >= 18) verticalEdges++;
            }
            // Repeated row borders provide contrast but little evidence of identity.
            int detail = Math.Min(horizontalEdges, verticalEdges);
            if (detail >= 2 && contrast >= 45 && pixels.Average(p => Math.Abs(p - mean)) >= 10)
                candidates.Add(new Patch(px, py, pixels, detail));
        }
        patches = candidates.OrderByDescending(p => p.Detail).Take(7).ToArray();
    }

    internal bool HasFeatures => patches.Length > 0;

    internal (int X, int Y)? Locate(byte[] image, int left, int top, int right, int bottom,
        (int X, int Y) previous, (int X, int Y) windowOffset, (int X, int Y)? nearbyMarks = null)
    {
        if (!HasFeatures) return null;
        left = Math.Max(Radius, left + Radius);
        top = Math.Max(Radius, top + Radius);
        right = Math.Min(width - Radius, right - Radius);
        bottom = Math.Min(height - Radius, bottom - Radius);
        int best = MaxError + 1;
        int second = MaxError + 1;
        (int X, int Y) match = default;

        int Score(Patch patch, int x, int y, int limit)
        {
            int px = patch.X + x, py = patch.Y + y;
            if (px < left || px >= right || py < top || py >= bottom) return limit + 1;
            int error = 0, i = 0;
            for (int dy = -Radius; dy <= Radius; dy += Step)
            {
                int start = (py + dy) * width + px - Radius;
                for (int dx = 0; dx <= 2 * Radius; dx += Step)
                    error += Math.Abs(image[start + dx] - patch.Pixels[i++]);
                if (error > limit) break;
            }
            return error;
        }

        if (nearbyMarks is { } known)
        {
            // Two other marks agreed on the motion. At that exact location,
            // allow small rasterization differences while checking this mark's own content.
            const int limit = 23 * Samples;
            int confirmed = 0;
            foreach (var patch in patches)
            {
                int score = limit + 1;
                for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                    score = Math.Min(score, Score(patch, known.X + dx, known.Y + dy, limit));
                if (score <= limit) confirmed++;
            }
            return confirmed >= Math.Max(2, (patches.Length * 2 + 2) / 3) ? known : null;
        }

        void Check(int x, int y)
        {
            int sum = 0, good = 0;
            foreach (var patch in patches)
            {
                int score = Score(patch, x, y, MaxError);
                if (score <= MaxError) { sum += score; good++; }
            }
            // When several regions are distinct, require agreement so a repeated
            // button or product card cannot relocate the drawing on its own.
            if (good < Math.Min(patches.Length, Math.Max(2, (patches.Length + 1) / 2))) return;
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
        for (int dy = -10; dy <= 10; dy++)
        for (int dx = -10; dx <= 10; dx++)
            if (Math.Abs(dx) > 2 || Math.Abs(dy) > 2) Check(previous.X + dx, previous.Y + dy);

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
