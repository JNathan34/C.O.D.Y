using System.Buffers;
using System.CodeDom.Compiler;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
internal static class _003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__Utilities
{
	internal static readonly TimeSpan s_defaultTimeout = ((AppContext.GetData("REGEX_DEFAULT_MATCH_TIMEOUT") is TimeSpan timeSpan) ? timeSpan : Regex.InfiniteMatchTimeout);

	internal static readonly bool s_hasTimeout = s_defaultTimeout != Regex.InfiniteMatchTimeout;

	internal static readonly SearchValues<string> s_indexOfString_216CC4263C7DA6B2A60D4BCBE1F21E6D43372DC59E18D4D1A32EBDA2E2D2E2D0 = SearchValues.Create(new ReadOnlySpan<string>(", "), StringComparison.Ordinal);
}
