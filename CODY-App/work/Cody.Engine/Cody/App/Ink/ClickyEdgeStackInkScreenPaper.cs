using Microsoft.UI.Xaml.Controls;

namespace HeyClicky.App.Ink;

public sealed class ClickyEdgeStackInkScreenPaper : Grid
{
	public ClickyEdgeStackInkScreenPaper(ClickyHomeSpreadPaper paper, bool showsDots = true)
	{
		IsHitTestVisible = false;
		Children.Add(new PaperSurface(ClickyShape.Rectangle, paper.Fill, 0.45));
		if (showsDots)
		{
			Children.Add(new ClickyPaperBoardDots());
		}
	}
}
