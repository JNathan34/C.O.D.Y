using System;

namespace HeyClicky.Agents.Jobs;

public sealed record ClickyJobRun
{
	public string? ThreadId { get; init; }

	public DateTimeOffset StartedAt { get; init; }

	public required string Ask { get; init; }

	public DateTimeOffset? FinishedAt { get; init; }

	public ClickyJobOutcome Outcome { get; init; }

	public string? Summary { get; init; }
}
