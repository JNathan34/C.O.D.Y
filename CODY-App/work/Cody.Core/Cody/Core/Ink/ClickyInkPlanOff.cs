using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text.RegularExpressions.Generated;

namespace HeyClicky.Core.Ink;

public static class ClickyInkPlanOff
{
	[GeneratedRegex("\\s*\\{now\\}")]
	[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
	private static Regex NowMarkRegex()
	{
		return _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__NowMarkRegex_45.Instance;
	}

	[GeneratedRegex("\\{[^}]*big=")]
	[GeneratedCode("System.Text.RegularExpressions.Generator", "9.0.15.404")]
	private static Regex BigRegex()
	{
		return _003CRegexGenerator_g_003EF3DE0466A33065F525404D2C03AE66B4D6E66F4B7C1D500F9A47B728120B2290F__BigRegex_46.Instance;
	}

	public static string TakePlanOff(string text)
	{
		int num = 0;
		bool flag = false;
		bool flag2 = false;
		List<string> list = new List<string>();
		string[] array = text.Split('\n');
		foreach (string text2 in array)
		{
			string text3 = text2.TrimWs();
			if (text2.HasPrefix("## "))
			{
				num += ((!((num == 0) & flag)) ? 1 : 2);
			}
			else if (num == 0 && text3.Length > 0 && !text3.HasPrefix("# "))
			{
				flag = true;
			}
			if (text3.HasPrefix(":::") && text3.Length > 3)
			{
				string text4 = text3;
				if (!text4.Substring(3, text4.Length - 3).HasSuffix(":::") && char.IsLetter(text3, 3))
				{
					flag2 = true;
					goto IL_00c2;
				}
			}
			if (text3 == ":::")
			{
				flag2 = false;
			}
			goto IL_00c2;
			IL_00c2:
			if (flag2 || num > 1 || !IsPlanBox(text3) || text3.Contains("{needs}", StringComparison.Ordinal))
			{
				list.Add(NowMarkRegex().Replace(text2, ""));
			}
		}
		string text5 = string.Join("\n", list);
		while (text5.Contains("\n\n\n", StringComparison.Ordinal))
		{
			text5 = text5.Replace("\n\n\n", "\n\n");
		}
		return text5;
	}

	public static bool HasAnswer(string text)
	{
		return text.Split('\n').Any((string line) =>
		{
			if (!line.HasPrefix("> "))
			{
				return false;
			}
			string text2 = line.Substring(2, line.Length - 2).TrimWs();
			if (BigRegex().IsMatch(line))
			{
				return true;
			}
			return text2.Length > 0 && !text2.HasPrefix("Checking") && !text2.HasPrefix("Looking") && !text2.HasPrefix("Finding");
		});
	}

	private static bool IsPlanBox(string trimmedLine)
	{
		if (!trimmedLine.HasPrefix("- [ ]") && !trimmedLine.HasPrefix("- [x]"))
		{
			return trimmedLine.HasPrefix("- [X]");
		}
		return true;
	}
}
