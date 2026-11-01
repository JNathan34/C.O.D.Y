using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__SpotifyId_47 : Regex
{
	private sealed class RunnerFactory : RegexRunnerFactory
	{
		private sealed class Runner : RegexRunner
		{
			protected override void Scan(ReadOnlySpan<char> inputSpan)
			{
				if (TryFindNextPossibleStartingPosition(inputSpan) && !TryMatchAtCurrentPosition(inputSpan))
				{
					runtextpos = inputSpan.Length;
				}
			}

			private bool TryFindNextPossibleStartingPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				if (num <= inputSpan.Length - 22 && num == 0)
				{
					return true;
				}
				runtextpos = inputSpan.Length;
				return false;
			}

			private bool TryMatchAtCurrentPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				int start = num;
				ReadOnlySpan<char> readOnlySpan = inputSpan.Slice(num);
				if (num != 0)
				{
					return false;
				}
				if ((uint)readOnlySpan.Length < 22u)
				{
					return false;
				}
				if (readOnlySpan.Slice(0, 22).IndexOfAnyExcept(_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_asciiLettersAndDigits) >= 0)
				{
					return false;
				}
				if (23 < readOnlySpan.Length || (22 < readOnlySpan.Length && readOnlySpan[22] != '\n'))
				{
					return false;
				}
				Capture(0, start, runtextpos = num + 22);
				return true;
			}
		}

		protected override RegexRunner CreateInstance()
		{
			return new Runner();
		}
	}

	internal static readonly _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__SpotifyId_47 Instance = new _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__SpotifyId_47();

	private _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__SpotifyId_47()
	{
		pattern = "^[A-Za-z0-9]{22}$";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 1;
	}
}
