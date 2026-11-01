using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using HeyClicky.Agents.Jobs;

namespace HeyClicky.App.Dock;

public sealed record ArcCardContent
{
	public required string RailKey { get; init; }

	public required string Title { get; init; }

	public required ArcCardState State { get; init; }

	public required ArcPaper Paper { get; init; }

	public ClickyArcPlan? Plan { get; init; }

	public string? CurrentStepLine { get; init; }

	public string? Summary { get; init; }

	public IReadOnlyList<string> Files { get; init; } = Array.Empty<string>();

	public string? ThreadId { get; init; }

	public string? ClickySlug { get; init; }

	public string? JobId { get; init; }

	public string? TaskId { get; init; }

	public string? WorkspacePath { get; init; }

	public bool TaskIsRunning { get; set; }

	public CardFooterRequest? Request { get; set; }

	public CardReadyOutput? ReadyOutput { get; set; }

	public ClickyLiveLine? LiveLine { get; set; }

	public ClickyAnswer? Answer { get; set; }

	public bool IsFinalizing { get; set; }

	public string? NotePath { get; set; }

	public bool IsWorking => ArcCardStates.IsWorking(State);

	public bool IsDone => ArcCardStates.IsDone(State);

	public string Shape
	{
		get
		{
			_003C_003Ey__InlineArray15<object> buffer = default;
			buffer[0] = State;
			buffer[1] = IsFinalizing;
			buffer[2] = Title;
			buffer[3] = Summary;
			buffer[4] = string.Join(",", Files);
			buffer[5] = Request?.Kind;
			buffer[6] = Request?.Text;
			buffer[7] = ReadyOutput?.Kind;
			buffer[8] = ReadyOutput?.ButtonTitle;
			buffer[9] = (((object)Answer == null) ? "" : JsonSerializer.Serialize(Answer));
			buffer[10] = TaskIsRunning;
			buffer[11] = (((object)Plan == null) ? "-" : string.Join(",", Plan.Steps.Select((ClickyArcPlan.Step s) => s.Text)));
			buffer[12] = (((object)Plan == null || Plan.IsEmpty) ? "noplan" : "plan");
			buffer[13] = (((object)LiveLine == null) ? "noline" : "line");
			buffer[14] = ((CurrentStepLine == null) ? "nostep" : "step");
			return string.Join("|", (ReadOnlySpan<object?>)buffer);
		}
	}
}
