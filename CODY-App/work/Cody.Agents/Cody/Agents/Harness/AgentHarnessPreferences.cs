using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Agents.Harness;

public static class AgentHarnessPreferences
{
	public const string HarnessKey = "ClickyAgentHarness";

	public const string PlaceKey = "ClickyAgentHarnessPlace";

	public const string ModelKey = "ClickyAgentHarnessModel";

	public const string DeviceHelperOffKey = "ClickyAgentHarnessDeviceHelperOff";

	public const string NoteToolsOffKey = "ClickyAgentHarnessNoteToolsOff";

	public const AgentHarness DefaultHarness = AgentHarness.H1;

	public const string H1DefaultAdoptedKey = "ClickyAgentHarnessH1DefaultAdopted.v1";

	public const string ServerDefaultHarnessKey = "ClickyAgentHarnessServerDefault";

	private static AgentHarness? ServerDefaultHarness => AgentHarnessNames.ParseHarness(AgentDefaults.String("ClickyAgentHarnessServerDefault"));

	private static AgentHarness? StoredHarness
	{
		get
		{
			AdoptH1DefaultOnce();
			return AgentHarnessNames.ParseHarness(AgentDefaults.String("ClickyAgentHarness"));
		}
	}

	public static AgentHarness Harness => StoredHarness ?? ServerDefaultHarness ?? AgentHarness.H1;

	public static AgentHarnessPlace Place
	{
		get
		{
			if (!StoredHarness.HasValue)
			{
				return AgentHarnessPlace.Mac;
			}
			AgentHarnessPlace valueOrDefault = AgentHarnessNames.ParsePlace(AgentDefaults.String("ClickyAgentHarnessPlace")).GetValueOrDefault();
			IReadOnlyList<AgentHarnessPlace> readOnlyList = Harness.Places();
			if (!readOnlyList.Contains(valueOrDefault))
			{
				if (readOnlyList.Count <= 0)
				{
					return AgentHarnessPlace.Mac;
				}
				return readOnlyList[0];
			}
			return valueOrDefault;
		}
	}

	public static AgentHarnessModel Model => AgentHarnessNames.ParseModel(AgentDefaults.String("ClickyAgentHarnessModel"));

	public static bool UsesDeviceHelper => !AgentDefaults.Bool("ClickyAgentHarnessDeviceHelperOff");

	public static bool UsesCodexAppServer
	{
		get
		{
			if (Harness == AgentHarness.Codex)
			{
				return Place == AgentHarnessPlace.Mac;
			}
			return false;
		}
	}

	public static void SaveServerDefaultHarness(string? rawValue)
	{
		string text = rawValue?.Trim().ToLowerInvariant();
		if ((text == "codex" || text == "h1") ? true : false)
		{
			AgentDefaults.Set("ClickyAgentHarnessServerDefault", text);
		}
		else
		{
			AgentDefaults.Remove("ClickyAgentHarnessServerDefault");
		}
	}

	private static void AdoptH1DefaultOnce()
	{
		if (!AgentDefaults.Bool("ClickyAgentHarnessH1DefaultAdopted.v1"))
		{
			AgentDefaults.Set("ClickyAgentHarnessH1DefaultAdopted.v1", value: true);
			AgentHarnessPlace valueOrDefault = AgentHarnessNames.ParsePlace(AgentDefaults.String("ClickyAgentHarnessPlace")).GetValueOrDefault();
			if (AgentDefaults.String("ClickyAgentHarness") == "codex" && valueOrDefault == AgentHarnessPlace.Mac)
			{
				AgentDefaults.Remove("ClickyAgentHarness");
				AgentDefaults.Remove("ClickyAgentHarnessPlace");
			}
		}
	}

	public static void Pick(AgentHarness harness, AgentHarnessPlace place = AgentHarnessPlace.Mac)
	{
		AdoptH1DefaultOnce();
		AgentDefaults.Set("ClickyAgentHarness", harness.RawValue());
		AgentDefaults.Set("ClickyAgentHarnessPlace", place.RawValue());
	}

	public static bool UsesNoteTools(AgentHarness harness, AgentHarnessPlace place)
	{
		if (harness == AgentHarness.H1 && place == AgentHarnessPlace.Mac)
		{
			return !AgentDefaults.Bool("ClickyAgentHarnessNoteToolsOff");
		}
		return false;
	}

	public static string ThreadIdPrefix(AgentHarness harness, AgentHarnessPlace place)
	{
		return $"harness-{harness.RawValue()}-{place.RawValue()}-";
	}

	public static bool IsRetiredHarnessThread(string threadId)
	{
		if (IsHarnessThread(threadId))
		{
			return !RuntimeChoice(threadId).HasValue;
		}
		return false;
	}

	public static bool IsHarnessThread(string? threadId)
	{
		return threadId?.StartsWith("harness-", StringComparison.Ordinal) ?? false;
	}

	public static (AgentHarness Harness, AgentHarnessPlace Place)? RuntimeChoice(string threadId)
	{
		if (!threadId.StartsWith("harness-", StringComparison.Ordinal))
		{
			return null;
		}
		string[] array = threadId.Split('-', 4);
		if (array.Length < 3)
		{
			return null;
		}
		AgentHarness? agentHarness = AgentHarnessNames.ParseHarness(array[1]);
		AgentHarnessPlace? agentHarnessPlace = AgentHarnessNames.ParsePlace(array[2]);
		if (agentHarness.HasValue)
		{
			AgentHarness valueOrDefault = agentHarness.GetValueOrDefault();
			if (agentHarnessPlace.HasValue)
			{
				AgentHarnessPlace valueOrDefault2 = agentHarnessPlace.GetValueOrDefault();
				return (valueOrDefault, valueOrDefault2);
			}
		}
		return null;
	}
}
