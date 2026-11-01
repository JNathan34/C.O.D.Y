using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace HeyClicky.Core.Notch;

public sealed record ChatHandOff
{
	public required string Id { get; init; }

	public required ChatHandOffKind Kind { get; init; }

	public string? JobId { get; init; }

	public string? ClickySlug { get; init; }

	public required string Title { get; init; }

	public required DateTimeOffset CreatedAt { get; init; }

	public bool IsFollowUp { get; init; }

	public ChatHandOffOutcome? Outcome { get; init; }

	public string? ReplyText { get; init; }

	public string? LessonId { get; init; }

	public string? DeliveredText { get; init; }

	public string? DeliveredToApp { get; init; }

	public bool? WasCopied { get; init; }

	public string? FullReply { get; init; }

	public IReadOnlyList<string>? ArtifactEntries { get; init; }

	public JsonObject? Answer { get; init; }

	public string? ThreadId { get; init; }

	public JsonObject? Card { get; init; }

	public bool? IsRoutineRun { get; init; }

	public string? TaskTitle { get; init; }

	public IReadOnlyList<string>? FollowUps { get; init; }

	[JsonIgnore]
	public string TargetKey => Kind switch
	{
		ChatHandOffKind.Drawing => "drawing:" + (LessonId ?? Id), 
		ChatHandOffKind.Text => "text:" + Id, 
		_ => (JobId != null) ? ("job:" + JobId) : ("clicky:" + ClickySlug), 
	};

	public static string TargetKeyFor(string? jobId, string? clickySlug)
	{
		if (jobId == null)
		{
			return "clicky:" + clickySlug;
		}
		return "job:" + jobId;
	}
}
