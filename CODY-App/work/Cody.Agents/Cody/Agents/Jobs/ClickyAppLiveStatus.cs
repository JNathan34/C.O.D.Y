using System;
using System.Collections.Generic;

namespace HeyClicky.Agents.Jobs;

public sealed record ClickyAppLiveStatus(ClickyAppLiveStatus.Phases Phase, string Line, IReadOnlyList<string> ProgressLines, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt)
{
	public enum Phases
	{
		Idle,
		Working,
		NeedsYou,
		Finished,
		Failed
	}

	public static readonly ClickyAppLiveStatus Idle = new ClickyAppLiveStatus(Phases.Idle, "", Array.Empty<string>(), null, null);
}
