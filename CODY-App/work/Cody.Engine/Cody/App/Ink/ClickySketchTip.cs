using Microsoft.UI.Xaml.Controls;

namespace HeyClicky.App.Ink;

public sealed class ClickySketchTip : Grid
{
	public ClickySketchTip(string text, ClickySketchTone tone = ClickySketchTone.Blue1)
	{
		Children.Add(new ClickyHandText(text, 16.0, 1.25).WithForeground(tone.SoftWords()));
	}
}
