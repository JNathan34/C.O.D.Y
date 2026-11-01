using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;

namespace HeyClicky.App.Browser;

public interface IChromeClickyDrive
{
	bool IsAvailable { get; }

	bool IsDrivingNow { get; }

	bool DriveForApp(string goal, string? targetProcessName, Action<ClickyDriveEnding> ended);

	bool HandleEscape();

	Task GlideAndDragAsync(Point from, IReadOnlyList<Point> path);

	void SayVerbatim(string line);
}
