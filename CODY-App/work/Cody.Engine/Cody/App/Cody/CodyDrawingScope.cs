using System.Text.RegularExpressions;
using System.Threading;

namespace HeyClicky.App.Cody;

// Captured with each drawing, so later requests cannot change an older canvas.
internal static class CodyDrawingScope
{
    private static int globalRequest;
    internal static bool GlobalRequest => Volatile.Read(ref globalRequest) != 0;
    internal static void ForRequest(string text)
    {
        text ??= "";
        bool local = Regex.IsMatch(text, @"\b(?:only (?:on|in|for) (?:this|that|the current) app|bound to (?:this|that) app)\b", RegexOptions.IgnoreCase);
        bool global = Regex.IsMatch(text, @"\b(?:sticky[ -]?note|post[ -]?(?:it|et|at)(?:[ -]?note)?|across (?:all |other )?apps|all (?:my )?apps|every app|any app|all screens|any screen|every screen|all windows)\b", RegexOptions.IgnoreCase);
        Volatile.Write(ref globalRequest, !local && global ? 1 : 0);
    }
}
