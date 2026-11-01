using System;
using System.Buffers;
using System.Buffers.Text;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Billing;
using HeyClicky.Core.Net;
using HeyClicky.Core.Onboarding;
using HeyClicky.Core.Telemetry;
using HeyClicky.Core.Worker;

namespace HeyClicky.Core.Voice;

public sealed class RealtimeMouth : IAsyncDisposable
{
	private sealed class Rendering
	{
		public readonly MemoryStream Pcm = new MemoryStream();

		public readonly TaskCompletionSource<byte[]?> Done = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
	}

	private const string Area = "Mouth";

	public const string DefaultMouthModel = "gpt-realtime-2.1-mini";

	private const double SeamSilenceSeconds = 0.35;

	private static readonly string[] ClientCapabilities = new string[13]
	{
		"spotify_search", "clipboard_copy", "realtime_model_from_mint", "save_memory", "insert_text", "capture_screen", "agent_dashboard", "clicky_memory", "clicky_artifacts", "agent_routines",
		"agent_requests", "onboarding_interview_skip", "one_brain_mouth"
	};

	private const string VerbatimNarrationInstructions = "# Role and Objective\nYou are the voice of Clicky, a friendly companion who draws on the user's screen while explaining. Your only job is to read the given narration line aloud.\n\n# Rules\n- Say exactly the text of the line, word for word, and nothing else.\n- No preamble, no greeting, no filler, no follow-up question.\n- Speak warmly and naturally, at a steady, unhurried pace.\n\nThe user message is a JSON tool result. Output exactly `response_text` and nothing else.";

	private readonly ClickyHttp http;

	private readonly Func<bool, CancellationToken, Task<string?>> accessToken;

	private readonly IAudioOutput audio;

	private readonly Func<MouthConfig> config;

	private readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

	private readonly object gate = new object();

	private readonly Queue<(string Text, int LineIndex)> queuedLines = new Queue<(string, int)>();

	private readonly byte[] seamSilence;

	private ClientWebSocket? socket;

	private CancellationTokenSource? socketLifetime;

	private Task<bool>? openingTask;

	private bool responseInFlight;

	private int currentLineIndex = -1;

	private bool currentResponseHadAudio;

	private long currentResponseAudioBytes;

	private bool suppressAudioUntilNextResponse;

	private double enqueuedSecondsSinceFlush;

	private int completedResponses;

	private long lastServerMessageTicks;

	private static int hasOpenedASessionThisProcess;

	private byte[] decodeBuffer = ArrayPool<byte>.Shared.Rent(65536);

	public static readonly TimeSpan IdleTeardown = TimeSpan.FromMinutes(20L);

	private CancellationTokenSource? idleTeardown;

	private readonly Dictionary<int, Rendering> renderings = new Dictionary<int, Rendering>();

	private long lineSentTicks;

	public string? Model { get; private set; }

	public bool IsOpen
	{
		get
		{
			ClientWebSocket? clientWebSocket = socket;
			if (clientWebSocket == null)
			{
				return false;
			}
			return clientWebSocket.State == WebSocketState.Open;
		}
	}

	public long LastServerMessageTicks => Interlocked.Read(in lastServerMessageTicks);

	public int CompletedResponses
	{
		get
		{
			lock (gate)
			{
				return completedResponses;
			}
		}
	}

	public double EnqueuedSecondsSinceFlush
	{
		get
		{
			lock (gate)
			{
				return enqueuedSecondsSinceFlush;
			}
		}
	}

	public bool IsResponseInFlight
	{
		get
		{
			lock (gate)
			{
				return responseInFlight || queuedLines.Count > 0;
			}
		}
	}

	public (int MintMs, int ConnectMs) LastOpenTimings { get; private set; }

	public Exception? LastOpenFailure { get; private set; }

	public Func<bool> IsAtRest { get; set; } = () => true;

	public Func<bool> KeepWarm { get; set; } = () => false;

	public TimeSpan IdleTeardownWindow { get; set; } = IdleTeardown;

	public event Action<int, double>? LineAudioQueued;

	public event LineAudioChunkHandler? LineAudioChunk;

	public event Action<int, double>? LineGenerated;

	public event Action<string>? Closed;

	public RealtimeMouth(ClickyHttp http, Func<bool, CancellationToken, Task<string?>> accessToken, IAudioOutput audio, Func<MouthConfig> config)
	{
		this.http = http;
		this.accessToken = accessToken;
		this.audio = audio;
		this.config = config;
		seamSilence = new byte[(int)(0.35 * (double)Math.Max(8000, audio.SampleRate)) * 2];
	}

	private void ArmIdleTeardown()
	{
		TimeSpan window = IdleTeardownWindow;
		CancellationTokenSource cts = new CancellationTokenSource();
		Interlocked.Exchange(ref idleTeardown, cts)?.Cancel();
		Task.Run(async () =>
		{
			try
			{
				await Task.Delay(window, cts.Token).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (OperationCanceledException)
			{
				return;
			}
			if (Volatile.Read(in idleTeardown) == cts && !IsResponseInFlight && IsOpen)
			{
				bool flag;
				try
				{
					flag = KeepWarm() || !IsAtRest();
				}
				catch
				{
					flag = false;
				}
				if (flag)
				{
					Log.Info("Mouth", "idle deadline hit but HeyClicky is busy or a Clicky is working: staying warm");
					ArmIdleTeardown();
				}
				else
				{
					Log.Info("Mouth", $"idle for {window.TotalSeconds:0} s: closing the mouth (the next turn opens a new one)");
					await CloseSocketAsync("idle").ConfigureAwait(continueOnCapturedContext: false);
				}
			}
		});
	}

	private void CancelIdleTeardown()
	{
		Interlocked.Exchange(ref idleTeardown, null)?.Cancel();
	}

	public Task<bool> EnsureOpenAsync(CancellationToken ct = default(CancellationToken))
	{
		lock (gate)
		{
			ClientWebSocket? clientWebSocket = socket;
			if (clientWebSocket != null && clientWebSocket.State == WebSocketState.Open)
			{
				return Task.FromResult(result: true);
			}
			Task<bool> task = openingTask;
			if (task != null && !task.IsCompleted)
			{
				return openingTask;
			}
			openingTask = OpenAsync(ct);
			return openingTask;
		}
	}

	public async Task RefreshAfterConfigChangeAsync(CancellationToken ct = default(CancellationToken))
	{
		int waited = 0;
		while (IsResponseInFlight && waited < 120)
		{
			await Task.Delay(500, ct).ConfigureAwait(continueOnCapturedContext: false);
			waited++;
		}
		bool flag;
		lock (gate)
		{
			ClientWebSocket? clientWebSocket = socket;
			int num;
			if (clientWebSocket == null || clientWebSocket.State != WebSocketState.Open)
			{
				Task<bool> task = openingTask;
				num = ((task != null && !task.IsCompleted) ? 1 : 0);
			}
			else
			{
				num = 1;
			}
			flag = (byte)num != 0;
		}
		if (flag)
		{
			MouthConfig mouthConfig = config();
			Log.Info("Mouth", $"voice settings changed ({mouthConfig.VoiceIdentifier}, {mouthConfig.Speed:0.##}x): reopening the mouth");
			await ReplaceAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		}
	}

	public async Task<bool> ReplaceAsync(CancellationToken ct = default(CancellationToken))
	{
		await CloseSocketAsync("replaced").ConfigureAwait(continueOnCapturedContext: false);
		return await EnsureOpenAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
	}

	private async Task<bool> OpenAsync(CancellationToken ct)
	{
		await Task.Yield();
		long started = Environment.TickCount64;
		try
		{
			(string Secret, string Model)? minted = await MintAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
			if (!minted.HasValue)
			{
				return false;
			}
			int mintMs = (int)(Environment.TickCount64 - started);
			ClientWebSocket ws = new ClientWebSocket();
			ws.Options.SetRequestHeader("Authorization", "Bearer " + minted.Value.Secret);
			ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20L);
			long connectStarted = Environment.TickCount64;
			using (CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
			{
				timeout.CancelAfter(TimeSpan.FromSeconds(10L));
				try
				{
					await ws.ConnectAsync(new Uri("wss://api.openai.com/v1/realtime?model=" + Uri.EscapeDataString(minted.Value.Model)), http.Invoker, timeout.Token).ConfigureAwait(continueOnCapturedContext: false);
				}
				catch (Exception inner) when (!ct.IsCancellationRequested)
				{
					ws.Dispose();
					throw new RealtimeSocketOpenException(inner);
				}
			}
			LastOpenTimings = (MintMs: mintMs, ConnectMs: (int)(Environment.TickCount64 - connectStarted));
			CancellationTokenSource cancellationTokenSource = new CancellationTokenSource();
			lock (gate)
			{
				socket = ws;
				socketLifetime = cancellationTokenSource;
				Model = minted.Value.Model;
				responseInFlight = false;
				queuedLines.Clear();
			}
			Interlocked.Exchange(ref lastServerMessageTicks, Environment.TickCount64);
			ReceiveLoopAsync(ws, cancellationTokenSource.Token);
			await SendAsync("{\"type\":\"session.update\",\"session\":{\"type\":\"realtime\",\"audio\":{\"input\":{\"turn_detection\":null}}}}"u8.ToArray(), ct).ConfigureAwait(continueOnCapturedContext: false);
			Log.Info("Mouth", $"mouth open on {minted.Value.Model} (mint {mintMs} ms, connect {LastOpenTimings.ConnectMs} ms)");
			ClickyAnalytics.TrackRealtimeSessionOpened(mintMs, LastOpenTimings.ConnectMs, (int)(Environment.TickCount64 - started), Interlocked.Exchange(ref hasOpenedASessionThisProcess, 1) == 0);
			LastOpenFailure = null;
			ArmIdleTeardown();
			return true;
		}
		catch (Exception ex) when (!(ex is PaywallReachedException))
		{
			Log.Warn("Mouth", "mouth did not open: " + ex.Message);
			if (!ct.IsCancellationRequested)
			{
				LastOpenFailure = ex;
			}
			return false;
		}
		catch (PaywallReachedException)
		{
			return false;
		}
	}

	private async Task<(string Secret, string Model)?> MintAsync(CancellationToken ct)
	{
		MouthConfig mouth = config();
		string timeZone = (TimeZoneInfo.TryConvertWindowsIdToIanaId(TimeZoneInfo.Local.Id, out string ianaId) ? ianaId : TimeZoneInfo.Local.Id);
		RealtimeSessionRequest value = new RealtimeSessionRequest(mouth.VoiceIdentifier, mouth.Speed, new RealtimeSessionPromptContext(Array.Empty<string>(), Array.Empty<string>(), 0, timeZone, DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:sszzz"), OnboardingCatalog.VoiceGender(mouth.VoiceIdentifier), Array.Empty<JsonElement>()), ClientCapabilities);
		byte[] body = JsonSerializer.SerializeToUtf8Bytes(value, CoreJsonContext.Default.RealtimeSessionRequest);
		for (int attempt = 0; attempt < 2; attempt++)
		{
			string text = await accessToken(attempt > 0, ct).ConfigureAwait(continueOnCapturedContext: false);
			if (text == null)
			{
				return null;
			}
			using HttpRequestMessage message = new HttpRequestMessage(HttpMethod.Post, http.WorkerUrl("/agent/realtime/session"));
			message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", text);
			message.Headers.TryAddWithoutValidation("X-Clicky-Usage-Context", mouth.UsageContext);
			message.Content = new ByteArrayContent(body);
			message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
			using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
			timeout.CancelAfter(TimeSpan.FromSeconds(15L));
			using HttpResponseMessage response = await http.Client.SendAsync(message, timeout.Token).ConfigureAwait(continueOnCapturedContext: false);
			byte[] array = await response.Content.ReadAsByteArrayAsync(timeout.Token).ConfigureAwait(continueOnCapturedContext: false);
			int statusCode = (int)response.StatusCode;
			if (statusCode == 401 && attempt == 0)
			{
				continue;
			}
			if (BillingPaywallDetector.HandleIfPaywall(statusCode, array, presentsPaywall: false, out PaywallPayload payload, out JsonElement raw))
			{
				throw new PaywallReachedException(payload, raw);
			}
			if ((statusCode < 200 || statusCode >= 300) ? true : false)
			{
				throw new WorkerHttpException(statusCode, Encoding.UTF8.GetString(array), "/agent/realtime/session");
			}
			return ParseMint(array);
		}
		return null;
	}

	internal static (string Secret, string Model)? ParseMint(ReadOnlySpan<byte> body)
	{
		using JsonDocument jsonDocument = JsonDocument.Parse(body.ToArray());
		JsonElement rootElement = jsonDocument.RootElement;
		string text = null;
		if (rootElement.TryGetProperty("client_secret", out var value) && value.ValueKind == JsonValueKind.Object && value.TryGetProperty("value", out var value2) && value2.ValueKind == JsonValueKind.String)
		{
			text = value2.GetString();
		}
		if (text == null && rootElement.TryGetProperty("value", out var value3) && value3.ValueKind == JsonValueKind.String)
		{
			text = value3.GetString();
		}
		if (string.IsNullOrEmpty(text))
		{
			throw new InvalidDataException("the realtime mint returned no client secret");
		}
		string text2 = null;
		if (rootElement.TryGetProperty("session", out var value4) && value4.ValueKind == JsonValueKind.Object && value4.TryGetProperty("model", out var value5) && value5.ValueKind == JsonValueKind.String)
		{
			text2 = value5.GetString();
		}
		if (string.IsNullOrEmpty(text2) && rootElement.TryGetProperty("model", out var value6) && value6.ValueKind == JsonValueKind.String)
		{
			text2 = value6.GetString();
		}
		return (text, string.IsNullOrEmpty(text2) ? "gpt-realtime-2.1-mini" : text2);
	}

	public void SpeakLine(string line, int lineIndex)
	{
		string text = line.Trim();
		if (text.Length == 0)
		{
			return;
		}
		CancelIdleTeardown();
		lock (gate)
		{
			if (responseInFlight)
			{
				queuedLines.Enqueue((text, lineIndex));
				return;
			}
			responseInFlight = true;
			currentLineIndex = lineIndex;
		}
		SendLineAsync(text, lineIndex);
	}

	private async Task SendLineAsync(string line, int lineIndex)
	{
		try
		{
			Interlocked.Exchange(ref lineSentTicks, Environment.TickCount64);
			await SendAsync(BuildVerbatimResponseCreate(line, lineIndex), CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex)
		{
			Log.Warn("Mouth", $"line {lineIndex} not sent: {ex.Message}");
			Rendering value;
			lock (gate)
			{
				responseInFlight = false;
				renderings.Remove(lineIndex, out value);
			}
			value?.Done.TrySetResult(null);
			LineGenerated?.Invoke(lineIndex, 0.0);
		}
	}

	public static byte[] BuildVerbatimResponseCreate(string line, int lineIndex)
	{
		ArrayBufferWriter<byte> arrayBufferWriter = new ArrayBufferWriter<byte>(line.Length + 64);
		using (Utf8JsonWriter utf8JsonWriter = new Utf8JsonWriter(arrayBufferWriter))
		{
			utf8JsonWriter.WriteStartObject();
			utf8JsonWriter.WriteString("response_text", line);
			utf8JsonWriter.WriteBoolean("require_repeat_verbatim", value: true);
			utf8JsonWriter.WriteEndObject();
		}
		ArrayBufferWriter<byte> arrayBufferWriter2 = new ArrayBufferWriter<byte>(1024 + line.Length * 2);
		using (Utf8JsonWriter utf8JsonWriter2 = new Utf8JsonWriter(arrayBufferWriter2))
		{
			utf8JsonWriter2.WriteStartObject();
			utf8JsonWriter2.WriteString("type", "response.create");
			utf8JsonWriter2.WriteStartObject("response");
			utf8JsonWriter2.WriteString("conversation", "none");
			utf8JsonWriter2.WriteStartArray("output_modalities");
			utf8JsonWriter2.WriteStringValue("audio");
			utf8JsonWriter2.WriteEndArray();
			utf8JsonWriter2.WriteString("instructions", "# Role and Objective\nYou are the voice of Clicky, a friendly companion who draws on the user's screen while explaining. Your only job is to read the given narration line aloud.\n\n# Rules\n- Say exactly the text of the line, word for word, and nothing else.\n- No preamble, no greeting, no filler, no follow-up question.\n- Speak warmly and naturally, at a steady, unhurried pace.\n\nThe user message is a JSON tool result. Output exactly `response_text` and nothing else.");
			utf8JsonWriter2.WriteStartArray("input");
			utf8JsonWriter2.WriteStartObject();
			utf8JsonWriter2.WriteString("type", "message");
			utf8JsonWriter2.WriteString("role", "user");
			utf8JsonWriter2.WriteStartArray("content");
			utf8JsonWriter2.WriteStartObject();
			utf8JsonWriter2.WriteString("type", "input_text");
			utf8JsonWriter2.WriteString("text", Encoding.UTF8.GetString(arrayBufferWriter.WrittenSpan));
			utf8JsonWriter2.WriteEndObject();
			utf8JsonWriter2.WriteEndArray();
			utf8JsonWriter2.WriteEndObject();
			utf8JsonWriter2.WriteEndArray();
			utf8JsonWriter2.WriteStartObject("metadata");
			utf8JsonWriter2.WriteString("clicky_line", lineIndex.ToString());
			utf8JsonWriter2.WriteEndObject();
			utf8JsonWriter2.WriteEndObject();
			utf8JsonWriter2.WriteEndObject();
		}
		return arrayBufferWriter2.WrittenSpan.ToArray();
	}

	public async Task<byte[]?> RenderLineAsync(string line, int lineIndex, CancellationToken ct)
	{
		Task<byte[]> task = BeginRendering(lineIndex);
		SpeakLine(line, lineIndex);
		using (ct.Register(() =>
		{
			EndRendering(lineIndex);
		}))
		{
			return await task.ConfigureAwait(continueOnCapturedContext: false);
		}
	}

	internal Task<byte[]?> BeginRendering(int lineIndex)
	{
		Rendering rendering = new Rendering();
		lock (gate)
		{
			renderings[lineIndex] = rendering;
		}
		return rendering.Done.Task;
	}

	private void EndRendering(int lineIndex)
	{
		Rendering value;
		lock (gate)
		{
			renderings.Remove(lineIndex, out value);
		}
		value?.Done.TrySetResult(null);
	}

	public bool PlayRenderedLine(byte[] pcm, int lineIndex)
	{
		if (pcm.Length == 0)
		{
			return false;
		}
		double num = (double)pcm.Length / 2.0 / (double)audio.SampleRate;
		double arg;
		lock (gate)
		{
			if (responseInFlight || queuedLines.Count > 0)
			{
				return false;
			}
			if (audio.Buffered > TimeSpan.Zero && enqueuedSecondsSinceFlush > 0.0)
			{
				audio.Enqueue(seamSilence);
				enqueuedSecondsSinceFlush += (double)seamSilence.Length / 2.0 / (double)audio.SampleRate;
			}
			arg = enqueuedSecondsSinceFlush;
			audio.Enqueue(pcm);
			enqueuedSecondsSinceFlush += num;
		}
		Log.Info("Mouth", $"line {lineIndex}: played from a rendering ({num:0.0} s, no generation wait)");
		LineAudioQueued?.Invoke(lineIndex, arg);
		LineGenerated?.Invoke(lineIndex, num);
		return true;
	}

	private void AbandonRenderingsLocked(List<Rendering> abandoned)
	{
		abandoned.AddRange(renderings.Values);
		renderings.Clear();
	}

	public void Interrupt()
	{
		List<Rendering> list = new List<Rendering>();
		bool cancel;
		lock (gate)
		{
			AbandonRenderingsLocked(list);
			cancel = responseInFlight;
			queuedLines.Clear();
			suppressAudioUntilNextResponse = cancel;
			responseInFlight = false;
			enqueuedSecondsSinceFlush = 0.0;
		}
		foreach (Rendering item in list)
		{
			item.Done.TrySetResult(null);
		}
		audio.Flush();
		if (!IsOpen)
		{
			return;
		}
		Task.Run(async () =>
		{
			_ = 1;
			try
			{
				if (cancel)
				{
					await SendAsync("{\"type\":\"response.cancel\"}"u8.ToArray(), CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
				}
				await SendAsync("{\"type\":\"input_audio_buffer.clear\"}"u8.ToArray(), CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch
			{
			}
		});
	}

	private async Task SendAsync(byte[] payload, CancellationToken ct)
	{
		ClientWebSocket ws = socket;
		if (ws == null || ws.State != WebSocketState.Open)
		{
			throw new InvalidOperationException("the mouth is not open");
		}
		await sendLock.WaitAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		try
		{
			await ws.SendAsync(payload, WebSocketMessageType.Text, endOfMessage: true, ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		finally
		{
			sendLock.Release();
		}
	}

	private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken ct)
	{
		byte[] buffer = ArrayPool<byte>.Shared.Rent(262144);
		int length = 0;
		string reason = "closed";
		try
		{
			while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
			{
				if (length == buffer.Length)
				{
					byte[] array = ArrayPool<byte>.Shared.Rent(buffer.Length * 2);
					buffer.AsSpan(0, length).CopyTo(array);
					ArrayPool<byte>.Shared.Return(buffer);
					buffer = array;
				}
				ValueWebSocketReceiveResult valueWebSocketReceiveResult = await ws.ReceiveAsync(buffer.AsMemory(length), ct).ConfigureAwait(continueOnCapturedContext: false);
				if (valueWebSocketReceiveResult.MessageType == WebSocketMessageType.Close)
				{
					reason = $"server closed ({ws.CloseStatus} {ws.CloseStatusDescription})";
					break;
				}
				length += valueWebSocketReceiveResult.Count;
				if (valueWebSocketReceiveResult.EndOfMessage)
				{
					Interlocked.Exchange(ref lastServerMessageTicks, Environment.TickCount64);
					HandleServerEvent(buffer.AsSpan(0, length));
					length = 0;
				}
			}
		}
		catch (Exception ex) when ((ex is OperationCanceledException || ex is WebSocketException || ex is ObjectDisposedException) ? true : false)
		{
			reason = ex.Message;
		}
		finally
		{
			ArrayPool<byte>.Shared.Return(buffer);
			int? num = null;
			List<Rendering> list = new List<Rendering>();
			lock (gate)
			{
				if (socket == ws)
				{
					socket = null;
					if (responseInFlight)
					{
						num = currentLineIndex;
					}
					responseInFlight = false;
					queuedLines.Clear();
					AbandonRenderingsLocked(list);
				}
			}
			foreach (Rendering item in list)
			{
				item.Done.TrySetResult(null);
			}
			if (num.HasValue)
			{
				int valueOrDefault = num.GetValueOrDefault();
				LineGenerated?.Invoke(valueOrDefault, 0.0);
			}
			if (!ct.IsCancellationRequested)
			{
				Log.Info("Mouth", "mouth session ended: " + reason);
			}
			Closed?.Invoke(reason);
		}
	}

	internal void HandleServerEvent(ReadOnlySpan<byte> json)
	{
		Utf8JsonReader reader = new Utf8JsonReader(json);
		if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
		{
			return;
		}
		bool flag = false;
		bool flag2 = false;
		while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
		{
			if (reader.ValueTextEquals("type"u8))
			{
				reader.Read();
				flag2 = true;
				flag = reader.ValueTextEquals("response.output_audio.delta"u8) || reader.ValueTextEquals("response.audio.delta"u8);
				if (!flag)
				{
					break;
				}
				continue;
			}
			if (reader.ValueTextEquals("delta"u8) & flag)
			{
				reader.Read();
				HandleAudioDelta(ref reader);
				return;
			}
			reader.Read();
			reader.Skip();
		}
		if (!(!flag2 | flag))
		{
			HandleControlEvent(json);
		}
	}

	private void HandleAudioDelta(ref Utf8JsonReader reader)
	{
		if (reader.TokenType != JsonTokenType.String)
		{
			return;
		}
		ReadOnlySpan<byte> utf = (reader.HasValueSequence ? ((ReadOnlySpan<byte>)reader.ValueSequence.ToArray<byte>()) : reader.ValueSpan);
		if (reader.ValueIsEscaped)
		{
			utf = Encoding.UTF8.GetBytes(reader.GetString() ?? "");
		}
		int maxDecodedFromUtf8Length = Base64.GetMaxDecodedFromUtf8Length(utf.Length);
		if (maxDecodedFromUtf8Length > decodeBuffer.Length)
		{
			ArrayPool<byte>.Shared.Return(decodeBuffer);
			decodeBuffer = ArrayPool<byte>.Shared.Rent(maxDecodedFromUtf8Length);
		}
		if (Base64.DecodeFromUtf8(utf, decodeBuffer, out var _, out var bytesWritten) != OperationStatus.Done || bytesWritten == 0)
		{
			return;
		}
		double arg = 0.0;
		bool flag;
		int num;
		lock (gate)
		{
			if (suppressAudioUntilNextResponse)
			{
				return;
			}
			if (renderings.TryGetValue(currentLineIndex, out Rendering value))
			{
				value.Pcm.Write(decodeBuffer, 0, bytesWritten);
				currentResponseAudioBytes += bytesWritten;
				return;
			}
			flag = !currentResponseHadAudio;
			currentResponseHadAudio = true;
			currentResponseAudioBytes += bytesWritten;
			num = currentLineIndex;
			if (flag)
			{
				if (audio.Buffered > TimeSpan.Zero && enqueuedSecondsSinceFlush > 0.0)
				{
					audio.Enqueue(seamSilence);
					enqueuedSecondsSinceFlush += (double)seamSilence.Length / 2.0 / (double)audio.SampleRate;
				}
				arg = enqueuedSecondsSinceFlush;
			}
			audio.Enqueue(decodeBuffer.AsSpan(0, bytesWritten));
			enqueuedSecondsSinceFlush += (double)bytesWritten / 2.0 / (double)audio.SampleRate;
		}
		LineAudioChunk?.Invoke(num, decodeBuffer.AsSpan(0, bytesWritten));
		if (flag)
		{
			Log.Info("Mouth", $"line {num}: first audio {Environment.TickCount64 - Interlocked.Read(in lineSentTicks)} ms after response.create");
			LineAudioQueued?.Invoke(num, arg);
		}
	}

	private void HandleControlEvent(ReadOnlySpan<byte> json)
	{
		using JsonDocument jsonDocument = JsonDocument.Parse(json.ToArray());
		JsonElement rootElement = jsonDocument.RootElement;
		string text = rootElement.GetProperty("type").GetString();
		switch (text)
		{
		case "response.created":
			lock (gate)
			{
				suppressAudioUntilNextResponse = false;
				currentResponseHadAudio = false;
				currentResponseAudioBytes = 0L;
				if (rootElement.TryGetProperty("response", out var value3) && value3.TryGetProperty("metadata", out var value4) && value4.ValueKind == JsonValueKind.Object && value4.TryGetProperty("clicky_line", out var value5) && int.TryParse(value5.GetString(), out var result))
				{
					currentLineIndex = result;
				}
				break;
			}
		case "response.done":
		case "response.cancelled":
		{
			(string, int)? tuple = null;
			int num;
			double arg;
			Rendering value6;
			lock (gate)
			{
				num = currentLineIndex;
				arg = (double)currentResponseAudioBytes / 2.0 / (double)audio.SampleRate;
				renderings.Remove(num, out value6);
				completedResponses++;
				responseInFlight = false;
				if (queuedLines.Count > 0)
				{
					tuple = queuedLines.Dequeue();
					responseInFlight = true;
					currentLineIndex = tuple.Value.Item2;
				}
			}
			value6?.Done.TrySetResult((text == "response.done" && value6.Pcm.Length > 0) ? value6.Pcm.ToArray() : null);
			LineGenerated?.Invoke(num, arg);
			if (tuple.HasValue)
			{
				(string, int) valueOrDefault = tuple.GetValueOrDefault();
				SendLineAsync(valueOrDefault.Item1, valueOrDefault.Item2);
			}
			else
			{
				ArmIdleTeardown();
			}
			break;
		}
		case "error":
		{
			lock (gate)
			{
				responseInFlight = false;
			}
			string text2 = ((rootElement.TryGetProperty("error", out var value) && value.TryGetProperty("message", out var value2)) ? value2.GetString() : rootElement.GetRawText());
			Log.Warn("Mouth", "realtime error: " + text2);
			break;
		}
		}
	}

	public void NoteAudioFlushed()
	{
		lock (gate)
		{
			enqueuedSecondsSinceFlush = 0.0;
		}
	}

	private async Task CloseSocketAsync(string reason)
	{
		List<Rendering> list = new List<Rendering>();
		ClientWebSocket ws;
		CancellationTokenSource cancellationTokenSource;
		lock (gate)
		{
			ws = socket;
			cancellationTokenSource = socketLifetime;
			socket = null;
			socketLifetime = null;
			responseInFlight = false;
			queuedLines.Clear();
			AbandonRenderingsLocked(list);
		}
		foreach (Rendering item in list)
		{
			item.Done.TrySetResult(null);
		}
		cancellationTokenSource?.Cancel();
		if (ws == null)
		{
			return;
		}
		try
		{
			if (ws.State == WebSocketState.Open)
			{
				using CancellationTokenSource cts = new CancellationTokenSource(500);
				await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, reason, cts.Token).ConfigureAwait(continueOnCapturedContext: false);
			}
		}
		catch
		{
		}
		ws.Dispose();
	}

	public async ValueTask DisposeAsync()
	{
		CancelIdleTeardown();
		await CloseSocketAsync("disposed").ConfigureAwait(continueOnCapturedContext: false);
		ArrayPool<byte>.Shared.Return(decodeBuffer);
		decodeBuffer = Array.Empty<byte>();
	}
}
