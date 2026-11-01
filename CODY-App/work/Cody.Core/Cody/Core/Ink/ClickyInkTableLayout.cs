using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Ink;

public sealed record ClickyInkTableLayout(IReadOnlyList<double> Widths, IReadOnlyList<bool> Rigid, double FontScale)
{
	public delegate double Measurer(string text, ClickyInkTableFont font, double scale);

	private static readonly Dictionary<string, ClickyInkTableLayout> Made = new Dictionary<string, ClickyInkTableLayout>();

	public static bool IsShortValue(string cell)
	{
		string text = ClickyInkParser.Emphasis.Strip(cell).TrimWs();
		int num = text.CharacterCount();
		if (num > 10)
		{
			if (num <= 16)
			{
				return ClickyInkNumber.Parse(text).HasValue;
			}
			return false;
		}
		return true;
	}

	public static ClickyInkTableLayout Make(IReadOnlyList<string> columns, IReadOnlyList<IReadOnlyList<string>> rows, double width, Measurer measure)
	{
		string key = string.Join('\u001f', columns) + "\u001e" + string.Join('\u001e', rows.Select((IReadOnlyList<string> r) => string.Join('\u001f', r))) + "\u001d" + InkText.DoubleDescription(width);
		lock (Made)
		{
			if (Made.TryGetValue(key, out ClickyInkTableLayout value))
			{
				return value;
			}
		}
		ClickyInkTableLayout clickyInkTableLayout = Measured(columns, rows, width, measure);
		lock (Made)
		{
			if (Made.Count > 64)
			{
				Made.Clear();
			}
			Made[key] = clickyInkTableLayout;
			return clickyInkTableLayout;
		}
	}

	public bool Equals(ClickyInkTableLayout? other)
	{
		if ((object)other != null && Widths.SequenceEqual(other.Widths) && Rigid.SequenceEqual(other.Rigid))
		{
			return FontScale == other.FontScale;
		}
		return false;
	}

	public override int GetHashCode()
	{
		return HashCode.Combine(Widths.Count, FontScale);
	}

	private static ClickyInkTableLayout Measured(IReadOnlyList<string> columns, IReadOnlyList<IReadOnlyList<string>> rows, double width, Measurer measureFont)
	{
		int num = Math.Max(Math.Max(columns.Count, (rows.Count == 0) ? 1 : rows.Max((IReadOnlyList<string> r) => r.Count)), 1);
		List<bool> rigid = Enumerable.Range(0, num).Select((int num7) =>
		{
			if (num7 <= 0)
			{
				return false;
			}
			List<string> list5 = rows.Select((IReadOnlyList<string> r) => (num7 >= r.Count) ? "" : r[num7]).ToList();
			return list5.Count > 0 && list5.All(IsShortValue);
		}).ToList();
		ClickyInkTableLayout clickyInkTableLayout = null;
		double[] array = new double[6] { 1.0, 0.94, 0.88, 0.82, 0.76, 0.7 };
		foreach (double scale in array)
		{
			List<double> list = new List<double>();
			List<double> minimum = new List<double>();
			for (int column = 0; column < num; column++)
			{
				ClickyInkTableFont font = ((column == 0) ? ClickyInkTableFont.Name : ClickyInkTableFont.Cell);
				List<string> list2 = rows.Select((IReadOnlyList<string> r) => (column >= r.Count) ? "" : r[column]).ToList();
				string obj = ((column < columns.Count) ? columns[column].ToUpperInvariant() : "");
				double val = ((list2.Count == 0) ? 0.0 : list2.Max((string c) => Measure(c, font, scale)));
				string[] array2 = obj.Split(' ', StringSplitOptions.RemoveEmptyEntries);
				double val2 = ((array2.Length == 0) ? 0.0 : array2.Max((string w) => Measure(w, ClickyInkTableFont.Header, scale, 0.4)));
				List<string> list3 = list2.SelectMany((string c) => c.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToList();
				double val3 = ((list3.Count == 0) ? 0.0 : list3.Max((string w) => Measure(w, font, scale)));
				if (rigid[column])
				{
					list.Add(Math.Max(val, val2) + 10.0);
					minimum.Add(list[column]);
				}
				else
				{
					list.Add(Math.Max(Math.Max(Math.Min(val, 200.0 * scale), val2), 40.0) + 10.0);
					minimum.Add(Math.Max(val3, val2) + 10.0);
				}
			}
			double rigidTotal = list.Where((double _, int i) => rigid[i]).Sum();
			double num3 = minimum.Where((double _, int i) => !rigid[i]).Sum();
			if (!(rigidTotal + num3 <= width))
			{
				double total = minimum.Sum();
				clickyInkTableLayout = new ClickyInkTableLayout(minimum.Select((double m) => m / Math.Max(total, 1.0) * width).ToList(), rigid, scale);
				continue;
			}
			double available = width - rigidTotal;
			double flexibleNatural = list.Where((double _, int i) => !rigid[i]).Sum();
			if (!(flexibleNatural > 0.0))
			{
				return new ClickyInkTableLayout(list.Select((double n) => n / rigidTotal * width).ToList(), rigid, scale);
			}
			if (rigidTotal + flexibleNatural <= width)
			{
				return new ClickyInkTableLayout(list.Select((double n) => n / (rigidTotal + flexibleNatural) * width).ToList(), rigid, scale);
			}
			List<double> widths = list.Select((double columnWidth, int index) => (!rigid[index]) ? (columnWidth / flexibleNatural * available) : columnWidth).ToList();
			for (int num4 = 0; num4 < 4; num4++)
			{
				List<int> shortColumns = (from i in Enumerable.Range(0, widths.Count)
					where !rigid[i] && widths[i] < minimum[i] - 0.5
					select i).ToList();
				if (shortColumns.Count == 0)
				{
					break;
				}
				double num5 = shortColumns.Sum((int i) => minimum[i] - widths[i]);
				foreach (int item in shortColumns)
				{
					widths[item] = minimum[item];
				}
				List<int> list4 = (from i in Enumerable.Range(0, widths.Count)
					where !rigid[i] && !shortColumns.Contains(i)
					select i).ToList();
				double num6 = list4.Sum((int i) => widths[i] - minimum[i]);
				if (!(num6 > 0.0))
				{
					break;
				}
				Dictionary<int, double> dictionary = list4.ToDictionary((int i) => i, (int i) => widths[i]);
				foreach (int item2 in list4)
				{
					widths[item2] -= num5 * (dictionary[item2] - minimum[item2]) / num6;
				}
			}
			return new ClickyInkTableLayout(widths, rigid, scale);
		}
		return clickyInkTableLayout ?? new ClickyInkTableLayout(Enumerable.Repeat(width / (double)num, num).ToList(), rigid, 0.7);
		double Measure(string text, ClickyInkTableFont font2, double scale2, double tracking = 0.0)
		{
			string text2 = ClickyInkParser.Emphasis.Strip(text);
			return Math.Ceiling(measureFont(text2, font2, scale2) + tracking * (double)text2.CharacterCount());
		}
	}
}
