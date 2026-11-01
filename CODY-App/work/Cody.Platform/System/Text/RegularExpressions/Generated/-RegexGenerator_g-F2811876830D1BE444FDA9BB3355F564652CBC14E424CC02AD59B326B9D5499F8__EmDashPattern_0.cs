using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__EmDashPattern_0 : Regex
{
	private sealed class RunnerFactory : RegexRunnerFactory
	{
		private sealed class Runner : RegexRunner
		{
			protected override void Scan(ReadOnlySpan<char> inputSpan)
			{
				while (TryFindNextPossibleStartingPosition(inputSpan) && !TryMatchAtCurrentPosition(inputSpan) && runtextpos != inputSpan.Length)
				{
					runtextpos++;
					if (_003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__Utilities.s_hasTimeout)
					{
						CheckTimeout();
					}
				}
			}

			private bool TryFindNextPossibleStartingPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				if ((uint)num < (uint)inputSpan.Length)
				{
					int num2 = inputSpan.Slice(num).IndexOfAny('\t', ' ', '—');
					if (num2 >= 0)
					{
						runtextpos = num + num2;
						return true;
					}
				}
				runtextpos = inputSpan.Length;
				return false;
			}

			private bool TryMatchAtCurrentPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				int start = num;
				ReadOnlySpan<char> span = inputSpan.Slice(num);
				int num2 = span.IndexOfAnyExcept('\t', ' ');
				if (num2 < 0)
				{
					num2 = span.Length;
				}
				span = span.Slice(num2);
				num += num2;
				if (runtextpos < num)
				{
					runtextpos = num;
				}
				if (span.IsEmpty || span[0] != '—')
				{
					return false;
				}
				int num3 = span.Slice(1).IndexOfAnyExcept('\t', ' ');
				if (num3 < 0)
				{
					num3 = span.Length - 1;
				}
				span = span.Slice(num3);
				num += num3;
				Capture(0, start, runtextpos = num + 1);
				return true;
			}
		}

		protected override RegexRunner CreateInstance()
		{
			return new Runner();
		}
	}

	internal static readonly _003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__EmDashPattern_0 Instance = new _003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__EmDashPattern_0();

	private _003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__EmDashPattern_0()
	{
		pattern = "[ \\t]*—[ \\t]*";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF2811876830D1BE444FDA9BB3355F564652CBC14E424CC02AD59B326B9D5499F8__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 1;
	}
}
