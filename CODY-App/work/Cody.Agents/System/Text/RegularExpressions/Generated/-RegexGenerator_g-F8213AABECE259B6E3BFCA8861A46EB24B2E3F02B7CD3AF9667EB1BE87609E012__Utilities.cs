using System.Buffers;
using System.CodeDom.Compiler;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
internal static class _003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__Utilities
{
	internal static readonly TimeSpan s_defaultTimeout = ((AppContext.GetData("REGEX_DEFAULT_MATCH_TIMEOUT") is TimeSpan timeSpan) ? timeSpan : Regex.InfiniteMatchTimeout);

	internal static readonly bool s_hasTimeout = s_defaultTimeout != Regex.InfiniteMatchTimeout;

	internal static readonly SearchValues<char> s_ascii_FF0300000000FEFFFF07 = SearchValues.Create("0123456789abcdefghijklmnopqrstuvwxyz");
}
