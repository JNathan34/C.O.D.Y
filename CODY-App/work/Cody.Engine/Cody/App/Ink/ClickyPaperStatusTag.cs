using HeyClicky.App.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace HeyClicky.App.Ink;

public sealed class ClickyPaperStatusTag : Grid
{
	public ClickyPaperStatusTag(ClickyThingStatus status, string text, double height = 22.0, double fontSize = 11.0)
	{
		Height = height;
		HorizontalAlignment = HorizontalAlignment.Left;
		IsHitTestVisible = false;
		bool flag = (uint)(status - 4) <= 1u;
		Color color;
		switch (status)
		{
		case ClickyThingStatus.NeedsYou:
			color = ClickyPaperGel.Butter.Words();
			break;
		case ClickyThingStatus.Ready:
			color = ClickyPaperGel.Mint.Words();
			break;
		case ClickyThingStatus.Working:
		case ClickyThingStatus.Watching:
			color = ClickyPaperGel.Blue.Words();
			break;
		default:
			color = PaperColor.Hex("#C9CBD3");
			break;
		}
		Color color2 = color;
		switch (status)
		{
		case ClickyThingStatus.NeedsYou:
			Children.Add(new ClickyPaperGelPlate(ClickyPaperGel.Butter));
			break;
		case ClickyThingStatus.Ready:
			Children.Add(new ClickyPaperGelPlate(ClickyPaperGel.Mint));
			break;
		case ClickyThingStatus.Watching:
			Children.Add(new ClickyPaperGelPlate());
			break;
		case ClickyThingStatus.Working:
			Children.Add(new ClickyPaperGelPlate());
			Children.Add(new PaperSurface(ClickyShape.Capsule, PaperFill.Of(PaperColor.Clear)).WithWash(PaperFill.Of(PaperColor.White.Opacity(0.45)), (Size s) => new ClickyPaperStripes().PathIn(new Rect(0.0, 0.0, s.Width, s.Height))).WithOutline(new PaperStroke(ClickyPaperGel.Blue.Rim())));
			break;
		default:
			Children.Add(new PaperSurface(ClickyShape.Capsule, PaperFill.Of(PaperColor.White.Opacity(0.1))).WithOutline(new PaperStroke(PaperColor.White.Opacity(0.18), 0.75)));
			break;
		}
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 6.0,
			Margin = new Thickness(10.0, 0.0, 10.0, 0.0),
			VerticalAlignment = VerticalAlignment.Center
		};
		if (status == ClickyThingStatus.Watching)
		{
			Grid grid = new Grid
			{
				Width = 6.0,
				Height = 6.0,
				VerticalAlignment = VerticalAlignment.Center
			};
			grid.Children.Add(new Ellipse
			{
				Fill = Ui.Brush(PaperColor.Hex("#1E5FE0"))
			});
			grid.Children.Add(new Ellipse
			{
				Stroke = Ui.Brush(PaperColor.Hex("#1E5FE0").Opacity(0.18)),
				StrokeThickness = 2.5,
				Margin = new Thickness(-1.25)
			});
			stackPanel.Children.Add(grid);
		}
		TextBlock textBlock = PaperText.Line(text, ClickyPaperFonts.Typed(fontSize, FontWeights.SemiBold), color2);
		stackPanel.Children.Add(flag ? ((FrameworkElement)textBlock) : ((FrameworkElement)Ui.Embossed(textBlock, 0.6, 1.0)));
		Children.Add(stackPanel);
	}
}
