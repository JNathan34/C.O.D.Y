using System.CodeDom.Compiler;
using System.Runtime.CompilerServices;

namespace System.Text.RegularExpressions.Generated;

[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
[SkipLocalsInit]
internal sealed class _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BareUrlPattern_2 : Regex
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
				if (num <= inputSpan.Length - 8)
				{
					ReadOnlySpan<char> span = inputSpan.Slice(num);
					int num2 = span.IndexOf("http");
					if (num2 >= 0)
					{
						int num3 = num2 - 1;
						while ((uint)num3 < (uint)span.Length && char.IsWhiteSpace(span[num3]))
						{
							num3--;
						}
						runtextpos = num + num3 + 1;
						runtrackpos = num + num2;
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
				num = runtrackpos;
				span = inputSpan.Slice(num);
				if (runtextpos < num)
				{
					runtextpos = num;
				}
				if (!span.StartsWith("http"))
				{
					return false;
				}
				if ((uint)span.Length > 4u && span[4] == 's')
				{
					span = span.Slice(1);
					num++;
				}
				if (!span.Slice(4).StartsWith("://"))
				{
					return false;
				}
				num += 7;
				span = inputSpan.Slice(num);
				int i;
				for (i = 0; (uint)i < (uint)span.Length; i++)
				{
					char c;
					if (!(((c = span[i]) < '\u0080') ? (("쇿\uffff\ued7a\uffff\uffff\uffff\uffff\uffff"[(int)c >> 4] & (1 << (c & 0xF))) != 0) : RegexRunner.CharInClass(c, "\u0001\b\u0001\"#'()*,-d")))
					{
						break;
					}
				}
				if (i == 0)
				{
					return false;
				}
				span = span.Slice(i);
				Capture(0, start, runtextpos = num + i);
				return true;
			}
		}

		protected override RegexRunner CreateInstance()
		{
			return new Runner();
		}
	}

	internal static readonly _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BareUrlPattern_2 Instance = new _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BareUrlPattern_2();

	private _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BareUrlPattern_2()
	{
		pattern = "\\s*https?://[^\\s\"'),]+";
		roptions = RegexOptions.None;
		Regex.ValidateMatchTimeout(_003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_defaultTimeout);
		internalMatchTimeout = _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__Utilities.s_defaultTimeout;
		factory = new RunnerFactory();
		capsize = 1;
	}
}
