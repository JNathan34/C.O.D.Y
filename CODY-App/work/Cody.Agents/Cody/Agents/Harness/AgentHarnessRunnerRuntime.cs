using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.Agents.Harness;

public sealed class AgentHarnessRunnerRuntime(AgentHarness harness, AgentHarnessPlace place) : IAgentHarnessRuntime
{
	private static readonly HttpClient Http = new HttpClient(new SocketsHttpHandler
	{
		UseProxy = false,
		PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2L)
	})
	{
		Timeout = Timeout.InfiniteTimeSpan
	};

	public AgentHarness Harness { get; } = harness;

	public AgentHarnessPlace Place { get; } = place;

	public async Task RunTurnAsync(AgentHarnessTurn turn, Action<AgentHarnessEvent> emit, CancellationToken ct)
	{
		AgentHarnessRunnerProcess.Endpoint endpoint = await AgentHarnessRunnerProcess.EnsureRunningAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		string job = turn.HarnessThreadId;
		long cursor = (from e in (((await RequestAsync(endpoint, HttpMethod.Get, "/events?job=" + Escaped(job) + "&after=0&wait=0", null, ct).ConfigureAwait(continueOnCapturedContext: false))["events"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>()
			select Long(e["seq"])).DefaultIfEmpty(0L).Max();
		JsonObject jsonObject = new JsonObject
		{
			["job"] = job,
			["harness"] = Harness.RawValue(),
			["place"] = Place.RawValue(),
			["model"] = turn.Model.RawValue(),
			["workspace"] = turn.Workspace,
			["instructions"] = turn.Context.Instructions,
			["mcp"] = new JsonArray(((IEnumerable<AgentHarnessMcpServer>)turn.Context.McpServers).Select((Func<AgentHarnessMcpServer, JsonNode>)((AgentHarnessMcpServer server) =>
			{
				JsonObject jsonObject2 = new JsonObject
				{
					["name"] = server.Name,
					["url"] = server.Url
				};
				string bearerToken = server.BearerToken;
				if (bearerToken != null)
				{
					jsonObject2["token"] = bearerToken;
				}
				if (server.Headers.Count > 0)
				{
					jsonObject2["headers"] = new JsonObject(server.Headers.Select((KeyValuePair<string, string> h) => KeyValuePair.Create(h.Key, (JsonNode?)h.Value)));
				}
				if (server.SendsTurnIdentity)
				{
					string turnId = turn.TurnId;
					if (turnId != null)
					{
						jsonObject2["meta"] = new JsonObject { ["x-codex-turn-metadata"] = new JsonObject
						{
							["thread_id"] = turn.AppThreadId,
							["turn_id"] = turnId
						} };
					}
				}
				return jsonObject2;
			})).ToArray()),
			["skills"] = new JsonArray(((IEnumerable<string>)turn.Context.SkillDirectories).Select((Func<string, JsonNode>)((string d) => d)).ToArray()),
			["leaseMetadata"] = new JsonObject((turn.LeaseMetadata ?? new Dictionary<string, string>()).Select((KeyValuePair<string, string> kv) => KeyValuePair.Create(kv.Key, (JsonNode?)kv.Value))),
			["deviceHelper"] = AgentHarnessPreferences.UsesDeviceHelper,
			["worker"] = new JsonObject
			{
				["base"] = turn.Context.WorkerBaseUrl,
				["sessionToken"] = turn.Context.SessionToken
			},
			["text"] = turn.Text,
			["images"] = new JsonArray(((IEnumerable<string>)turn.ImagePaths).Select((Func<string, JsonNode>)((string p) => p)).ToArray())
		};
		if (turn.Context.UsesPlanTool)
		{
			jsonObject["planTool"] = true;
		}
		string notePath = turn.Context.NotePath;
		if (notePath != null)
		{
			jsonObject["note"] = new JsonObject
			{
				["path"] = notePath,
				["kept"] = turn.Context.IsKeptThing,
				["tools"] = turn.Context.WritesNoteWithTools
			};
		}
		await RequestAsync(endpoint, HttpMethod.Post, "/turn", jsonObject, ct).ConfigureAwait(continueOnCapturedContext: false);
		while (true)
		{
			foreach (JsonObject item in (((await RequestAsync(endpoint, HttpMethod.Get, $"/events?job={Escaped(job)}&after={cursor}&wait=20000", null, ct).ConfigureAwait(continueOnCapturedContext: false))["events"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
			{
				cursor = Math.Max(cursor, Long(item["seq"]));
				if (Deliver(item, emit))
				{
					return;
				}
			}
		}
	}

	internal static bool Deliver(JsonObject e, Action<AgentHarnessEvent> emit)
	{
		JsonNode? jsonNode = e["text"];
		string text = ((jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String) ? e["text"].ToString() : "");
		switch (e["kind"]?.ToString())
		{
		case "commentary":
			if (text.Trim().Length > 0)
			{
				emit(new AgentHarnessEvent.Commentary(text));
			}
			break;
		case "thinking":
			if (text.Trim().Length > 0)
			{
				emit(new AgentHarnessEvent.Thinking(text));
			}
			break;
		case "plan":
		{
			List<(string, string)> list = (from s in ((e["plan"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>()
				select (Text: s["step"]?.ToString()?.Trim() ?? "", Status: s["status"]?.ToString() ?? "pending") into s
				where s.Text.Length > 0
				select s).ToList();
			if (list.Count > 0)
			{
				emit(new AgentHarnessEvent.Plan(list));
			}
			break;
		}
		case "tool":
		{
			string id = e["id"]?.ToString() ?? Guid.NewGuid().ToString("D");
			string text5 = e["name"]?.ToString() ?? "tool";
			string server = e["server"]?.ToString();
			string command = e["command"]?.ToString();
			bool flag = e["phase"]?.ToString() == "start";
			string text6 = e["url"]?.ToString();
			string text7 = ((text6 != null && text6.Length > 0) ? text6 : null);
			if (text5 == "web_search")
			{
				if (flag)
				{
					emit(new AgentHarnessEvent.WebSearch(id, e["query"]?.ToString() ?? "", text7));
				}
			}
			else if (text5 == "fetch_url" && text7 != null)
			{
				if (flag)
				{
					emit(new AgentHarnessEvent.WebSearch(id, "", text7));
				}
			}
			else if (flag)
			{
				emit(new AgentHarnessEvent.ToolStarted(id, text5, server, command));
			}
			else
			{
				emit(new AgentHarnessEvent.ToolFinished(id, text5, server, command));
			}
			break;
		}
		case "answer":
			if (text.Length > 0)
			{
				emit(new AgentHarnessEvent.AnswerDelta(text));
			}
			break;
		case "stats":
		{
			Dictionary<string, double> dictionary = new Dictionary<string, double>();
			foreach (var (text3, jsonNode3) in e)
			{
				if (text3 != "seq" && jsonNode3 is JsonValue jsonValue && jsonValue.GetValueKind() == JsonValueKind.Number && jsonValue.TryGetValue<double>(out var value))
				{
					dictionary[text3] = value;
				}
			}
			emit(new AgentHarnessEvent.TurnStats(dictionary));
			break;
		}
		case "turn_end":
			emit(new AgentHarnessEvent.Finished(e["status"]?.ToString() ?? "completed", e["error"]?.ToString()));
			return true;
		case "note":
		{
			string text4 = e["path"]?.ToString();
			if (text4 == null)
			{
				break;
			}
			if (e["phase"]?.ToString() == "preview")
			{
				if (text.Length > 0)
				{
					emit(new AgentHarnessEvent.NotePreview(text4, text));
				}
			}
			else
			{
				emit(new AgentHarnessEvent.NoteSaved(text4));
			}
			break;
		}
		case "log":
			Log.Info("Harness", "[harness] " + ((text.Length > 600) ? text.Substring(0, 600) : text));
			break;
		}
		return false;
	}

	public static async Task PrewarmAsync(AgentHarness harness, AgentHarnessPlace place, string workerBaseUrl, string sessionToken)
	{
		_ = 1;
		try
		{
			await RequestAsync(await AgentHarnessRunnerProcess.EnsureRunningAsync().ConfigureAwait(continueOnCapturedContext: false), HttpMethod.Post, "/prewarm", new JsonObject
			{
				["harness"] = harness.RawValue(),
				["place"] = place.RawValue(),
				["deviceHelper"] = AgentHarnessPreferences.UsesDeviceHelper,
				["worker"] = new JsonObject
				{
					["base"] = workerBaseUrl,
					["sessionToken"] = sessionToken
				}
			}, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex)
		{
			Log.Warn("Harness", "prewarm: " + ex.Message);
		}
	}

	public async Task SteerAsync(string harnessThreadId, string text, CancellationToken ct)
	{
		if (!((await RequestAsync(await AgentHarnessRunnerProcess.EnsureRunningAsync(ct).ConfigureAwait(continueOnCapturedContext: false), HttpMethod.Post, "/steer", new JsonObject
		{
			["job"] = harnessThreadId,
			["text"] = text
		}, ct).ConfigureAwait(continueOnCapturedContext: false))["ok"] is JsonValue jsonValue) || !jsonValue.TryGetValue<bool>(out var value) || !value)
		{
			throw new AgentHarnessException(Harness.DisplayName() + " " + Place.DisplayName().ToLowerInvariant() + " can't take a message mid-run; send it when this turn ends.");
		}
	}

	public async Task InterruptAsync(string harnessThreadId)
	{
		_ = 1;
		try
		{
			await RequestAsync(await AgentHarnessRunnerProcess.EnsureRunningAsync().ConfigureAwait(continueOnCapturedContext: false), HttpMethod.Post, "/cancel", new JsonObject { ["job"] = harnessThreadId }, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex)
		{
			Log.Warn("Harness", "cancel " + harnessThreadId + ": " + ex.Message);
		}
	}

	private static string Escaped(string value)
	{
		return Uri.EscapeDataString(value);
	}

	private static long Long(JsonNode? n)
	{
		if (!(n is JsonValue jsonValue) || !jsonValue.TryGetValue<long>(out var value))
		{
			if (!(n is JsonValue jsonValue2) || !jsonValue2.TryGetValue<double>(out var value2))
			{
				return 0L;
			}
			return (long)value2;
		}
		return value;
	}

	private static async Task<JsonObject> RequestAsync(AgentHarnessRunnerProcess.Endpoint endpoint, HttpMethod method, string route, JsonObject? body, CancellationToken ct)
	{
		using HttpRequestMessage request = new HttpRequestMessage(method, $"http://127.0.0.1:{endpoint.Port}{route}");
		request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", endpoint.Token);
		if (body != null)
		{
			request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
		}
		using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
		timeout.CancelAfter(TimeSpan.FromSeconds(60L));
		using HttpResponseMessage response = await Http.SendAsync(request, timeout.Token).ConfigureAwait(continueOnCapturedContext: false);
		string json = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(continueOnCapturedContext: false);
		JsonObject jsonObject;
		try
		{
			jsonObject = (JsonNode.Parse(json) as JsonObject) ?? new JsonObject();
		}
		catch (JsonException)
		{
			jsonObject = new JsonObject();
		}
		if (response.StatusCode != HttpStatusCode.OK)
		{
			throw new AgentHarnessException(jsonObject["error"]?.ToString() ?? $"The agent harness runner answered {(int)response.StatusCode}.");
		}
		return jsonObject;
	}
}
