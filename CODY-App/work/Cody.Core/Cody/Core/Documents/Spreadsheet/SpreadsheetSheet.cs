using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;

namespace HeyClicky.Core.Documents.Spreadsheet;

public sealed class SpreadsheetSheet
{
	public string Name { get; }

	public IReadOnlyDictionary<int, Dictionary<int, SpreadsheetCell>> CellsByRow { get; }

	public int LastDataRow { get; }

	public int LastDataColumn { get; }

	public IReadOnlyDictionary<int, double> CustomColumnWidths { get; }

	public double DefaultColumnWidth { get; }

	public IReadOnlyDictionary<int, double> CustomRowHeights { get; }

	public double DefaultRowHeight { get; }

	public IReadOnlySet<int> HiddenRows { get; }

	public IReadOnlySet<int> HiddenColumns { get; }

	public IReadOnlyList<SpreadsheetCellRange> MergedRanges { get; }

	public int FrozenRowCount { get; }

	public int FrozenColumnCount { get; }

	public bool ShowsGridLines { get; }

	public IReadOnlyDictionary<SpreadsheetCellAddress, string> Hyperlinks { get; }

	public IReadOnlyList<SpreadsheetCellStyle> Styles { get; }

	public SpreadsheetSheet(string name, Dictionary<int, Dictionary<int, SpreadsheetCell>> cellsByRow, Dictionary<int, double> customColumnWidths, double defaultColumnWidth, Dictionary<int, double> customRowHeights, double defaultRowHeight, HashSet<int> hiddenRows, HashSet<int> hiddenColumns, List<SpreadsheetCellRange> mergedRanges, int frozenRowCount, int frozenColumnCount, bool showsGridLines, Dictionary<SpreadsheetCellAddress, string> hyperlinks, List<SpreadsheetCellStyle> styles)
	{
		Name = name;
		CellsByRow = cellsByRow;
		CustomColumnWidths = customColumnWidths;
		DefaultColumnWidth = defaultColumnWidth;
		CustomRowHeights = customRowHeights;
		DefaultRowHeight = defaultRowHeight;
		HiddenRows = hiddenRows;
		HiddenColumns = hiddenColumns;
		MergedRanges = mergedRanges;
		FrozenRowCount = frozenRowCount;
		FrozenColumnCount = frozenColumnCount;
		ShowsGridLines = showsGridLines;
		Hyperlinks = hyperlinks;
		List<SpreadsheetCellStyle> list;
		int key;
		if (styles.Count != 0)
		{
			list = styles;
		}
		else
		{
			int num = 1;
			list = new List<SpreadsheetCellStyle>(num);
			CollectionsMarshal.SetCount(list, num);
			Span<SpreadsheetCellStyle> span = CollectionsMarshal.AsSpan(list);
			key = 0;
			span[key] = new SpreadsheetCellStyle();
		}
		Styles = list;
		int num2 = -1;
		int num3 = -1;
		foreach (KeyValuePair<int, Dictionary<int, SpreadsheetCell>> item in cellsByRow)
		{
			item.Deconstruct(out key, out var value);
			int val = key;
			Dictionary<int, SpreadsheetCell> dictionary = value;
			if (dictionary.Count != 0)
			{
				num2 = Math.Max(num2, val);
				num3 = Math.Max(num3, dictionary.Keys.Max());
			}
		}
		foreach (SpreadsheetCellRange mergedRange in mergedRanges)
		{
			num2 = Math.Max(num2, mergedRange.LastRow);
			num3 = Math.Max(num3, mergedRange.LastColumn);
		}
		LastDataRow = num2;
		LastDataColumn = num3;
	}

	public SpreadsheetCell? Cell(int row, int column)
	{
		if (!CellsByRow.TryGetValue(row, out Dictionary<int, SpreadsheetCell> value) || !value.TryGetValue(column, out var value2))
		{
			return null;
		}
		return value2;
	}

	public SpreadsheetCellStyle Style(int index)
	{
		if (index < 0 || index >= Styles.Count)
		{
			return Styles[0];
		}
		return Styles[index];
	}
}
