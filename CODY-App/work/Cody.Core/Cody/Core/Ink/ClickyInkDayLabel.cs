using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text.RegularExpressions.Generated;

namespace HeyClicky.Core.Ink;

public sealed record ClickyInkDayLabel
{
	public string? Weekday { get; private set; }

	public string? Month { get; private set; }

	public string? Day { get; private set; }

	public string? Caption { get; private set; }

	private static readonly string[] MonthNames = new string[12]
	{
		"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct",
		"nov", "dec"
	};

	private static readonly string[] WeekdayNames = new string[7] { "mon", "tue", "wed", "thu", "fri", "sat", "sun" };

	private static readonly string[] DateWords;

	[GeneratedRegex("\\d\\s*-\\s*\\d")]
	[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
	private static Regex DigitRange()
	{
		return _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__DigitRange_44.Instance;
	}

	private static bool AllLetters(string s)
	{
		return s.Characters().All(InkText.IsLetter);
	}

	private static bool AllNumbers(string s)
	{
		return s.Characters().All(InkText.IsNumber);
	}

	public ClickyInkDayLabel(string label)
	{
		List<string> source = (from p in label.Split("·")
			select p.TrimWs() into p
			where p.Length > 0
			select p).ToList();
		List<string> list = source.TakeWhile(IsDatePiece).ToList();
		string text = ((list.Count == 0) ? (source.FirstOrDefault() ?? "") : string.Join(" ", list));
		List<string> list2 = source.Skip(Math.Max(1, list.Count)).ToList();
		Caption = ((list2.Count == 0) ? null : string.Join(" · ", list2));
		if ((from w in text.ToLowerInvariant().SplitCharacters((string c) => !InkText.IsLetter(c))
			where Enumerable.Contains(MonthNames, w.PrefixCharacters(3)) && w.CharacterCount() >= 3
			select w).ToList().Count > 1 || text.Contains('–') || DigitRange().IsMatch(text))
		{
			return;
		}
		string[] array = text.Split(new char[2] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries);
		foreach (string text2 in array)
		{
			string text3 = text2.ToLowerInvariant();
			string text4 = string.Concat(text2.Characters().Where(InkText.IsNumber));
			if (Weekday == null && Enumerable.Contains(WeekdayNames, text3.PrefixCharacters(3)) && text3.CharacterCount() >= 3 && AllLetters(text3))
			{
				Weekday = text2.PrefixCharacters(3).ToUpperInvariant();
			}
			else if (Month == null && Enumerable.Contains(MonthNames, text3.PrefixCharacters(3)) && text3.CharacterCount() >= 3 && AllLetters(text3))
			{
				Month = text2.PrefixCharacters(3).ToUpperInvariant();
			}
			else if (text3 == "day")
			{
				Weekday = "DAY";
			}
			else
			{
				if (Day != null)
				{
					continue;
				}
				long? num2 = InkText.ParseInt(text4);
				if (num2.HasValue)
				{
					long valueOrDefault = num2.GetValueOrDefault();
					if ((text4.CharacterCount() == text2.CharacterCount() || text2.HasSuffix("th") || text2.HasSuffix("st") || text2.HasSuffix("nd") || text2.HasSuffix("rd")) && valueOrDefault >= 1 && valueOrDefault <= 31)
					{
						Day = valueOrDefault.ToString(CultureInfo.InvariantCulture);
					}
				}
			}
		}
		static bool IsDatePiece(string piece)
		{
			List<string> list3 = piece.ToLowerInvariant().SplitCharacters((string c) => !InkText.IsLetter(c) && !InkText.IsNumber(c));
			if (!list3.Any((string w) => Enumerable.Contains(DateWords, w.PrefixCharacters(3)) && AllLetters(w)))
			{
				if (list3.Count <= 2)
				{
					return list3.Any((string w) => AllNumbers(w) && InkText.ParseInt(w).GetValueOrDefault() <= 31);
				}
				return false;
			}
			return true;
		}
	}

	static ClickyInkDayLabel()
	{
		string[] weekdayNames = WeekdayNames;
		string[] monthNames = MonthNames;
		int num = 0;
		string[] array = new string[1 + (weekdayNames.Length + monthNames.Length)];
		ReadOnlySpan<string> readOnlySpan = new ReadOnlySpan<string>(weekdayNames);
		readOnlySpan.CopyTo(new Span<string>(array).Slice(num, readOnlySpan.Length));
		num += readOnlySpan.Length;
		ReadOnlySpan<string> readOnlySpan2 = new ReadOnlySpan<string>(monthNames);
		readOnlySpan2.CopyTo(new Span<string>(array).Slice(num, readOnlySpan2.Length));
		num += readOnlySpan2.Length;
		array[num] = "day";
		DateWords = array;
	}
}
