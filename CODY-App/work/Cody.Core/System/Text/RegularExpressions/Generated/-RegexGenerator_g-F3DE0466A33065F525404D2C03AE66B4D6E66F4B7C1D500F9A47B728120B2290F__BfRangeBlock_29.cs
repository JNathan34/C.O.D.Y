using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BfRangeBlock_29 : Regex
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
					if (_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_hasTimeout)
					{
						CheckTimeout();
					}
				}
			}

			private bool TryFindNextPossibleStartingPosition(ReadOnlySpan<char> inputSpan)
			{
				int num = runtextpos;
				if (num <= inputSpan.Length - 22)
				{
					int num2 = inputSpan.Slice(num).IndexOfAny(_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_indexOfString_beginbfrange_Ordinal);
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
				int num2 = 0;
				int num3 = 0;
				int num4 = 0;
				ReadOnlySpan<char> span = inputSpan.Slice(num);
				if (!span.StartsWith("beginbfrange"))
				{
					UncaptureUntil(0);
					return false;
				}
				num += 12;
				span = inputSpan.Slice(num);
				num2 = num;
				num4 = num;
				while (true)
				{
					num3 = Crawlpos();
					Capture(1, num2, num);
					if (span.StartsWith("endbfrange"))
					{
						break;
					}
					UncaptureUntil(num3);
					if (_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_hasTimeout)
					{
						CheckTimeout();
					}
					num = num4;
					if (inputSpan.Slice(num).IsEmpty)
					{
						UncaptureUntil(0);
						return false;
					}
					num++;
					span = inputSpan.Slice(num);
					num4 = span.IndexOf("endbfrange");
					if (num4 < 0)
					{
						UncaptureUntil(0);
						return false;
					}
					num += num4;
					span = inputSpan.Slice(num);
					num4 = num;
				}
				Capture(0, start, runtextpos = num + 10);
				return true;
				[MethodImpl(MethodImplOptions.AggressiveInlining)]
				void UncaptureUntil(int capturePosition)
				{
					while (Crawlpos() > capturePosition)
					{
						Uncapture();
					}
				}
			}
		}

		protected override RegexRunner CreateInstance()
		{
			return new Runner();
		}
	}

	internal static readonly _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BfRangeBlock_29 Instance = new _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BfRangeBlock_29();

	private _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BfRangeBlock_29()
	{
		pattern = "beginbfrange(.*?)endbfrange";
		roptions = RegexOptions.Singleline;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 2;
	}
}
