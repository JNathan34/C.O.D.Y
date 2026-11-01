using System.Text.RegularExpressions;
namespace HeyClicky.App.Cody;
internal static class CodyControlCommands
{
    internal static bool IsStop(string text)=>Regex.IsMatch(text??"",@"^\s*(?:(?:hey\s+)?c[. ]?o[. ]?d[. ]?y[., ]*|please\s+)?(?:stop|cancel|abort)(?:\s+(?:please|that|this|it|now|computer\s+(?:use|control)|(?:the\s+)?(?:current\s+)?task|what\s+you(?:'re|\s+are)\s+doing))?[.!?]*\s*$",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
}
