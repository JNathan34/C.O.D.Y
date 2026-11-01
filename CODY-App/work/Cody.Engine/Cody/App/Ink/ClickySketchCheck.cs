using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;
using Windows.UI;

namespace HeyClicky.App.Ink;

public sealed class ClickySketchCheck : Grid
{
	public ClickySketchCheck(Color? color = null, double scale = 1.0)
	{
		IsHitTestVisible = false;
		Width = 22.0 * scale;
		Height = 18.0 * scale;
		PaperPath p = new PaperPath().MoveTo(2.0, 9.5).CubicTo(new Point(8.0, 15.5), new Point(4f, 11f), new Point(6.0, 13.5)).CubicTo(new Point(20f, 2f), new Point(11f, 10f), new Point(15f, 5f))
			.Transformed(scale, scale);
		Children.Add(new PaperDrawing().Stroke(p, new PaperStroke(color ?? ClickySketchInk.TealLine, 2.6 * scale, PenLineCap.Round, PenLineJoin.Round)));
	}
}
