using HeyClicky.Core.Ink;
using Microsoft.UI.Xaml;
using Windows.UI;

namespace HeyClicky.App.Ink;

public static class ClickyInkRoutineStatusLine
{
	public static FrameworkElement Create(ClickyInkRoutineControl routine, ClickyInkStyle style)
	{
		Color color;
		if (routine.IsPaused)
		{
			color = PaperColor.Hex("#B4541A");
		}
		else
		{
			color = (routine.IsRunning ? style.Fresh : style.Quiet);
		}
		return InkTextView.Plain(ClickyInkDashboardViewMath.RoutineStatusWords(routine), ClickyPaperFonts.Hand(15.0), color).With((InkTextView t) =>
		{
			t.LineLimit = 1;
		});
	}
}
