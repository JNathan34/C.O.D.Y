using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__NonSlug_0 : Regex
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
					if (_003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__Utilities.s_hasTimeout)
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
					int num2 = inputSpan.Slice(num).IndexOfAnyExcept(_003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__Utilities.s_ascii_FF0300000000FEFFFF07);
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
				int num2 = span.IndexOfAny(_003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__Utilities.s_ascii_FF0300000000FEFFFF07);
				if (num2 < 0)
				{
					num2 = span.Length;
				}
				if (num2 == 0)
				{
					return false;
				}
				span = span.Slice(num2);
				Capture(0, start, runtextpos = num + num2);
				return true;
			}
		}

		protected override RegexRunner CreateInstance()
		{
			return new Runner();
		}
	}

	internal static readonly _003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__NonSlug_0 Instance = new _003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__NonSlug_0();

	private _003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__NonSlug_0()
	{
		pattern = "[^a-z0-9]+";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF8213AABECE259B6E3BFCA8861A46EB24B2E3F02B7CD3AF9667EB1BE87609E012__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 1;
	}
}
