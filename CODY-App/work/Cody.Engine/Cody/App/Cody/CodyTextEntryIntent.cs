using System.Linq;
using System.Text.RegularExpressions;

namespace HeyClicky.App.Cody;

internal static class CodyTextEntryIntent
{
    internal static bool Paste(string? request) => Directive(request, @"paste|(?:press|use|hit)\s+(?:ctrl|control)\s*(?:\+|\s)\s*v");
    internal static bool Replace(string? request) => Directive(request, @"replace|overwrite|clear\s+(?:the\s+)?(?:field|box|text|selection)");
    internal static bool Copy(string? request) => Directive(request, @"copy|cut|put\s+(?:it|this|that)\s+on\s+(?:the\s+)?clipboard");

    private static bool Directive(string? request, string verbs)
    {
        if (string.IsNullOrWhiteSpace(request)) return false;
        return Regex.IsMatch(request, @"^\s*(?:(?:hey\s+)?(?:cody|c\.o\.d\.y\.)[ ,:]+)?(?:(?:please|can you|could you|would you)\s+)*(?:" + verbs + @")\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    internal static bool PasteChord(System.Collections.Generic.IEnumerable<string> keys)
    {
        var parts = ChordParts(keys);
        return parts.Contains("v") && parts.Any(key => key is "ctrl" or "control" or "cmd" or "command" or "meta" or "super")
            || parts.Contains("insert") && parts.Contains("shift");
    }

    internal static bool CopyChord(System.Collections.Generic.IEnumerable<string> keys)
    {
        var parts=ChordParts(keys);
        return parts.Any(key=>key is "c" or "x" or "insert")&&parts.Any(key=>key is "ctrl" or "control")
            || parts.Contains("shift")&&parts.Contains("delete");
    }

    private static string[] ChordParts(System.Collections.Generic.IEnumerable<string> keys) =>
        keys.SelectMany(key=>key.Split('+')).Select(key=>key.Trim().ToLowerInvariant()).ToArray();
}
