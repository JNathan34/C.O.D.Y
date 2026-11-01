using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;

namespace HeyClicky.App.Dock;

internal sealed class FirstThatFitsHorizontally : Panel
{
	private int chosen = -1;

	protected override Size MeasureOverride(Size available)
	{
		chosen = -1;
		for (int i = 0; i < Children.Count; i++)
		{
			bool flag = i == Children.Count - 1;
			Children[i].Measure(flag ? available : new Size(double.PositiveInfinity, available.Height));
			if (chosen < 0 && (flag || Children[i].DesiredSize.Width <= available.Width + 0.5))
			{
				chosen = i;
			}
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
		return Children[chosen].DesiredSize;
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
