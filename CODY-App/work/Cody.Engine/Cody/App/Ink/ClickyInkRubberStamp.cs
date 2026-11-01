using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Windows.UI;

namespace HeyClicky.App.Ink;

public static class ClickyInkRubberStamp
{
	public static FrameworkElement Make(string words, Color? color = null, double angle = -4.0)
	{
		Color c = color ?? PaperColor.Hex("#C2410C");
		InkTextView inkTextView = InkViews.Plain(words.ToUpperInvariant(), InkObjectFonts.Mono(9.5, FontWeights.ExtraBold), c.Opacity(0.72), (InkTextView t) =>
		{
			t.Tracking = 1.4;
		});
		inkTextView.Margin = new Thickness(6.0, 2.0, 6.0, 2.0);
		ClickyShapeView clickyShapeView = ClickyShapeView.Stroke(ClickyShape.RoundedRectangle(3.0), new PaperStroke(c.Opacity(0.55), 1.2));
		ClickyInkOverlay clickyInkOverlay = new ClickyInkOverlay(inkTextView, clickyShapeView)
		{
			HorizontalAlignment = HorizontalAlignment.Left,
			VerticalAlignment = VerticalAlignment.Top
		};
		clickyInkOverlay.Transformed(0.0, 0.0, angle * 0.6);
		return clickyInkOverlay;
	}

	public static InkTextView TypedLabel(string words, Color color)
	{
		return InkViews.Plain(words.ToUpperInvariant(), InkObjectFonts.Mono(9.5, FontWeights.Bold), color, (InkTextView t) =>
		{
			t.Tracking = 1.0;
		});
	}
}
