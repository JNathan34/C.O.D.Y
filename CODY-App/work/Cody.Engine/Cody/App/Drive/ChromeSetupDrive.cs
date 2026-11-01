using ClickyScreenActuator = HeyClicky.App.Cody.CodyIndependentInput;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using HeyClicky.App.Browser;
using HeyClicky.Core.Drive;
using HeyClicky.Core.Voice;
using HeyClicky.Platform.Input;

namespace HeyClicky.App.Drive;

internal sealed class ChromeSetupDrive : IChromeClickyDrive
{
	private readonly ClickyTakeOverController drive;

	private readonly CompanionSession companion;

	public bool IsAvailable => drive.IsAvailable();

	public bool IsDrivingNow => drive.IsDriving;

	public ChromeSetupDrive(ClickyTakeOverController drive, CompanionSession companion)
	{
		this.drive = drive;
		this.companion = companion;
	}

	public bool DriveForApp(string goal, string? targetProcessName, Action<ClickyDriveEnding> ended)
	{
		return drive.DriveForApp(goal, targetProcessName, (AgentDriveOutcome outcome) =>
		{
			Action<ClickyDriveEnding> action = ended;
			action(outcome.Ending switch
			{
				AgentDriveEnding.Finished => ClickyDriveEnding.Finished, 
				AgentDriveEnding.UserTookOver => ClickyDriveEnding.UserTookOver, 
				_ => ClickyDriveEnding.Failed, 
			});
		});
	}

	public bool HandleEscape()
	{
		return drive.HandleEscape();
	}

	public async Task GlideAndDragAsync(Point from, IReadOnlyList<Point> path)
	{
		await ClickyScreenActuator.GlideAsync(new PointD(from.X, from.Y), 0.35).ConfigureAwait(continueOnCapturedContext: false);
		await ClickyScreenActuator.DragAsync(path.Select((Point p) => new PointD(p.X, p.Y)).ToList()).ConfigureAwait(continueOnCapturedContext: false);
	}

	public void SayVerbatim(string line)
	{
		companion.SpeakVerbatimLineAsync(line);
	}
}
