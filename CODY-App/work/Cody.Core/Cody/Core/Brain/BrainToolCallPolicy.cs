using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace HeyClicky.Core.Brain;

public static class BrainToolCallPolicy
{
	public static readonly IReadOnlySet<string> ParallelToolNames = new HashSet<string> { "file_read", "file_list", "clicky_memory", "session_status", "clicky_artifacts", "google_calendar_find_events" };

	public static readonly IReadOnlyDictionary<string, string[]> AsyncSuccessStatuses = new Dictionary<string, string[]>
	{
		["open_url"] = new string[1] { "opened" },
		["play_on_spotify"] = new string[1] { "completed" },
		["copy_to_clipboard"] = new string[1] { "ok" },
		["insert_text"] = new string[1] { "inserted" },
		["open_agent_dashboard"] = new string[1] { "ok" },
		["open_artifact"] = new string[1] { "completed" },
		["reveal_artifact"] = new string[1] { "completed" },
		["sessions_spawn"] = new string[1] { "dispatched" },
		["sessions_send"] = new string[1] { "sent" },
		["show_result"] = new string[1] { "shown" },
		["routines"] = new string[6] { "created", "updated", "paused", "resumed", "deleted", "started" }
	};

	public static readonly IReadOnlySet<string> ScreenChangingAsyncToolNames = new HashSet<string> { "open_url", "open_artifact", "reveal_artifact", "open_agent_dashboard", "play_on_spotify" };

	public static readonly IReadOnlySet<string> ToolsHeldDuringTheTour = new HashSet<string> { "sessions_spawn", "sessions_send", "shell_exec", "insert_text" };

	public static bool RunsInParallel(string name)
	{
		return ParallelToolNames.Contains(name);
	}

	public static bool BringsAnotherAppForward(string name, bool isAsync)
	{
		if (isAsync)
		{
			return ScreenChangingAsyncToolNames.Contains(name);
		}
		return false;
	}

	public static bool IsCleanAsyncSuccess(string name, string output)
	{
		if (!AsyncSuccessStatuses.TryGetValue(name, out string[] value))
		{
			return false;
		}
		try
		{
			using JsonDocument jsonDocument = JsonDocument.Parse(output);
			JsonElement rootElement = jsonDocument.RootElement;
			if (rootElement.ValueKind != JsonValueKind.Object || !rootElement.TryGetProperty("status", out var value2) || value2.ValueKind != JsonValueKind.String)
			{
				return false;
			}
			JsonElement value3;
			return Enumerable.Contains(value, value2.GetString()) && !rootElement.TryGetProperty("message", out value3);
		}
		catch (JsonException)
		{
			return false;
		}
	}

	public static bool NeedsAnotherRound(IReadOnlyList<BrainToolCall> calls, IReadOnlyList<string> outputs)
	{
		for (int i = 0; i < calls.Count; i++)
		{
			if (!calls[i].IsAsync || i >= outputs.Count || !IsCleanAsyncSuccess(calls[i].Name, outputs[i]))
			{
				return true;
			}
		}
		return false;
	}
}
