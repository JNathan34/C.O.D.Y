using System;
using System.Collections.Generic;

namespace HeyClicky.Agents.Harness;

public static class AgentHarnessRuntimes
{
	private static readonly object Gate = new object();

	private static readonly Dictionary<string, IAgentHarnessRuntime> Instances = new Dictionary<string, IAgentHarnessRuntime>();

	private const string ThreadMapPrefix = "ClickyAgentHarnessThreadMap.";

	public static Dictionary<string, Func<IAgentHarnessRuntime>> Factories { get; } = BuildFactories();

	private static Dictionary<string, Func<IAgentHarnessRuntime>> BuildFactories()
	{
		Dictionary<string, Func<IAgentHarnessRuntime>> dictionary = new Dictionary<string, Func<IAgentHarnessRuntime>>();
		AgentHarness[] values = Enum.GetValues<AgentHarness>();
		foreach (AgentHarness harness in values)
		{
			foreach (AgentHarnessPlace place in harness.Places())
			{
				if (harness != AgentHarness.Codex || place != AgentHarnessPlace.Mac)
				{
					dictionary[Key(harness, place)] = () => new AgentHarnessRunnerRuntime(harness, place);
				}
			}
		}
		return dictionary;
	}

	public static string Key(AgentHarness harness, AgentHarnessPlace place)
	{
		return harness.RawValue() + "-" + place.RawValue();
	}

	public static IAgentHarnessRuntime? Runtime(AgentHarness harness, AgentHarnessPlace place)
	{
		string key = Key(harness, place);
		lock (Gate)
		{
			if (Instances.TryGetValue(key, out IAgentHarnessRuntime value))
			{
				return value;
			}
			if (!Factories.TryGetValue(key, out Func<IAgentHarnessRuntime> value2))
			{
				return null;
			}
			value = value2();
			Instances[key] = value;
			return value;
		}
	}

	public static string HarnessThreadId(string appThreadId, AgentHarness harness, AgentHarnessPlace place)
	{
		if (AgentHarnessPreferences.RuntimeChoice(appThreadId).HasValue)
		{
			return appThreadId;
		}
		string key = "ClickyAgentHarnessThreadMap." + Key(harness, place) + "." + appThreadId;
		string text = AgentDefaults.String(key);
		if (text != null)
		{
			return text;
		}
		string text2 = AgentHarnessPreferences.ThreadIdPrefix(harness, place) + Guid.NewGuid().ToString("D").ToLowerInvariant();
		AgentDefaults.Set(key, text2);
		return text2;
	}

	public static bool ContinuesOnNewConversationHarness(string appThreadId)
	{
		if (AgentHarnessPreferences.IsRetiredHarnessThread(appThreadId))
		{
			return false;
		}
		(AgentHarness, AgentHarnessPlace)? tuple = Choice(appThreadId);
		(AgentHarness, AgentHarnessPlace)? tuple2 = Choice(null);
		if (tuple?.Item1 == tuple2?.Item1)
		{
			return tuple?.Item2 == tuple2?.Item2;
		}
		return false;
	}

	public static (AgentHarness Harness, AgentHarnessPlace Place)? Choice(string? appThreadId)
	{
		if (appThreadId != null)
		{
			(AgentHarness, AgentHarnessPlace)? tuple = AgentHarnessPreferences.RuntimeChoice(appThreadId);
			if (tuple.HasValue)
			{
				return tuple.GetValueOrDefault();
			}
			AgentHarness[] values = Enum.GetValues<AgentHarness>();
			foreach (AgentHarness agentHarness in values)
			{
				foreach (AgentHarnessPlace item in agentHarness.Places())
				{
					if ((agentHarness != AgentHarness.Codex || item != AgentHarnessPlace.Mac) && AgentDefaults.String($"{"ClickyAgentHarnessThreadMap."}{agentHarness.RawValue()}-{item.RawValue()}.{appThreadId}") != null)
					{
						return (agentHarness, item);
					}
				}
			}
			return null;
		}
		if (AgentHarnessPreferences.UsesCodexAppServer)
		{
			return null;
		}
		return (AgentHarnessPreferences.Harness, AgentHarnessPreferences.Place);
	}
}
