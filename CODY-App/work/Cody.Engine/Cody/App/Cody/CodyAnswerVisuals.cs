using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using HeyClicky.Drawing;

namespace HeyClicky.App.Cody;

internal static class CodyAnswerVisuals
{
    internal static Dictionary<ScreenDrawingCanvas, string> Before(AppHost host) =>
        host.Real.DrawingCanvases.ToDictionary(canvas => canvas, canvas => canvas.Timeline());

    internal static string[] Save(AppHost host, Dictionary<ScreenDrawingCanvas, string> before)
    {
        string directory = null;
        try
        {
            var changed = host.Real.DrawingCanvases.Where(canvas =>
                CodyDrawingControls.HasVisibleDrawing(canvas) &&
                (!before.TryGetValue(canvas, out string timeline) || timeline != canvas.Timeline())).ToArray();
            if (changed.Length == 0) return Array.Empty<string>();
            directory = Path.Combine(CodyPaths.StateRoot, "answer-visuals", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var files = new List<string>();
            long total = 0;
            foreach (var canvas in changed)
            {
                // Export the answer's artwork, including its photos, without desktop pixels or action buttons.
                byte[] png = canvas.RenderDrawingPng(overScreenshot: false, includeButtons: false);
                if (png == null || png.Length == 0) throw new InvalidOperationException("Drawing export returned no image.");
                total += png.Length;
                if (total > 32 * 1024 * 1024) throw new InvalidOperationException("The answer's drawings exceed the export size limit.");
                string file = Path.Combine(directory, $"drawing-{files.Count + 1}.png");
                File.WriteAllBytes(file, png);
                files.Add(file);
            }
            return files.ToArray();
        }
        catch (Exception error)
        {
            Log.Warn("cody-answer-visuals", "Could not preserve answer drawings: " + error.Message);
            if (directory != null)
            {
                try { Directory.Delete(directory, recursive: true); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            return null;
        }
    }
}
