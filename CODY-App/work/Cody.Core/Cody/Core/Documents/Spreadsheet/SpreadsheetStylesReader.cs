using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace HeyClicky.Core.Documents.Spreadsheet;

public static class SpreadsheetStylesReader
{
	private sealed class FontInfo
	{
		public bool IsBold;

		public bool IsItalic;

		public bool IsUnderlined;

		public bool IsStruckThrough;

		public double Size = 11.0;

		public SpreadsheetColor? Color;
	}

	private readonly record struct BorderInfo(SpreadsheetBorderEdge? Left, SpreadsheetBorderEdge? Right, SpreadsheetBorderEdge? Top, SpreadsheetBorderEdge? Bottom);

	public static List<SpreadsheetCellStyle> Styles(SpreadsheetXmlNode? root, SpreadsheetThemeColors theme)
	{
		if (root == null)
		{
			int num = 1;
			List<SpreadsheetCellStyle> list = new List<SpreadsheetCellStyle>(num);
			CollectionsMarshal.SetCount(list, num);
			Span<SpreadsheetCellStyle> span = CollectionsMarshal.AsSpan(list);
			int index = 0;
			span[index] = new SpreadsheetCellStyle();
			return list;
		}
		IReadOnlyList<SpreadsheetColor> indexedPalette = SpreadsheetColors.DefaultIndexedPalette;
		List<SpreadsheetXmlNode> list2 = root.FirstChild("colors")?.FirstChild("indexedColors")?.Children("rgbColor");
		if (list2 != null && list2.Count > 0)
		{
			indexedPalette = (from c in list2.Select((SpreadsheetXmlNode c) =>
				{
					string text2 = c.Attribute("rgb");
					return (text2 == null) ? ((SpreadsheetColor?)null) : SpreadsheetColors.FromHex(text2);
				})
				where c.HasValue
				select c.Value).ToList();
		}
		Dictionary<int, string> numberFormats = new Dictionary<int, string>();
		foreach (SpreadsheetXmlNode item in root.FirstChild("numFmts")?.Children("numFmt") ?? new List<SpreadsheetXmlNode>())
		{
			int? num2 = SwiftText.ParseInt(item.Attribute("numFmtId"));
			if (num2.HasValue)
			{
				int valueOrDefault = num2.GetValueOrDefault();
				string text = item.Attribute("formatCode");
				if (text != null)
				{
					numberFormats[valueOrDefault] = text;
				}
			}
		}
		List<FontInfo> fonts = (root.FirstChild("fonts")?.Children("font") ?? new List<SpreadsheetXmlNode>()).Select((SpreadsheetXmlNode font) =>
		{
			FontInfo fontInfo = new FontInfo
			{
				IsBold = Flag(font.FirstChild("b")),
				IsItalic = Flag(font.FirstChild("i"))
			};
			SpreadsheetXmlNode spreadsheetXmlNode = font.FirstChild("u");
			fontInfo.IsUnderlined = spreadsheetXmlNode != null && spreadsheetXmlNode.Attribute("val") != "none";
			fontInfo.IsStruckThrough = Flag(font.FirstChild("strike"));
			FontInfo fontInfo2 = fontInfo;
			double? num3 = SwiftText.ParseDouble(font.FirstChild("sz")?.Attribute("val"));
			if (num3.HasValue)
			{
				double valueOrDefault2 = num3.GetValueOrDefault();
				fontInfo2.Size = valueOrDefault2;
			}
			fontInfo2.Color = SpreadsheetColors.FromNode(font.FirstChild("color"), theme, indexedPalette);
			return fontInfo2;
		}).ToList();
		List<SpreadsheetColor?> fills = (root.FirstChild("fills")?.Children("fill") ?? new List<SpreadsheetXmlNode>()).Select((SpreadsheetXmlNode fill) =>
		{
			SpreadsheetXmlNode spreadsheetXmlNode = fill.FirstChild("patternFill");
			if (spreadsheetXmlNode == null)
			{
				return SpreadsheetColors.FromNode((fill.FirstChild("gradientFill")?.Children("stop").FirstOrDefault())?.FirstChild("color"), theme, indexedPalette);
			}
			bool flag;
			switch (spreadsheetXmlNode.Attribute("patternType") ?? "none")
			{
			case "none":
			case "gray125":
			case "gray0625":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			return flag ? ((SpreadsheetColor?)null) : (SpreadsheetColors.FromNode(spreadsheetXmlNode.FirstChild("fgColor"), theme, indexedPalette) ?? SpreadsheetColors.FromNode(spreadsheetXmlNode.FirstChild("bgColor"), theme, indexedPalette));
		}).ToList();
		List<BorderInfo> borders = ((IEnumerable<SpreadsheetXmlNode>)(root.FirstChild("borders")?.Children("border") ?? new List<SpreadsheetXmlNode>())).Select((Func<SpreadsheetXmlNode, BorderInfo>)((SpreadsheetXmlNode border) =>
		{
			return new BorderInfo(Edge("left") ?? Edge("start"), Edge("right") ?? Edge("end"), Edge("top"), Edge("bottom"));
			SpreadsheetBorderEdge? Edge(string name)
			{
				SpreadsheetXmlNode spreadsheetXmlNode = border.FirstChild(name);
				if (spreadsheetXmlNode != null)
				{
					string text2 = spreadsheetXmlNode.Attribute("style");
					if (text2 != null && !(text2 == "none"))
					{
						int num3;
						switch (text2)
						{
						case "medium":
						case "mediumDashed":
						case "slantDashDot":
						case "mediumDashDot":
						case "mediumDashDotDot":
							num3 = 2;
							break;
						case "double":
						case "thick":
							num3 = 3;
							break;
						default:
							num3 = 1;
							break;
						}
						double width = num3;
						SpreadsheetColor color = SpreadsheetColors.FromNode(spreadsheetXmlNode.FirstChild("color"), theme, indexedPalette) ?? SpreadsheetColors.Black;
						return new SpreadsheetBorderEdge(width, color, text2.ToLowerInvariant().Contains("dash") || text2 == "dotted" || text2 == "hair");
					}
				}
				return null;
			}
		})).ToList();
		List<SpreadsheetXmlNode> list3 = root.FirstChild("cellXfs")?.Children("xf") ?? new List<SpreadsheetXmlNode>();
		if (list3.Count == 0)
		{
			int index = 1;
			List<SpreadsheetCellStyle> list4 = new List<SpreadsheetCellStyle>(index);
			CollectionsMarshal.SetCount(list4, index);
			Span<SpreadsheetCellStyle> span = CollectionsMarshal.AsSpan(list4);
			int num = 0;
			span[num] = new SpreadsheetCellStyle();
			return list4;
		}
		return list3.Select((SpreadsheetXmlNode format) =>
		{
			SpreadsheetCellStyle result = new SpreadsheetCellStyle();
			int? num3 = SwiftText.ParseInt(format.Attribute("fontId"));
			if (num3.HasValue)
			{
				int valueOrDefault2 = num3.GetValueOrDefault();
				if (valueOrDefault2 >= 0 && valueOrDefault2 < fonts.Count)
				{
					FontInfo fontInfo = fonts[valueOrDefault2];
					result.IsBold = fontInfo.IsBold;
					result.IsItalic = fontInfo.IsItalic;
					result.IsUnderlined = fontInfo.IsUnderlined;
					result.IsStruckThrough = fontInfo.IsStruckThrough;
					result.FontSize = Math.Round(fontInfo.Size * 1.17, MidpointRounding.ToEven);
					result.TextColor = fontInfo.Color;
				}
			}
			num3 = SwiftText.ParseInt(format.Attribute("fillId"));
			if (num3.HasValue)
			{
				int valueOrDefault3 = num3.GetValueOrDefault();
				if (valueOrDefault3 >= 0 && valueOrDefault3 < fills.Count)
				{
					result.FillColor = fills[valueOrDefault3];
				}
			}
			num3 = SwiftText.ParseInt(format.Attribute("borderId"));
			if (num3.HasValue)
			{
				int valueOrDefault4 = num3.GetValueOrDefault();
				if (valueOrDefault4 >= 0 && valueOrDefault4 < borders.Count)
				{
					BorderInfo borderInfo = borders[valueOrDefault4];
					result.LeftBorder = borderInfo.Left;
					result.RightBorder = borderInfo.Right;
					result.TopBorder = borderInfo.Top;
					result.BottomBorder = borderInfo.Bottom;
				}
			}
			int valueOrDefault5 = SwiftText.ParseInt(format.Attribute("numFmtId")).GetValueOrDefault();
			result.NumberFormatCode = (numberFormats.TryGetValue(valueOrDefault5, out string value) ? value : (SpreadsheetNumberFormat.BuiltInFormatCode(valueOrDefault5) ?? "General"));
			SpreadsheetXmlNode spreadsheetXmlNode = format.FirstChild("alignment");
			if (spreadsheetXmlNode != null)
			{
				SpreadsheetHorizontalAlignment horizontalAlignment;
				switch (spreadsheetXmlNode.Attribute("horizontal"))
				{
				case "fill":
				case "left":
				case "justify":
				case "distributed":
					horizontalAlignment = SpreadsheetHorizontalAlignment.Left;
					break;
				case "center":
				case "centerContinuous":
					horizontalAlignment = SpreadsheetHorizontalAlignment.Center;
					break;
				case "right":
					horizontalAlignment = SpreadsheetHorizontalAlignment.Right;
					break;
				default:
					horizontalAlignment = SpreadsheetHorizontalAlignment.General;
					break;
				}
				result.HorizontalAlignment = horizontalAlignment;
				SpreadsheetVerticalAlignment verticalAlignment;
				switch (spreadsheetXmlNode.Attribute("vertical"))
				{
				case "top":
					verticalAlignment = SpreadsheetVerticalAlignment.Top;
					break;
				case "center":
				case "justify":
				case "distributed":
					verticalAlignment = SpreadsheetVerticalAlignment.Center;
					break;
				default:
					verticalAlignment = SpreadsheetVerticalAlignment.Bottom;
					break;
				}
				result.VerticalAlignment = verticalAlignment;
				string text2 = spreadsheetXmlNode.Attribute("wrapText");
				bool wrapsText = ((text2 == "1" || text2 == "true") ? true : false);
				result.WrapsText = wrapsText;
				result.IndentLevel = SwiftText.ParseInt(spreadsheetXmlNode.Attribute("indent")).GetValueOrDefault();
			}
			return result;
		}).ToList();
	}

	private static bool Flag(SpreadsheetXmlNode? node)
	{
		if (node == null)
		{
			return false;
		}
		string text = node.Attribute("val");
		if (text == null)
		{
			return true;
		}
		if (text == "1" || text == "true")
		{
			return true;
		}
		return false;
	}

	public static bool IsDateCode(string code)
	{
		string text = code.ToLowerInvariant();
		if (text == "general")
		{
			return false;
		}
		string text2 = Regex.Replace(Regex.Replace(text, "\"[^\"]*\"", ""), "\\[[^\\]]*\\]", "");
		if (!text2.Contains('y') && !text2.Contains('d') && !text2.Contains('h'))
		{
			if (text2.Contains('m') && !text2.Contains('0'))
			{
				return !text2.Contains('#');
			}
			return false;
		}
		return true;
	}
}
