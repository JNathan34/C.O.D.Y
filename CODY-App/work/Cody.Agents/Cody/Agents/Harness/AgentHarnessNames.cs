using System.Collections.Generic;

namespace HeyClicky.Agents.Harness;

public static class AgentHarnessNames
{
	public static string RawValue(this AgentHarness harness)
	{
		return harness switch
		{
			AgentHarness.Codex => "codex", 
			AgentHarness.Pi => "pi", 
			_ => "h1", 
		};
	}

	public static string DisplayName(this AgentHarness harness)
	{
		return harness switch
		{
			AgentHarness.Codex => "Codex", 
			AgentHarness.Pi => "Pi", 
			_ => "H1", 
		};
	}

	public static string Detail(this AgentHarness harness)
	{
		return harness switch
		{
			AgentHarness.Codex => "The bundled Codex app-server on this PC, or Codex in a cloud box.", 
			AgentHarness.Pi => "pi-coding-agent 0.87.1: on this PC with the job's skills and connected apps, or in a cloud box.", 
			_ => "The default: H1 on this PC (the app's own runner), or the lab Worker in the cloud with the device helper.", 
		};
	}

	public static IReadOnlyList<AgentHarnessPlace> Places(this AgentHarness harness)
	{
		return new _003C_003Ez__ReadOnlyArray<AgentHarnessPlace>(new AgentHarnessPlace[2]
		{
			AgentHarnessPlace.Mac,
			AgentHarnessPlace.Cloud
		});
	}

	public static AgentHarness? ParseHarness(string? raw)
	{
		return raw?.Trim().ToLowerInvariant() switch
		{
			"codex" => (AgentHarness?)AgentHarness.Codex, 
			"pi" => AgentHarness.Pi, 
			"h1" => AgentHarness.H1, 
			_ => null, 
		};
	}

	public static string RawValue(this AgentHarnessPlace place)
	{
		if (place != AgentHarnessPlace.Cloud)
		{
			return "mac";
		}
		return "cloud";
	}

	public static string DisplayName(this AgentHarnessPlace place)
	{
		if (place != AgentHarnessPlace.Cloud)
		{
			return "On this PC";
		}
		return "In the cloud";
	}

	public static AgentHarnessPlace? ParsePlace(string? raw)
	{
		string text = raw?.Trim().ToLowerInvariant();
		if (!(text == "mac"))
		{
			if (text == "cloud")
			{
				return AgentHarnessPlace.Cloud;
			}
			return null;
		}
		return AgentHarnessPlace.Mac;
	}

	public static string RawValue(this AgentHarnessModel model)
	{
		return model switch
		{
			AgentHarnessModel.Luna => "gpt-6-luna", 
			AgentHarnessModel.Haiku => "claude-haiku-5-5", 
			_ => "default", 
		};
	}

	public static string DisplayName(this AgentHarnessModel model)
	{
		return model switch
		{
			AgentHarnessModel.Luna => "GPT-6 Luna", 
			AgentHarnessModel.Haiku => "Claude Haiku 5.5", 
			_ => "Default", 
		};
	}

	public static bool IsClaude(this AgentHarnessModel model)
	{
		return model == AgentHarnessModel.Haiku;
	}

	public static AgentHarnessModel ParseModel(string? raw)
	{
		if (!(raw == "gpt-6-luna"))
		{
			if (raw == "claude-haiku-5-5")
			{
				return AgentHarnessModel.Haiku;
			}
			return AgentHarnessModel.Standard;
		}
		return AgentHarnessModel.Luna;
	}
}
