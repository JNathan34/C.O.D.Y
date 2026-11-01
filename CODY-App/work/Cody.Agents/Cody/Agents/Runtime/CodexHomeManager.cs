using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace HeyClicky.Agents.Runtime;

internal sealed class CodexHomeManager(AgentRuntimeOptions options)
{
	public static readonly string[] BundledSkillNames = new string[2] { "clicky-browser", "vercel-deploy" };

	private static readonly string[] HiddenBundledSkillNames = new string[2] { "nano-banana-slides", "cua-driver" };

	private static readonly string[] BlockedSystemSkillNames = new string[6] { "imagegen", "openai-docs", "plugin-creator", "review-agent", "skill-creator", "skill-installer" };

	private readonly object gate = new object();

	public const string BrowserMcpTokenEnvironmentVariable = "CLICKY_BROWSER_MCP_TOKEN";

	private static readonly string MultipleAccountsRules;

	public string? DeliveredModelInstructions { get; private set; }

	public string CodexHome => options.CodexHome;

	private string LogDirectory => Path.Combine(CodexHome, "log");

	private string SqliteDirectory => Path.Combine(CodexHome, "sqlite");

	private string SkillsDirectory => Path.Combine(CodexHome, "skills");

	private string ConfigPath => Path.Combine(CodexHome, "config.toml");

	private string BundledInstructionsPath => Path.Combine(options.BundledResourcesDirectory, "clicky-model-instructions.md");

	private string BundledCatalogPath => Path.Combine(options.BundledResourcesDirectory, "codex-model-catalog.json");

	private string BundledSkillsDirectory => Path.Combine(options.BundledResourcesDirectory, "skills");

	private string IntegrationSkillsDirectory => Path.Combine(options.BundledResourcesDirectory, "integration-skills");

	public string TaskAssetsDirectory(Guid taskId)
	{
		string text = Path.Combine(CodexHome, "task-assets", taskId.ToString("D"));
		Directory.CreateDirectory(text);
		return text;
	}

	public void PrepareRuntimeConfiguration(string workerBaseUrl, ClientIdentity identity, ComposioMcpConfiguration? composio, bool areConnectedAppsTemporarilyUnreachable, IReadOnlyList<CustomConnectorRegistration> customConnectors, CodexLoopbackMcpEndpoint? browserMcp = null)
	{
		lock (gate)
		{
			Directory.CreateDirectory(CodexHome);
			Directory.CreateDirectory(LogDirectory);
			Directory.CreateDirectory(SqliteDirectory);
			Directory.CreateDirectory(SkillsDirectory);
			Directory.CreateDirectory(options.ProjectsRoot);
			Dictionary<string, string> dictionary = SynchronizeSkills(composio?.Toolkits ?? Array.Empty<string>());
			string text = BuildModelInstructions(composio, areConnectedAppsTemporarilyUnreachable, customConnectors);
			if (text != null)
			{
				WriteIfChanged(Path.Combine(CodexHome, "clicky-model-instructions.md"), text);
			}
			DeliveredModelInstructions = text;
			string text2 = BuildConfigToml(options.ProjectsRoot, workerBaseUrl.TrimEnd('/') + "/agent/openai/v1", IdentityHeaders(identity), text, composio?.Url, customConnectors, dictionary, browserMcp);
			if (WriteIfChanged(ConfigPath, text2))
			{
				IEnumerable<string> values = (from l in text2.Split('\n')
					where l.StartsWith("[mcp_servers.", StringComparison.Ordinal)
					select l).Select((string l) =>
				{
					int length = "[mcp_servers.".Length;
					return l.Substring(length, l.Length - 1 - length);
				});
				Log.Info("Codex", $"config.toml written: developer_instructions={text?.Length ?? 0} chars model_catalog_json={(File.Exists(BundledCatalogPath) ? "on" : "MISSING")} mcp_servers=[{string.Join(',', values)}] skills=[{string.Join(',', dictionary.Keys)}]");
			}
		}
	}

	public static IReadOnlyDictionary<string, string> IdentityHeaders(ClientIdentity identity)
	{
		return new Dictionary<string, string>
		{
			["X-Clicky-Platform"] = (string.IsNullOrWhiteSpace(identity.Platform) ? "windows" : identity.Platform),
			["X-Clicky-Device"] = identity.DeviceId,
			["X-Clicky-App-Version"] = identity.AppVersion,
			["X-Clicky-App-Build"] = identity.AppBuild,
			["X-Clicky-OS-Version"] = identity.OsVersion
		};
	}

	private string BuildConfigToml(string defaultWorkingDirectory, string agentOpenAIProxyBaseUrl, IReadOnlyDictionary<string, string> identityHeaders, string? modelInstructions, string? composioUrl, IReadOnlyList<CustomConnectorRegistration> customConnectors, IReadOnlyDictionary<string, string> skillPaths, CodexLoopbackMcpEndpoint? browserMcp = null)
	{
		List<string> list = new List<string>
		{
			"model = " + TomlString(options.Model),
			"model_reasoning_effort = " + TomlString(options.ReasoningEffort),
			"model_provider = \"clicky\"",
			"preferred_auth_method = \"apikey\"",
			"approval_policy = \"never\"",
			"sandbox_mode = \"danger-full-access\"",
			"personality = \"friendly\"",
			"cli_auth_credentials_store = \"file\"",
			"mcp_oauth_credentials_store = \"file\"",
			"log_dir = " + TomlString(LogDirectory),
			"sqlite_home = " + TomlString(SqliteDirectory),
			"history.persistence = \"save-all\""
		};
		if (modelInstructions != null)
		{
			list.Add("developer_instructions = " + TomlBasicString(modelInstructions));
		}
		if (File.Exists(BundledCatalogPath))
		{
			list.Add("model_catalog_json = " + TomlString(BundledCatalogPath));
			list.Add("include_collaboration_mode_instructions = false");
		}
		list.Add("model_auto_compact_token_limit = " + options.AutoCompactTokenLimit.ToString(CultureInfo.InvariantCulture));
		list.AddRange(new _003C_003Ez__ReadOnlyArray<string>(new string[7]
		{
			"",
			"[model_providers.clicky]",
			"name = \"Clicky\"",
			"base_url = " + TomlString(agentOpenAIProxyBaseUrl),
			"env_key = \"OPENAI_API_KEY\"",
			"wire_api = \"responses\"",
			"http_headers = " + TomlInlineTable(identityHeaders)
		}));
		List<string> list2 = new List<string> { defaultWorkingDirectory };
		string text = options.ObsidianVaultPath?.Trim();
		if (!string.IsNullOrEmpty(text) && !list2.Contains(text, StringComparer.OrdinalIgnoreCase))
		{
			list2.Add(text);
		}
		foreach (string item in list2)
		{
			list.AddRange(new _003C_003Ez__ReadOnlyArray<string>(new string[3]
			{
				"",
				"[projects." + TomlString(item) + "]",
				"trust_level = \"trusted\""
			}));
		}
		list.AddRange(new _003C_003Ez__ReadOnlyArray<string>(new string[13]
		{
			"", "[notice]", "hide_full_access_warning = true", "", "[features]", "apps = true", "fast_mode = false", "goals = false", "multi_agent = true", "",
			"[tools.update_plan]", "enabled = true", ""
		}));
		if (composioUrl != null)
		{
			list.AddRange(new _003C_003Ez__ReadOnlyArray<string>(new string[7]
			{
				"[mcp_servers.composio]",
				"url = " + TomlString(composioUrl),
				"bearer_token_env_var = \"OPENAI_API_KEY\"",
				"http_headers = " + TomlInlineTable(identityHeaders),
				"startup_timeout_sec = 20.0",
				"tool_timeout_sec = 120.0",
				""
			}));
		}
		if ((object)browserMcp != null)
		{
			list.AddRange(new _003C_003Ez__ReadOnlyArray<string>(new string[6]
			{
				"[mcp_servers." + browserMcp.ServerKey + "]",
				"url = " + TomlString(browserMcp.Url),
				"bearer_token_env_var = " + TomlString(browserMcp.BearerTokenEnvironmentVariable),
				"startup_timeout_sec = 20.0",
				"tool_timeout_sec = 900.0",
				""
			}));
		}
		foreach (CustomConnectorRegistration customConnector in customConnectors)
		{
			list.AddRange(CustomConnectorLines(customConnector));
		}
		string[] bundledSkillNames = BundledSkillNames;
		foreach (string key in bundledSkillNames)
		{
			if (skillPaths.TryGetValue(key, out string value))
			{
				list.AddRange(new _003C_003Ez__ReadOnlyArray<string>(new string[4]
				{
					"[[skills.config]]",
					"path = " + TomlString(value),
					"enabled = true",
					""
				}));
			}
		}
		return string.Join("\n", list);
	}

	private static IEnumerable<string> CustomConnectorLines(CustomConnectorRegistration c)
	{
		yield return "[mcp_servers." + c.ServerKey + "]";
		CustomConnectorTransport transport = c.Transport;
		if (!(transport is CustomConnectorTransport.Remote r))
		{
			if (transport is CustomConnectorTransport.Stdio s)
			{
				yield return "command = " + TomlString(s.Command);
				if (s.Arguments.Count > 0)
				{
					yield return "args = " + TomlArray(s.Arguments);
				}
				yield return "env = " + TomlInlineTable(new Dictionary<string, string> { ["PATH"] = s.SearchPath });
				if (s.PassthroughEnvironmentVariables.Count > 0)
				{
					yield return "env_vars = " + TomlArray(s.PassthroughEnvironmentVariables);
				}
			}
		}
		else
		{
			yield return "url = " + TomlString(r.Url);
			string bearerTokenEnvironmentVariable = r.BearerTokenEnvironmentVariable;
			if (bearerTokenEnvironmentVariable != null)
			{
				yield return "bearer_token_env_var = " + TomlString(bearerTokenEnvironmentVariable);
			}
			if (r.HeaderEnvironmentVariables.Count > 0)
			{
				yield return "env_http_headers = " + TomlInlineTable(r.HeaderEnvironmentVariables);
			}
		}
		yield return "startup_timeout_sec = 60.0";
		yield return "tool_timeout_sec = 120.0";
		yield return "";
	}

	private string? BuildModelInstructions(ComposioMcpConfiguration? composio, bool appsUnreachable, IReadOnlyList<CustomConnectorRegistration> customConnectors)
	{
		if (!File.Exists(BundledInstructionsPath))
		{
			return null;
		}
		return WindowsInstructionAdapter.Adapt(File.ReadAllText(BundledInstructionsPath, Encoding.UTF8)) + "\n" + ExternalIntegrationsInstructions(composio, appsUnreachable, customConnectors) + "\n";
	}

	private string ExternalIntegrationsInstructions(ComposioMcpConfiguration? composio, bool appsUnreachable, IReadOnlyList<CustomConnectorRegistration> customConnectors)
	{
		List<string> list = new List<string> { "## Connected apps" };
		if ((object)composio != null)
		{
			string text = ((composio.Toolkits.Count == 0) ? "connected toolkit list unavailable" : string.Join(", ", composio.Toolkits.OrderBy((string t) => t, StringComparer.Ordinal)));
			list.Add("- When this chat started, these apps were connected through the `composio` MCP server: " + text + ". Its tools are the live source of truth, since the list can change later: search them before deciding an app can't do something. Google apps connect separately (gmail, googlesheets, googlecalendar, googledrive, googledocs), so name the specific one when it's missing.");
			list.Add("- If an app the task needs isn't connected, or a call comes back expired or unauthorized, name the app and tell them to connect or reconnect it in HeyClicky Settings -> Integrations. Never run OAuth, sign-in or an auth CLI yourself, and never act on HeyClicky's own settings screen.");
			list.Add("- If Gmail refuses to send, ask them to reconnect Gmail with send permission in HeyClicky Settings -> Integrations.");
			if (composio.MultiAccountLines.Count > 0)
			{
				list.Add("- Apps with more than one connected account:\n" + string.Join("\n", composio.MultiAccountLines.Select((string l) => "  - " + l)) + "\n" + string.Join("\n", from l in MultipleAccountsRules.Split('\n')
					select "  - " + l));
			}
		}
		else if (appsUnreachable)
		{
			list.Add("- Their connected apps couldn't be reached when this chat started (a temporary connection problem; they ARE connected). If `composio` tools are available now, use them. Otherwise, when a task needs their email, calendar, docs or other app data, say the apps couldn't be reached just now and to try again in a moment. Never tell them to connect or reconnect apps for this, and never run OAuth, sign-in or an auth CLI yourself.");
		}
		else
		{
			list.Add("- No apps were connected when this chat started. If `composio` tools are available now, use them for their email, calendar, docs and other app data; otherwise tell them to connect the app in HeyClicky Settings -> Integrations. Never run OAuth, sign-in or an auth CLI yourself.");
		}
		string text2 = options.ObsidianVaultPath?.Trim();
		list.Add((!string.IsNullOrEmpty(text2)) ? ("- Obsidian is their local vault at " + text2 + " (also `$env:OBSIDIAN_VAULT_PATH`): plain Markdown files you read and edit with the shell, keeping frontmatter, [[wikilinks]] and tags intact. Ask before deleting, bulk-moving or renaming notes, or changing its `.obsidian` settings. It is not a Composio app, and it is the only vault root; don't look for notes elsewhere.") : "- Obsidian isn't set up. For Obsidian work, tell them to configure their vault in HeyClicky Settings -> Integrations -> Obsidian.");
		if (customConnectors.Count > 0)
		{
			IEnumerable<string> values = customConnectors.Select((CustomConnectorRegistration c) =>
			{
				string text3 = c.CapabilityDescription.Trim();
				return $"  - {c.DisplayName}: MCP server `{c.ServerKey}` (its tools are prefixed with that name). " + ((text3.Length == 0) ? "the user did not describe it; discover what it does from its tool list" : text3);
			});
			list.Add("- Their own MCP connectors (Settings -> Integrations -> Custom connectors), one server each. Use them directly for tasks in their domain under the same approval rule, and also confirm first before sending messages to other people or changing ad spend:\n" + string.Join("\n", values) + "\n- Their credentials are already configured: never ask for or print a token. If a connector's tools are missing or a call comes back unauthorized, say so and point them to its row in Settings -> Integrations -> Custom connectors (\"Sign in\", or the token under Edit). Don't go looking for it in other tools' configuration or call it over HTTP yourself.");
		}
		return string.Join("\n", list);
	}

	private Dictionary<string, string> SynchronizeSkills(IReadOnlyList<string> connectedToolkits)
	{
		HashSet<string> hashSet = (Directory.Exists(IntegrationSkillsDirectory) ? (from n in Directory.GetDirectories(IntegrationSkillsDirectory).Select(Path.GetFileName)
			where n != null && File.Exists(Path.Combine(IntegrationSkillsDirectory, n, "SKILL.md"))
			select (n)).ToHashSet(StringComparer.Ordinal) : new HashSet<string>());
		HashSet<string> hashSet2 = connectedToolkits.Where(hashSet.Contains).Except(BundledSkillNames).ToHashSet(StringComparer.Ordinal);
		string path = Path.Combine(SkillsDirectory, ".system");
		string[] blockedSystemSkillNames = BlockedSystemSkillNames;
		foreach (string path2 in blockedSystemSkillNames)
		{
			TryDeleteDirectory(Path.Combine(path, path2));
		}
		blockedSystemSkillNames = HiddenBundledSkillNames;
		foreach (string path3 in blockedSystemSkillNames)
		{
			TryDeleteDirectory(Path.Combine(SkillsDirectory, path3));
		}
		HashSet<string> hashSet3 = BundledSkillNames.Concat(hashSet2).ToHashSet(StringComparer.OrdinalIgnoreCase);
		blockedSystemSkillNames = Directory.GetDirectories(SkillsDirectory);
		foreach (string text in blockedSystemSkillNames)
		{
			string fileName = Path.GetFileName(text);
			if (!fileName.StartsWith('.') && !hashSet3.Contains(fileName))
			{
				TryDeleteDirectory(text);
			}
		}
		foreach (string item in hashSet2)
		{
			SyncSkillFolder(Path.Combine(IntegrationSkillsDirectory, item), Path.Combine(SkillsDirectory, item));
		}
		Dictionary<string, string> dictionary = new Dictionary<string, string>(StringComparer.Ordinal);
		blockedSystemSkillNames = BundledSkillNames;
		foreach (string text2 in blockedSystemSkillNames)
		{
			string text3 = Path.Combine(BundledSkillsDirectory, text2);
			if (File.Exists(Path.Combine(text3, "SKILL.md")))
			{
				string text4 = Path.Combine(SkillsDirectory, text2);
				SyncSkillFolder(text3, text4);
				dictionary[text2] = text4;
			}
		}
		return dictionary;
	}

	private static void SyncSkillFolder(string source, string dest)
	{
		string path = Path.Combine(source, "SKILL.md");
		string path2 = Path.Combine(dest, "SKILL.md");
		if (!File.Exists(path2) || !File.ReadAllBytes(path2).AsSpan().SequenceEqual(File.ReadAllBytes(path)))
		{
			TryDeleteDirectory(dest);
			CopyDirectory(source, dest);
		}
	}

	private static void CopyDirectory(string source, string dest)
	{
		Directory.CreateDirectory(dest);
		string[] files = Directory.GetFiles(source);
		foreach (string text in files)
		{
			File.Copy(text, Path.Combine(dest, Path.GetFileName(text)), overwrite: true);
		}
		files = Directory.GetDirectories(source);
		foreach (string text2 in files)
		{
			CopyDirectory(text2, Path.Combine(dest, Path.GetFileName(text2)));
		}
	}

	private static void TryDeleteDirectory(string dir)
	{
		try
		{
			if (Directory.Exists(dir))
			{
				Directory.Delete(dir, recursive: true);
			}
		}
		catch (Exception ex)
		{
			Log.Warn("Codex", "could not remove " + dir + ": " + ex.Message);
		}
	}

	private static bool WriteIfChanged(string path, string contents)
	{
		try
		{
			if (File.Exists(path) && File.ReadAllText(path, Encoding.UTF8) == contents)
			{
				return false;
			}
		}
		catch
		{
		}
		string text = path + ".tmp";
		File.WriteAllText(text, contents, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
		File.Move(text, path, overwrite: true);
		return true;
	}

	internal static string TomlString(string value)
	{
		return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
	}

	internal static string TomlArray(IEnumerable<string> values)
	{
		return "[" + string.Join(", ", values.Select(TomlString)) + "]";
	}

	internal static string TomlInlineTable(IReadOnlyDictionary<string, string> values)
	{
		return "{ " + string.Join(", ", from kv in values.OrderBy((KeyValuePair<string, string> kv) => kv.Key, StringComparer.Ordinal)
			select TomlString(kv.Key) + " = " + TomlString(kv.Value)) + " }";
	}

	internal static string TomlBasicString(string value)
	{
		StringBuilder stringBuilder = new StringBuilder(value.Length + 16).Append('"');
		foreach (Rune item in value.EnumerateRunes())
		{
			int value2 = item.Value;
			if (value2 < 32)
			{
				switch (value2)
				{
				case 10:
					stringBuilder.Append("\\n");
					continue;
				case 13:
					stringBuilder.Append("\\r");
					continue;
				case 9:
					stringBuilder.Append("\\t");
					continue;
				}
			}
			else
			{
				switch (value2)
				{
				case 92:
					stringBuilder.Append("\\\\");
					continue;
				case 34:
					stringBuilder.Append("\\\"");
					continue;
				case 127:
					break;
				default:
					stringBuilder.Append(item.ToString());
					continue;
				}
			}
			stringBuilder.Append("\\u").Append(item.Value.ToString("X4", CultureInfo.InvariantCulture));
		}
		return stringBuilder.Append('"').ToString();
	}

	static CodexHomeManager()
	{
		_003C_003Ey__InlineArray5<string> buffer = default;
		buffer[0] = "Some apps have more than one connected account (for example a work Gmail and a personal Gmail). With more than one, every tool call for that app must name the account: pass the account id (or the account's address) as the tool's `account` field, e.g. COMPOSIO_MULTI_EXECUTE_TOOL tools[].account. A call that names no account fails with a list of the accounts; pick one and retry.";
		buffer[1] = "Reading (search, list, find, summarize): look in EVERY account of that app unless the user named one, and say which account each result came from.";
		buffer[2] = "Replying to or acting on something that already exists (an email thread, an event, a file): use the account it lives in. That is always known, so never ask.";
		buffer[3] = "Creating something new (a new email, event, doc) or sending: use the account the user named, or the one the context makes obvious (they said work or personal, the recipient is on the work account's domain, this Clicky's job is clearly one of them, or its memory already says which). If it is still unclear, ask ONE short question naming the accounts (\"Send this from your work or your personal Gmail?\") and wait. Never guess.";
		buffer[4] = "Once the user tells you which account a job uses, remember it in your notes so you never ask again.";
		MultipleAccountsRules = string.Join("\n", (ReadOnlySpan<string?>)buffer);
	}
}
