using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.Agents.Runtime;

internal sealed class CodexRpcClient : IDisposable
{
	private sealed record Pending(string Method, TaskCompletionSource<JsonObject> Completion);

	private readonly Stream stdin;

	private readonly Stream stdout;

	private readonly SemaphoreSlim writeGate = new SemaphoreSlim(1, 1);

	private readonly ConcurrentDictionary<long, Pending> pending = new ConcurrentDictionary<long, Pending>();

	private long nextRequestId;

	private volatile bool closed;

	private Thread? readerThread;

	private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
	{
		WriteIndented = false
	};

	public Func<string, JsonObject?, Task<JsonObject?>>? ServerRequestHandler { get; set; }

	public bool IsClosed => closed;

	public event Action<string, JsonObject?>? Notification;

	public event Action? Closed;

	public CodexRpcClient(Stream stdin, Stream stdout)
	{
		this.stdin = stdin;
		this.stdout = stdout;
	}

	public void StartReading()
	{
		readerThread = new Thread(ReadLoop)
		{
			IsBackground = true,
			Name = "Codex app-server stdout"
		};
		readerThread.Start();
	}

	public async Task<JsonObject> SendRequestAsync(string method, JsonObject? parameters = null, TimeSpan? startupTimeout = null, CancellationToken ct = default(CancellationToken))
	{
		if (closed)
		{
			throw new CodexProcessNotRunningException();
		}
		ct.ThrowIfCancellationRequested();
		long id = Interlocked.Increment(ref nextRequestId);
		TaskCompletionSource<JsonObject> tcs = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
		pending[id] = new Pending(method, tcs);
		Stopwatch started = Stopwatch.StartNew();
		JsonObject jsonObject = new JsonObject
		{
			["id"] = id,
			["method"] = method
		};
		if (parameters != null)
		{
			jsonObject["params"] = parameters;
		}
		if (!(await WriteAsync(jsonObject).ConfigureAwait(continueOnCapturedContext: false)))
		{
			pending.TryRemove(id, out Pending _);
			throw new CodexProcessNotRunningException();
		}
		CancellationTokenSource timeoutCts = null;
		CancellationTokenRegistration reg = default;
		try
		{
			if (startupTimeout.HasValue)
			{
				TimeSpan valueOrDefault = startupTimeout.GetValueOrDefault();
				timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
				timeoutCts.CancelAfter(valueOrDefault);
				reg = timeoutCts.Token.Register(() =>
				{
					if (pending.TryRemove(id, out Pending value2))
					{
						if (ct.IsCancellationRequested)
						{
							value2.Completion.TrySetCanceled(ct);
						}
						else
						{
							Log.Warn("Codex", $"startup RPC timed out method={method} id={id}");
							value2.Completion.TrySetException(new CodexStartupTimeoutException(method));
						}
					}
				});
			}
			return await tcs.Task.ConfigureAwait(continueOnCapturedContext: false);
		}
		finally
		{
			reg.Dispose();
			timeoutCts?.Dispose();
			if (startupTimeout.HasValue)
			{
				Log.Info("Codex", $"startup RPC method={method} id={id} finished ms={started.ElapsedMilliseconds}");
			}
		}
	}

	public Task<bool> SendNotificationAsync(string method, JsonObject? parameters = null)
	{
		JsonObject jsonObject = new JsonObject { ["method"] = method };
		if (parameters != null)
		{
			jsonObject["params"] = parameters;
		}
		return WriteAsync(jsonObject);
	}

	private async Task<bool> WriteAsync(JsonObject message)
	{
		if (closed)
		{
			return false;
		}
		byte[] bytes = Encoding.UTF8.GetBytes(message.ToJsonString(JsonOptions) + "\n");
		if (ShouldLog(message["method"]?.GetValue<string>()))
		{
			Log.Info("Codex", "-> " + Envelope(message, bytes.Length));
		}
		await writeGate.WaitAsync().ConfigureAwait(continueOnCapturedContext: false);
		try
		{
			await stdin.WriteAsync(bytes).ConfigureAwait(continueOnCapturedContext: false);
			await stdin.FlushAsync().ConfigureAwait(continueOnCapturedContext: false);
			return true;
		}
		catch (Exception ex) when ((ex is IOException || ex is ObjectDisposedException) ? true : false)
		{
			Log.Warn("Codex", "stdin write failed (" + ex.Message + "); treating app-server as disconnected");
			HandleClosed();
			return false;
		}
		finally
		{
			writeGate.Release();
		}
	}

	private void ReadLoop()
	{
		try
		{
			using StreamReader streamReader = new StreamReader(stdout, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), detectEncodingFromByteOrderMarks: false, 65536);
			while (true)
			{
				string text = streamReader.ReadLine();
				if (text == null)
				{
					break;
				}
				if (text.Length == 0)
				{
					continue;
				}
				JsonObject jsonObject;
				try
				{
					jsonObject = JsonNode.Parse(text) as JsonObject;
				}
				catch (JsonException)
				{
					Log.Warn("Codex", $"unparseable stdout line ({text.Length} chars)");
					continue;
				}
				if (jsonObject != null)
				{
					try
					{
						Dispatch(jsonObject, text.Length);
					}
					catch (Exception ex2)
					{
						Log.Error("Codex", "dispatch failed", ex2);
					}
				}
			}
			Log.Info("Codex", "stdout EOF; app-server disconnected");
		}
		catch (Exception ex3) when ((ex3 is IOException || ex3 is ObjectDisposedException) ? true : false)
		{
			Log.Warn("Codex", "stdout read ended: " + ex3.Message);
		}
		HandleClosed();
	}

	private void Dispatch(JsonObject json, int byteCount)
	{
		JsonNode jsonNode = json["method"];
		string method = ((jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String) ? jsonNode.GetValue<string>() : null);
		JsonNode jsonNode2 = json["id"];
		if (ShouldLog(method))
		{
			Log.Info("Codex", "<- " + Envelope(json, byteCount));
		}
		if (jsonNode2 != null && method == null)
		{
			if (TryGetLong(jsonNode2, out var value) && pending.TryRemove(value, out Pending value2))
			{
				if (json["error"] is JsonObject jsonObject)
				{
					int num = ((jsonObject["code"] is JsonValue jsonValue && jsonValue.TryGetValue<int>(out var value3)) ? value3 : (-1));
					string text = jsonObject["message"]?.ToString() ?? "Unknown error";
					Log.Warn("Codex", $"error response id={value} method={value2.Method}: [{num}] {text}");
					value2.Completion.TrySetException(new CodexRpcException(num, text, value2.Method));
				}
				else
				{
					value2.Completion.TrySetResult((json["result"] as JsonObject) ?? new JsonObject());
				}
			}
		}
		else
		{
			if (method == null)
			{
				return;
			}
			JsonObject parameters = json["params"] as JsonObject;
			if (jsonNode2 != null)
			{
				JsonNode requestId = jsonNode2.DeepClone();
				Task.Run(async () =>
				{
					JsonObject result = null;
					try
					{
						Func<string, JsonObject, Task<JsonObject>> serverRequestHandler = ServerRequestHandler;
						if (serverRequestHandler != null)
						{
							result = await serverRequestHandler(method, parameters).ConfigureAwait(continueOnCapturedContext: false);
						}
					}
					catch (Exception ex)
					{
						Log.Error("Codex", "server request handler failed for " + method, ex);
					}
					if (result == null)
					{
						Log.Warn("Codex", "no handler response for server request " + method);
						await WriteAsync(new JsonObject
						{
							["id"] = requestId,
							["error"] = new JsonObject
							{
								["code"] = -32601,
								["message"] = "HeyClicky does not handle " + method
							}
						}).ConfigureAwait(continueOnCapturedContext: false);
					}
					else
					{
						await WriteAsync(new JsonObject
						{
							["id"] = requestId,
							["result"] = result
						}).ConfigureAwait(continueOnCapturedContext: false);
					}
				});
			}
			else
			{
				Notification?.Invoke(method, parameters);
			}
		}
	}

	private static bool TryGetLong(JsonNode node, out long value)
	{
		value = 0L;
		if (node is JsonValue jsonValue)
		{
			if (jsonValue.TryGetValue<long>(out var value2))
			{
				value = value2;
				return true;
			}
			if (jsonValue.TryGetValue<int>(out var value3))
			{
				value = value3;
				return true;
			}
			if (jsonValue.TryGetValue<string>(out string value4) && long.TryParse(value4, out value2))
			{
				value = value2;
				return true;
			}
		}
		return false;
	}

	private void HandleClosed()
	{
		if (closed)
		{
			return;
		}
		closed = true;
		foreach (KeyValuePair<long, Pending> item in pending)
		{
			if (pending.TryRemove(item.Key, out Pending value))
			{
				value.Completion.TrySetException(new CodexProcessNotRunningException());
			}
		}
		try
		{
			Closed?.Invoke();
		}
		catch (Exception ex)
		{
			Log.Error("Codex", "Closed handler failed", ex);
		}
	}

	private static bool ShouldLog(string? method)
	{
		if (method != null)
		{
			if (!method.EndsWith("/delta", StringComparison.Ordinal))
			{
				return !method.EndsWith("Delta", StringComparison.Ordinal);
			}
			return false;
		}
		return true;
	}

	private static string Envelope(JsonObject json, int bytes)
	{
		JsonNode jsonNode = json["id"];
		string value = ((jsonNode != null) ? (" id=" + jsonNode.ToJsonString()) : "");
		string value2 = json["method"]?.ToString() ?? ((json["error"] == null) ? "response" : "error");
		return $"{value2}{value} bytes={bytes}";
	}

	public void Dispose()
	{
		HandleClosed();
		try
		{
			stdin.Dispose();
		}
		catch
		{
		}
	}
}
