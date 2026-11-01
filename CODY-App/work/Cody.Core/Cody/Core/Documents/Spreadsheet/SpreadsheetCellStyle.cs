namespace HeyClicky.Core.Documents.Spreadsheet;

public struct SpreadsheetCellStyle
{
	public bool IsBold = false;

	public bool IsItalic = false;

	public bool IsUnderlined = false;

	public bool IsStruckThrough = false;

	public double FontSize = 12.5;

	public SpreadsheetColor? TextColor = null;

	public SpreadsheetColor? FillColor = null;

	public SpreadsheetHorizontalAlignment HorizontalAlignment = SpreadsheetHorizontalAlignment.General;

	public SpreadsheetVerticalAlignment VerticalAlignment = SpreadsheetVerticalAlignment.Bottom;

	public bool WrapsText = false;

	public int IndentLevel = 0;

	public SpreadsheetBorderEdge? LeftBorder = null;

	public SpreadsheetBorderEdge? RightBorder = null;

	public SpreadsheetBorderEdge? TopBorder = null;

	public SpreadsheetBorderEdge? BottomBorder = null;

	public string NumberFormatCode = "General";

	public readonly bool HasBorders
	{
		get
		{
			SpreadsheetBorderEdge? leftBorder = LeftBorder;
			if (!leftBorder.HasValue)
			{
				leftBorder = RightBorder;
				if (!leftBorder.HasValue)
				{
					leftBorder = TopBorder;
					if (!leftBorder.HasValue)
					{
						leftBorder = BottomBorder;
						return leftBorder.HasValue;
					}
				}
			}
			return true;
		}
	}

	public SpreadsheetCellStyle()
	{
	}
}
