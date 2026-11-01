using HeyClicky.Core.Ink;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace HeyClicky.App.Ink;

public sealed class ClickyInkHeightMorph : Panel
{
	private readonly double progress;

	public ClickyInkHeightMorph(double progress, UIElement now, UIElement before)
	{
		this.progress = progress;
		Children.Add(now);
		Children.Add(before);
	}

	protected override Size MeasureOverride(Size availableSize)
	{
		Size availableSize2 = new Size(availableSize.Width, double.PositiveInfinity);
		Children[0].Measure(availableSize2);
		Size desiredSize = Children[0].DesiredSize;
		if (Children.Count < 2)
		{
			return desiredSize;
		}
		Children[1].Measure(availableSize2);
		double height = Children[1].DesiredSize.Height;
		return new Size(desiredSize.Width, height + (desiredSize.Height - height) * ClickyInkClock.EaseInOut(progress));
	}

	protected override Size ArrangeOverride(Size finalSize)
	{
		foreach (UIElement child in Children)
		{
			child.Arrange(new Rect(0.0, 0.0, finalSize.Width, child.DesiredSize.Height));
		}
		return finalSize;
	}
}
