using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace HeyClicky.App.Dock;

public sealed class FirstThatFits : Panel
{
	private int chosen = -1;

	protected override Size MeasureOverride(Size available)
	{
		chosen = -1;
		for (int i = 0; i < Children.Count; i++)
		{
			UIElement uIElement = Children[i];
			uIElement.Measure(new Size(available.Width, double.PositiveInfinity));
			if (chosen < 0 && uIElement.DesiredSize.Height <= available.Height + 0.5)
			{
				chosen = i;
			}
		}
		if (chosen < 0)
		{
			chosen = Children.Count - 1;
		}
		for (int j = 0; j < Children.Count; j++)
		{
			Children[j].Opacity = ((j == chosen) ? 1 : 0);
			Children[j].IsHitTestVisible = j == chosen;
		}
		if (chosen < 0)
		{
			return new Size(0f, 0f);
		}
		Children[chosen].Measure(available);
		Size desiredSize = Children[chosen].DesiredSize;
		return new Size(double.IsInfinity(available.Width) ? desiredSize.Width : available.Width, Math.Min(desiredSize.Height, available.Height));
	}

	protected override Size ArrangeOverride(Size final)
	{
		for (int i = 0; i < Children.Count; i++)
		{
			Children[i].Arrange((i == chosen) ? new Rect(0.0, 0.0, final.Width, final.Height) : new Rect(0f, 0f, 0f, 0f));
		}
		return final;
	}
}
