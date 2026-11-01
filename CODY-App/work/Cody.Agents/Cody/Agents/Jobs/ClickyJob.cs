using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace HeyClicky.Agents.Jobs;

public sealed record ClickyJob
{
	public required string Id { get; init; }

	public required string Title { get; init; }

	public required string Prompt { get; init; }

	public string? ThreadId { get; init; }

	public required string FolderPath { get; init; }

	public DateTimeOffset CreatedAt { get; init; }

	public DateTimeOffset? FinishedAt { get; init; }

	public ClickyJobOutcome Outcome { get; init; }

	public string? Summary { get; init; }

	public string? ReplyText { get; init; }

	public IReadOnlyList<string> ArtifactEntries { get; init; } = Array.Empty<string>();

	public IReadOnlyList<string>? LatestReplyArtifactEntries { get; init; }

	public bool IsSeen { get; init; }

	public bool IsDismissed { get; init; }

	public bool? FollowedUpOnLaterDay { get; init; }

	public bool? IsArchived { get; init; }

	public string? CloudColorName { get; init; }

	public Guid? SuggestionCardId { get; init; }

	public bool? WaitsForChrome { get; init; }

	public bool? SkipsChrome { get; init; }

	public IReadOnlyList<ClickyJobRun>? Runs { get; init; }

	public ClickyJobUserStep? WaitingStep { get; init; }

	public ClickyAnswer? ResultCard { get; init; }

	[JsonIgnore]
	public bool IsWaitingToStart
	{
		get
		{
			if (SuggestionCardId.HasValue)
			{
				return ThreadId == null;
			}
			return false;
		}
	}

	[JsonIgnore]
	public bool IsHeldForChrome
	{
		get
		{
			if (WaitsForChrome == true)
			{
				return ThreadId == null;
			}
			return false;
		}
	}

	[JsonIgnore]
	public IReadOnlyList<string> AllThreadIds
	{
		get
		{
			List<string> list = (Runs ?? Array.Empty<ClickyJobRun>()).Select((ClickyJobRun r) => r.ThreadId).OfType<string>().ToList();
			string threadId = ThreadId;
			if (threadId != null && !list.Contains(threadId))
			{
				list.Add(threadId);
			}
			return list;
		}
	}

	[JsonIgnore]
	public string RailKey => "job:" + Id;

	[JsonIgnore]
	public bool IsFinished => Outcome != ClickyJobOutcome.Working;

	[JsonIgnore]
	public bool IsQuickActionWithoutOutput
	{
		get
		{
			if (Outcome == ClickyJobOutcome.Done && ArtifactEntries.Count == 0)
			{
				return (ReplyText?.Trim().Length ?? 0) <= 160;
			}
			return false;
		}
	}

	[JsonIgnore]
	public ClickyJobKind Kind => ClickyJobKinds.Infer(ArtifactEntries, Title, Prompt);

	[JsonIgnore]
	public IReadOnlyList<string> FilesFromLatestReply => LatestReplyArtifactEntries ?? ArtifactEntries;

	public const string RailKeyPrefix = "job:";

	public static string? JobIdFromRailKey(string railKey)
	{
		if (!railKey.StartsWith("job:", StringComparison.Ordinal))
		{
			return null;
		}
		int length = "job:".Length;
		return railKey.Substring(length, railKey.Length - length);
	}
}
