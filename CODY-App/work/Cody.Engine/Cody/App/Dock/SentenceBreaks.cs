using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace HeyClicky.App.Dock;

public static class SentenceBreaks
{
	private enum Kind
	{
		Other,
		CR,
		LF,
		Sep,
		Sp,
		Lower,
		Upper,
		OLetter,
		Numeric,
		ATerm,
		STerm,
		Close,
		SContinue,
		Extend
	}

	public static IEnumerable<string> Sentences(string text)
	{
		List<int> starts = new List<int>();
		List<Kind> kinds = new List<Kind>();
		int num = 0;
		while (num < text.Length)
		{
			Rune runeAt = Rune.GetRuneAt(text, num);
			Kind kind = KindOf(runeAt);
			bool flag = kind == Kind.Extend && kinds.Count > 0;
			if (flag)
			{
				Kind kind2 = kinds[kinds.Count - 1];
				bool flag2 = (uint)(kind2 - 1) <= 2u;
				flag = !flag2;
			}
			if (flag)
			{
				num += runeAt.Utf16SequenceLength;
				continue;
			}
			starts.Add(num);
			kinds.Add((kind != Kind.Extend) ? kind : Kind.Other);
			num += runeAt.Utf16SequenceLength;
		}
		int num2 = 0;
		for (int i = 1; i < kinds.Count; i++)
		{
			if (BreaksBefore(kinds, i))
			{
				int num3 = num2;
				yield return text.Substring(num3, starts[i] - num3);
				num2 = starts[i];
			}
		}
		if (num2 < text.Length)
		{
			int num3 = num2;
			yield return text.Substring(num3, text.Length - num3);
		}
	}

	private static bool BreaksBefore(List<Kind> c, int i)
	{
		Kind kind = c[i - 1];
		Kind kind2 = c[i];
		if (kind == Kind.CR && kind2 == Kind.LF)
		{
			return false;
		}
		if ((uint)(kind - 1) <= 2u)
		{
			return true;
		}
		if (kind == Kind.ATerm && kind2 == Kind.Numeric)
		{
			return false;
		}
		bool flag = kind == Kind.ATerm && kind2 == Kind.Upper && i >= 2;
		if (flag)
		{
			Kind kind3 = c[i - 2];
			bool flag2 = (uint)(kind3 - 5) <= 1u;
			flag = flag2;
		}
		if (flag)
		{
			return false;
		}
		int num = i - 1;
		while (num >= 0 && c[num] == Kind.Sp)
		{
			num--;
		}
		bool flag3 = num < i - 1;
		while (num >= 0 && c[num] == Kind.Close)
		{
			num--;
		}
		flag = num < 0;
		if (!flag)
		{
			Kind kind3 = c[num];
			bool flag2 = (uint)(kind3 - 9) <= 1u;
			flag = !flag2;
		}
		if (flag)
		{
			return false;
		}
		if (c[num] == Kind.ATerm)
		{
			int num2 = i;
			while (true)
			{
				flag = num2 < c.Count;
				if (flag)
				{
					bool flag2;
					switch (c[num2])
					{
					case Kind.CR:
					case Kind.LF:
					case Kind.Sep:
					case Kind.Lower:
					case Kind.Upper:
					case Kind.OLetter:
					case Kind.ATerm:
					case Kind.STerm:
						flag2 = true;
						break;
					default:
						flag2 = false;
						break;
					}
					flag = !flag2;
				}
				if (!flag)
				{
					break;
				}
				num2++;
			}
			if (num2 < c.Count && c[num2] == Kind.Lower)
			{
				return false;
			}
		}
		if (((uint)(kind2 - 9) <= 1u || kind2 == Kind.SContinue) ? true : false)
		{
			return false;
		}
		flag = !flag3;
		if (flag)
		{
			bool flag2 = (((uint)(kind2 - 1) <= 3u || kind2 == Kind.Close) ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			return false;
		}
		if ((uint)(kind2 - 1) <= 3u)
		{
			return false;
		}
		return true;
	}

	private static Kind KindOf(Rune rune)
	{
		switch (rune.Value)
		{
		case 13:
			return Kind.CR;
		case 10:
			return Kind.LF;
		case 133:
		case 8232:
		case 8233:
			return Kind.Sep;
		case 46:
		case 8228:
		case 65106:
		case 65294:
			return Kind.ATerm;
		case 33:
		case 63:
		case 1417:
		case 1567:
		case 1748:
		case 1792:
		case 1793:
		case 1794:
		case 2404:
		case 2405:
		case 8252:
		case 8253:
		case 8263:
		case 8264:
		case 8265:
		case 12290:
		case 65110:
		case 65111:
		case 65281:
		case 65311:
		case 65377:
			return Kind.STerm;
		case 44:
		case 45:
		case 58:
		case 1373:
		case 1548:
		case 1549:
		case 2040:
		case 6146:
		case 6152:
		case 8211:
		case 8212:
		case 12289:
		case 65040:
		case 65041:
		case 65043:
		case 65073:
		case 65074:
		case 65104:
		case 65105:
		case 65109:
		case 65112:
		case 65123:
		case 65292:
		case 65293:
		case 65306:
		case 65380:
			return Kind.SContinue;
		case 34:
		case 39:
		case 171:
		case 187:
			return Kind.Close;
		default:
			if (Rune.IsWhiteSpace(rune))
			{
				return Kind.Sp;
			}
			if (Rune.IsDigit(rune))
			{
				return Kind.Numeric;
			}
			switch (Rune.GetUnicodeCategory(rune))
			{
			case UnicodeCategory.LowercaseLetter:
				return Kind.Lower;
			case UnicodeCategory.UppercaseLetter:
			case UnicodeCategory.TitlecaseLetter:
				return Kind.Upper;
			case UnicodeCategory.ModifierLetter:
			case UnicodeCategory.OtherLetter:
			case UnicodeCategory.LetterNumber:
				return Kind.OLetter;
			case UnicodeCategory.OpenPunctuation:
			case UnicodeCategory.ClosePunctuation:
			case UnicodeCategory.InitialQuotePunctuation:
			case UnicodeCategory.FinalQuotePunctuation:
				return Kind.Close;
			case UnicodeCategory.NonSpacingMark:
			case UnicodeCategory.SpacingCombiningMark:
			case UnicodeCategory.EnclosingMark:
			case UnicodeCategory.Format:
				return Kind.Extend;
			default:
				return Kind.Other;
			}
		}
	}
}
