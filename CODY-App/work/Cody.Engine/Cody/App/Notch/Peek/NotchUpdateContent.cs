using System;
using System.Collections.Generic;

namespace HeyClicky.App.Notch.Peek;

public sealed record NotchUpdateContent
{
	public required string RailKey { get; init; }

	public string? ClickySlug { get; init; }

	public string? JobId { get; init; }

	public string? ThreadId { get; init; }

	public required string Title { get; init; }

	public string? Summary { get; init; }

	public NotchUpdateRequest? Request { get; init; }

	public NotchUpdateReadyOutput? ReadyOutput { get; init; }

	public IReadOnlyList<string> Files { get; init; } = Array.Empty<string>();

	public bool IsStopped { get; init; }

	public string? RoutineBadge { get; init; }

	public string? RoutineTitle { get; init; }
}
