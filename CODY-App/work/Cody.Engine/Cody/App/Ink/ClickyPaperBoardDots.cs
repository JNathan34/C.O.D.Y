using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;
using Windows.UI;

namespace HeyClicky.App.Ink;

public sealed class ClickyPaperBoardDots : Grid
{
	public const double Spacing = 16.0;

	public const double Radius = 1.1;

	public const double DotOpacity = 0.11;

	public ClickyPaperBoardDots(Color? color = null)
	{
		IsHitTestVisible = false;
		Color c = color ?? PaperColor.Black.Opacity(0.11);
		PaperDrawing drawing = new PaperDrawing();
		Children.Add(drawing);
		SizeChanged += (object _, SizeChangedEventArgs e) =>
		{
			drawing.Children.Clear();
			double num = 6.4;
			PaperPath paperPath = new PaperPath();
			for (double num2 = 16.0; num2 <= e.NewSize.Height - num; num2 += 16.0)
			{
				for (double num3 = 16.0; num3 <= e.NewSize.Width - num; num3 += 16.0)
				{
					paperPath.AddEllipse(new Rect(num3 - 1.1, num2 - 1.1, 2.2, 2.2));
				}
			}
			drawing.Fill(paperPath, c);
		};
	}
}
