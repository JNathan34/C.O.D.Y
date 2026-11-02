using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents;
using HeyClicky.Agents.Harness;
using HeyClicky.App.Proactive;
using HeyClicky.App.Shell;
using HeyClicky.Core;
using HeyClicky.Core.Billing;
using HeyClicky.Core.Connectors;
using HeyClicky.Core.Dictation;
using HeyClicky.Core.Net;
using HeyClicky.Core.Onboarding;
using HeyClicky.Core.Settings;
using HeyClicky.Core.Telemetry;
using HeyClicky.Core.Tools;
using HeyClicky.Core.Voice;
using HeyClicky.Core.Worker;
using HeyClicky.Drawing;
using HeyClicky.Platform.Audio;
using HeyClicky.Platform.Capture;
using HeyClicky.Platform.Input;
using HeyClicky.Platform.Overlay;
using HeyClicky.Platform.Permissions;
using HeyClicky.Platform.Win32;
using Microsoft.UI.Dispatching;
using Microsoft.Win32;

namespace HeyClicky.App.Wiring;

public sealed class RealStack : IAsyncDisposable
{
	public CoreServices Core { get; private set; }

	public PermissionService Permissions { get; private set; }

	public IMicrophoneCapture Microphone { get; private set; }

	public WasapiAudioOutput Audio { get; private set; }

	public ScreenCaptureService Capture { get; private set; }

	public DeferredCursorOverlay Cursor { get; private set; }

	public DeferredHighlightOverlay Highlight { get; private set; }

	public ScreenDrawingCanvas Canvas { get; private set; }

	public AgentService Agents { get; private set; }

	public CompanionSession Companion { get; private set; }

	public DictationController Dictation { get; private set; }

	public ShortcutMonitor Shortcuts { get; private set; }

	public OnboardingTutorialViewModel Tutorial { get; private set; }

	public BrainContext BrainContext { get; private set; }

	public CompanionTools Tools { get; private set; }

	public AgentVoiceRelay AgentVoice { get; private set; }

	public OneBrainJobReports JobReports { get; private set; }

	public AgentToolHost ToolHost { get; private set; }

	public Func<string?, bool>? OpenHome { get; set; }

	public Func<bool>? CloseHome { get; set; }

	public bool IsComplete => Companion != null;

	private async Task<(int Status, string Body)?> PostToWorkerAsync(string path, string jsonBody, CancellationToken ct)
	{
		try
		{
			byte[] array = await Core.Worker.SendRawAsync(HttpMethod.Post, path, new StringContent(jsonBody, Encoding.UTF8, "application/json"), authenticated: true, ct, TimeSpan.FromSeconds(30L), "companion").ConfigureAwait(continueOnCapturedContext: false);
			return (array == null) ? (((int, string)?)null) : new (int, string)?((200, Encoding.UTF8.GetString(array)));
		}
		catch (WorkerHttpException ex)
		{
			return (ex.Status, ex.Body);
		}
		catch (PaywallReachedException)
		{
			return (402, "{\"error\":\"paywall\"}");
		}
	}

	private static string IanaTimeZone()
	{
		if (!TimeZoneInfo.TryConvertWindowsIdToIanaId(TimeZoneInfo.Local.Id, out string ianaId))
		{
			return TimeZoneInfo.Local.Id;
		}
		return ianaId;
	}

	private static bool OpenUri(string uri)
	{
		try
		{
			ShellOpen.Start(uri);
			return true;
		}
		catch (Exception ex)
		{
			Log.Warn("Tools", "open " + uri + ": " + ex.Message);
			return false;
		}
	}

	private static string? TestSpeakerSilence()
	{
		return null;
	}

	private static bool SpotifyAppInstalled()
	{
		using RegistryKey registryKey = Registry.ClassesRoot.OpenSubKey("spotify\\shell\\open\\command");
		return registryKey != null;
	}

	private bool ShowDocumentAccessCard(CoreServices core, string path)
	{
		if (core.Settings.Read((AppSettings s) => s.DocumentAccessNoticeSuppressed))
		{
			return false;
		}
		if (core.Notch.HasLiveEvent(typeof(NotchLiveEvent.DocumentFolderAccessDenied)))
		{
			return true;
		}
		int count = 0;
		core.Settings.Update((AppSettings s) =>
		{
			count = ++s.DocumentAccessNoticeShowCount;
		});
		string text = ProtectedFolderName(path);
		core.Notch.ShowLiveEvent(new NotchLiveEvent.DocumentFolderAccessDenied((text == null) ? "Allow your account to open this file" : ("Allow your account to open this file in " + text), count >= 2, path));
		Log.Info("PageRead", $"document access card ({text ?? "unrecognized folder"}, show #{count})");
		return true;
	}

	internal bool RaiseDocumentAccessCardForTests(string path)
	{
		return ShowDocumentAccessCard(Core, path);
	}

	private static string? ProtectedFolderName(string path)
	{
		(Environment.SpecialFolder, string)[] array = new (Environment.SpecialFolder, string)[5]
		{
			(Environment.SpecialFolder.Personal, "Documents"),
			(Environment.SpecialFolder.Desktop, "Desktop"),
			(Environment.SpecialFolder.MyPictures, "Pictures"),
			(Environment.SpecialFolder.MyMusic, "Music"),
			(Environment.SpecialFolder.MyVideos, "Videos")
		};
		for (int i = 0; i < array.Length; i++)
		{
			(Environment.SpecialFolder, string) tuple = array[i];
			Environment.SpecialFolder item = tuple.Item1;
			string item2 = tuple.Item2;
			string folderPath = Environment.GetFolderPath(item);
			if (folderPath.Length > 0 && path.StartsWith(folderPath + "\\", StringComparison.OrdinalIgnoreCase))
			{
				return item2;
			}
		}
		string text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
		if (!path.StartsWith(text + "\\", StringComparison.OrdinalIgnoreCase))
		{
			return null;
		}
		return "Downloads";
	}

	public static RealStack CreateCore()
	{
		Stopwatch stopwatch = Stopwatch.StartNew();
		CoreServices coreServices = CoreServices.Create();
		PermissionService permissionService = new PermissionService();
		permissionService.StartPolling();
		Log.Info("startup", $"core services in {stopwatch.Elapsed.TotalMilliseconds:0} ms");
		return new RealStack
		{
			Core = coreServices,
			Permissions = permissionService,
			Tutorial = new OnboardingTutorialViewModel(coreServices.Settings, () => SystemVolume.EffectiveLevel())
		};
	}

	public void Complete(DispatcherQueue ui, SynchronizationContext? uiContext)
	{
		Stopwatch sw = Stopwatch.StartNew();
		CoreServices core = Core;
		Environment.GetEnvironmentVariable("HEYCLICKY_TEST_MIC_WAV");
		WasapiMicrophoneCapture wasapiMicrophoneCapture = new WasapiMicrophoneCapture();
		wasapiMicrophoneCapture.Prewarm();
		IMicrophoneCapture microphone = wasapiMicrophoneCapture;
		_ = AudioTopologyMonitor.Shared;
		AudioOutputRoute.Changed += (AudioOutputRouteChange change) =>
		{
			if (!(change.StreamName != "voice"))
			{
				ClickyAnalytics.TrackRealtimeAudioOutputRouteChange(change.FromTransport, change.ToTransport, change.FromDevice, change.ToDevice, change.DroppedBuffers, change.EngineWasRunning, change.RestartSucceeded);
			}
		};
		WasapiAudioOutput audio = new WasapiAudioOutput();
		Task.Run((Action)audio.PreloadEarcons);
		ScreenCaptureService capture = new ScreenCaptureService();
		double value = Lap();
		DeferredCursorOverlay cursor = new DeferredCursorOverlay();
		DeferredHighlightOverlay highlight = new DeferredHighlightOverlay();
		ScreenDrawingCanvas screenDrawingCanvas = new ScreenDrawingCanvas((CancellationToken ct) => core.Auth.GetValidAccessTokenAsync(ct), core.Endpoints.WorkerBaseUrl, ui, (HttpRequestMessage request) =>
		{
			ClickyClientHeadersHandler.Apply(request.Headers, core.Identity);
		});
		screenDrawingCanvas.PenStrokes += (object? _, IReadOnlyList<PenStrokePath> strokes) =>
		{
			cursor.RidePen(strokes);
		};
		screenDrawingCanvas.Cleared += (object? _, EventArgs _) =>
		{
			cursor.EndPenRide();
		};
		screenDrawingCanvas.PenHandedBack += (object? _, EventArgs _) =>
		{
			cursor.EndPenRide();
		};
		screenDrawingCanvas.ScreenChangeWatchFactory = (DisplayInfo display, Action<string> onChanged) => HeyClicky.App.Cody.CodyDrawingControls.WatchScreen(screenDrawingCanvas, display, onChanged);
		double value2 = Lap();
		AgentRuntimeOptions agentRuntimeOptions = new AgentRuntimeOptions();
		AppHost.PrepareStoredSettings(core.Settings, agentRuntimeOptions);
		AgentService agents = new AgentService(core.Endpoints, (CancellationToken ct) => core.Auth.GetValidAccessTokenAsync(ct), core.Http.Client, core.Identity, agentRuntimeOptions);
		agents.CurrentUserId = () => (!core.Auth.IsSignedIn) ? null : core.Auth.UserId;
		agents.Routines.AgentAllowanceResetsAt = () => core.Billing.UsageResetsDate;
		AgentToolHost agentToolHost = (ToolHost = new AgentToolHost(agents, (string? threadTaskId) => OpenHome?.Invoke(threadTaskId) ?? false, () => CloseHome?.Invoke() ?? false));
		AgentToolHost agentToolHost3 = agentToolHost;
		BrainContext brainContext = new BrainContext(core, agentToolHost3);
		AgentTools agents2 = new AgentTools(agentToolHost3);
		CompanionTools companionTools = new CompanionTools(new LocalRootTools(() => agents.ProjectsRoot), new WorkerTools(PostToWorkerAsync, IanaTimeZone, OpenUri, SpotifyAppInstalled), agents2);
		OnboardingTutorialViewModel tutorial = Tutorial;
		IAudioOutput audioOutput2;
		if (!(Environment.GetEnvironmentVariable("HEYCLICKY_MUTE_AUDIO") == "1"))
		{
			IAudioOutput audioOutput = audio;
			audioOutput2 = audioOutput;
		}
		else
		{
			IAudioOutput audioOutput = new MutedAudioOutput(audio);
			audioOutput2 = audioOutput;
		}
		IAudioOutput audio2 = HeyClicky.App.Cody.CodyEngineBridge.EngineMode ? HeyClicky.App.Cody.CodyCachedAudio.Wrap(audioOutput2) : audioOutput2;
		CoreServices coreServices = core;
		ScreenCaptureService screens = capture;
		DeferredCursorOverlay cursor2 = cursor;
		string silence = TestSpeakerSilence();
		CompanionSessionOptions companionSessionOptions = new CompanionSessionOptions
		{
			UiContext = uiContext,
			DesktopActions = new PlatformDesktopActions(),
			ToolCallHandler = HeyClicky.App.Cody.CodyEngineBridge.EngineMode ? (call,context,ct)=>HeyClicky.App.Cody.CodyQuickActions.Handle(call,context,ct,companionTools.HandleAsync,agents,()=>{var userContext=brainContext.UserContext();var catalog=HeyClicky.App.Services.ConnectedApps.Catalog;var connected=catalog==null?userContext.ConnectedApps.AsEnumerable():catalog.Integrations.Where(item=>item.IsActiveConnection).SelectMany(item=>new[]{item.Id,item.DisplayName,item.PrimaryToolkitSlug});return connected.Concat(userContext.CustomConnectors.Where(item=>!userContext.NeedsReconnect.Contains(item.Name,StringComparer.OrdinalIgnoreCase)).Select(item=>item.Name)).ToArray();}) : companionTools.HandleAsync,
			UserContext = brainContext.UserContext,
			RosterNote = brainContext.RosterNote,
			PlanNote = brainContext.PlanNote,
			PageReader = new WindowsPageReader(),
			DocumentAccessDenied = (string path) => ShowDocumentAccessCard(core, path),
			OutputSilenceKind = ((silence != null) ? ((Func<string>)(() => silence)) : new Func<string>(SystemAudioOutputVolume.CurrentSilenceKind)),
			IsOnboardingTutorialRestrictingNormalUse = () => tutorial.IsRestrictingNormalUse,
			UsageContext = () => (!tutorial.IsEngaged) ? "companion" : "onboarding",
			LiveStateNote = () =>
		{
			Func<bool>? isInterviewSendOffInProgress = FlowHooks.IsInterviewSendOffInProgress;
			object obj;
			if (isInterviewSendOffInProgress == null || !isInterviewSendOffInProgress())
			{
				obj = FlowHooks.LiveStateNote?.Invoke();
				if (obj == null)
				{
					obj = ProactiveHooks.LiveStateNote?.Invoke();
					if (obj == null)
					{
						obj = ((!tutorial.IsRestrictingNormalUse) ? null : FlowHooks.TourStepNote?.Invoke());
						if (obj == null)
						{
							return FlowHooks.NotchNote?.Invoke();
						}
					}
				}
			}
			else
			{
				obj = null;
			}
			return (string?)obj;
		},
			TurnFlow = () =>
		{
			object obj = FlowHooks.TurnFlow?.Invoke();
			if (obj == null)
			{
				obj = ((ProactiveCoordinator.Current?.AdjustingCardId).HasValue ? "suggestion_adjust" : null);
				if (obj == null)
				{
					if (!tutorial.IsEngaged)
					{
						Func<bool>? isInterviewSendOffInProgress = FlowHooks.IsInterviewSendOffInProgress;
						if (isInterviewSendOffInProgress == null || !isInterviewSendOffInProgress())
						{
							return (string?)null;
						}
					}
					obj = "onboarding_tour";
				}
			}
			return (string?)obj;
		},
			SnapTargetToControl = (RectD modelBox, DisplayInfo display, CancellationToken ct) => UIAutomationHelpers.ControlFrameNearAsync(modelBox, display.BoundsPx, display.Scale, ct),
			PointerInput = new PointerInput(),
			RefuseTurnOverMessageCap = (string _) =>
		{
			if (!core.Billing.ShouldBlockFreeUserMessageTurnLocally())
			{
				return false;
			}
			PaywallPayload paywallPayload = core.Billing.MakeLocalMessagesLimitPaywallPayload();
			if ((object)paywallPayload != null)
			{
				BillingPaywallDetector.Present(paywallPayload);
			}
			return true;
		},
			MessageCounted = (bool counted) =>
		{
			if (counted)
			{
				core.Billing.RegisterLocalMessageTurnConsumed();
			}
			else
			{
				core.Billing.RollbackLocalMessageTurnConsumed();
			}
		},
			KeepMouthWarm = () => agents.Tasks.Any((AgentTaskSnapshot t) =>
		{
			AgentTaskStatus status = t.Status;
			return (uint)status <= 1u;
		}),
			HighlightText = async (IReadOnlyList<HighlightStroke> strokes, CancellationToken ct) =>
		{
			if (QuietContext.FullscreenForegroundMonitor() == 0)
			{
				return await HighlightTextHarvester.SummarizeAsync(strokes, capture.GetDisplays(), ct);
			}
			using CancellationTokenSource quick = CancellationTokenSource.CreateLinkedTokenSource(ct);
			quick.CancelAfter(300);
			try
			{
				return await HighlightTextHarvester.SummarizeAsync(strokes, capture.GetDisplays(), quick.Token).WaitAsync(quick.Token);
			}
			catch (OperationCanceledException) when (!ct.IsCancellationRequested)
			{
				return (string?)null;
			}
		},
			MutedSpeakerReplyExempt = () => FlowHooks.MutedSpeakerReplyExempt?.Invoke() ?? false,
			TakeFlowBrief = () => { if(HeyClicky.App.Cody.CodyEngineBridge.EngineMode) HeyClicky.App.Cody.CodyEngineBridge.RouteVoiceUtility(); return FlowHooks.TakeFlowBrief?.Invoke(); },
			TakePillPlanNote = () => FlowHooks.TakePillPlanNote?.Invoke(),
			EdgeDockFocusNote = () => FlowHooks.EdgeDockFocusNote?.Invoke(),
			BrowserStateNote = (bool canDrive) => FlowHooks.BrowserStateNote?.Invoke(canDrive),
			IsOnboardingTurn = () =>
		{
			if (!tutorial.IsEngaged)
			{
				Func<bool>? isInterviewSendOffInProgress = FlowHooks.IsInterviewSendOffInProgress;
				if (isInterviewSendOffInProgress == null || !isInterviewSendOffInProgress())
				{
					return FlowHooks.IsDrawnTourRunning?.Invoke() ?? false;
				}
			}
			return true;
		},
			CaptureSettleSeconds = () => FlowHooks.CaptureSettleSeconds?.Invoke() ?? 0.0,
			RendersTextInNotchChat = () => FlowHooks.RendersTextInNotchChat?.Invoke() ?? false,
			StepNotchChatAsideForDrawing = () => FlowHooks.StepNotchChatAsideForDrawing?.Invoke() ?? false
		};
		CompanionSession companion = coreServices.CreateCompanionSession(microphone, audio2, screens, screenDrawingCanvas, cursor2, highlight, companionSessionOptions);
		companion.Prewarm();
		PermissionService permissions = Permissions;
		DictationController dictationController = new DictationController(core.Http, core.Auth, core.Settings, microphone, new DictationTextTarget(), core.Notch, new DictationControllerOptions
		{
			UsageContext = () => (!tutorial.IsEngaged) ? "companion" : "onboarding",
			IsOnboardingTutorialRestricting = () => tutorial.IsRestrictingNormalUse,
			CanStartRecording = () => companion.State != VoiceState.Listening,
			IsMicrophoneDenied = () => permissions.GetStatus(PermissionKind.Microphone) == PermissionStatus.Denied,
			PlayCue = ((Environment.GetEnvironmentVariable("HEYCLICKY_MUTE_AUDIO") == "1") ? ((Action<string, float>)((string _, float _) =>
			{
			})) : ((Action<string, float>)((string name, float volume) =>
			{
				audio.PlayEarcon(name, volume);
			})))
		});
		DictationHooks.RemoveLearnedWord = dictationController.RemoveLearnedWord;
		double value3 = Lap();
		Microphone = microphone;
		Audio = audio;
		Capture = capture;
		Cursor = cursor;
		Highlight = highlight;
		Canvas = screenDrawingCanvas;
		Agents = agents;
		Companion = companion;
		Dictation = dictationController;
		Shortcuts = new ShortcutMonitor();
		companion.StateChanged += (object? _, EventArgs _) =>
		{
			VoiceState state = companion.State;
			if ((uint)(state - 1) <= 1u)
			{
				ScreenDrawingCanvas.WarmUpFigures();
			}
		};
		BrainContext = brainContext;
		Tools = companionTools;
		AgentVoice = new AgentVoiceRelay(agents, core, companion, brainContext);
		WireJobsAndHarness(core, agents, companion, brainContext, audio);
		agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			AgentTaskEventKind kind = e.Kind;
			if ((uint)(kind - 8) <= 1u)
			{
				brainContext.Refresh();
			}
		};
		FlowHooks.SuppressDocumentAccessNotice = () =>
		{
			core.Settings.Update((AppSettings s) =>
			{
				s.DocumentAccessNoticeSuppressed = true;
			});
		};
		ForegroundTracker.Start();
		ForegroundTracker.ExternalWindowCameForward += ScreenCaptureYield.NoteForegroundWindow;
		if (core.Auth.IsSignedIn)
		{
			brainContext.Refresh();
		}
		Log.Info("startup", $"real services: audio+capture {value:0} ms, canvas {value2:0} ms, agents+companion {value3:0} ms");
		double Lap()
		{
			double totalMilliseconds = sw.Elapsed.TotalMilliseconds;
			sw.Restart();
			return totalMilliseconds;
		}
	}

	public void StartBackground(string cursorColorHex, bool showCursor = true)
	{
        if (!AppPaths.IsOverridden && !HeyClicky.App.Cody.CodyEngineBridge.EngineMode)
		{
			Task.Run(() =>
			{
				try
				{
					ProtocolRegistration.Register();
				}
				catch (Exception ex)
				{
					Log.Warn("startup", "protocol registration: " + ex.Message);
				}
			});
		}
		else
		{
			Log.Info("startup", "clicky:// and Open-with registration skipped: the data folder is moved (a test run)");
		}
		Thread thread = new Thread(() =>
		{
			if (OverlayWindow.Offscreen)
			{
				Log.Info("startup", "offscreen run: cursor and highlight overlays skipped");
				return;
			}
			Stopwatch stopwatch = Stopwatch.StartNew();
			try
			{
                if(!HeyClicky.App.Cody.CodyEngineBridge.EngineMode){
                CursorOverlay cursorOverlay = new CursorOverlay();
				cursorOverlay.SetColor(cursorColorHex);
				Cursor.Attach(cursorOverlay);
				if (showCursor)
				{
					Cursor.Show();
				}
                }
                Highlight.Attach(new HighlightOverlay());
				Log.Info("startup", $"overlays ready in {stopwatch.ElapsedMilliseconds} ms");
			}
			catch (Exception ex)
			{
				Log.Error("startup", "overlays failed", ex);
			}
		});
		thread.IsBackground = true;
		thread.Name = "OverlayStartup";
		thread.Start();
		Core.StartAsync();
		if (Core.Auth.IsSignedIn)
		{
			Agents.PrewarmAsync();
		}
		if (!OverlayWindow.Offscreen)
		{
			Shortcuts.Start();
		}
	}

	public async ValueTask DisposeAsync()
	{
		Try(() =>
		{
			Shortcuts?.Dispose();
		}, "shortcuts");
		await TryAsync(Dictation, "dictation");
		await TryAsync(Companion, "companion");
		await TryAsync(Agents, "agents");
		Try(() =>
		{
			Canvas?.Dispose();
		}, "canvas");
		Try(() =>
		{
			Highlight?.Dispose();
		}, "highlight");
		Try(() =>
		{
			Cursor?.Dispose();
		}, "cursor");
		Try(() =>
		{
			Capture?.Dispose();
		}, "capture");
		Try(() =>
		{
			Audio?.Dispose();
		}, "audio");
		Try(() =>
		{
			Microphone?.Dispose();
		}, "microphone");
		Try(() =>
		{
			Permissions?.Dispose();
		}, "permissions");
		await TryAsync(Core, "core");
		static void Try(Action a, string what)
		{
			Log.Info("shutdown", "stopping " + what);
			try
			{
				a();
			}
			catch (Exception ex)
			{
				Log.Warn("shutdown", what + ": " + ex.Message);
			}
		}
		static async Task TryAsync(IAsyncDisposable? service, string what)
		{
			Log.Info("shutdown", "stopping " + what);
			try
			{
				if (service != null)
				{
					await service.DisposeAsync();
				}
			}
			catch (Exception ex)
			{
				Log.Warn("shutdown", what + ": " + ex.Message);
			}
		}
	}

	private void WireJobsAndHarness(CoreServices core, AgentService agents, CompanionSession companion, BrainContext brainContext, WasapiAudioOutput audio)
	{
		bool muted = Environment.GetEnvironmentVariable("HEYCLICKY_MUTE_AUDIO") == "1";
		JobReports = new OneBrainJobReports(agents, companion)
		{
			Speak = (string line) => companion.AnnounceAsync(line, core.Settings.Read((AppSettings s) => s.AgentCursorTextAnnouncementsEnabled)),
			PlayDoneChime = () =>
			{
				if (!muted)
				{
					audio.PlayEarcon("agentDone", 0.7f);
				}
			}
		};
		AgentVoice.JobReports = JobReports;
		AgentToolHooks.ShowResult = JobReports.ShowResult;
		AgentToolHooks.Routines = async (string argumentsJson) => (await agents.RoutinesTool.RunAsync(argumentsJson).ConfigureAwait(continueOnCapturedContext: false)).ToJsonString();
		agents.StepWatcher.FrontmostBrowserAddress = () =>
		{
			try
			{
				ForegroundApp result = ForegroundAppInfo.CaptureUserAppAsync().WaitAsync(TimeSpan.FromSeconds(2L)).GetAwaiter()
					.GetResult();
				return ((object)result != null && ForegroundAppInfo.IsBrowser(result.ProcessName)) ? result.BrowserUrl : null;
			}
			catch (Exception)
			{
				return (string?)null;
			}
		};
		brainContext.JobsNote = () => agents.WorkContextNoteForBrainTurn(ProactiveHooks.LiveCardIds());
		AppRemoteConfig.Shared.AgentHarnessDefaultFetched += AgentHarnessPreferences.SaveServerDefaultHarness;
		agents.HarnessTurnEnded += (string harness, string place, string status, double seconds, IReadOnlyDictionary<string, double> stats) =>
		{
			ClickyAnalytics.TrackAgentHarnessTurn(harness, place, status, seconds, stats);
		};
		agents.InternalError += (string subsystem, string stage, string detail, string key) =>
		{
			ClickyAnalytics.ReportInternalError(subsystem, stage, null, detail, CrashReportLevel.Error, key);
		};
		agents.JobAction += (string _, string? threadId, IReadOnlyDictionary<string, object?> properties) =>
		{
			ClickyAnalytics.TrackProductEvent("job_action", null, threadId, Json(properties));
		};
		agents.CodexStoredConnectorToken = (Uri url, string serverKey) => McpProbe.CodexStoredAccessToken(url, agents.CodexHome, serverKey);
	}

	private static JsonObject Json(IReadOnlyDictionary<string, object?> properties)
	{
		JsonObject jsonObject = new JsonObject();
		foreach (KeyValuePair<string, object> property in properties)
		{
			property.Deconstruct(out var key, out var value);
			string text = key;
			object obj = value;
			JsonObject jsonObject2 = jsonObject;
			key = text;
			JsonValue value2;
			if (obj == null)
			{
				value2 = null;
			}
			else if (obj is bool value3)
			{
				value2 = JsonValue.Create(value3);
			}
			else if (obj is int value4)
			{
				value2 = JsonValue.Create(value4);
			}
			else if (obj is long value5)
			{
				value2 = JsonValue.Create(value5);
			}
			else if (obj is double value6)
			{
				value2 = JsonValue.Create(value6);
			}
			else
			{
				value2 = ((!(obj is string value7)) ? JsonValue.Create(obj.ToString()) : JsonValue.Create(value7));
			}
			jsonObject2[key] = value2;
		}
		return jsonObject;
	}
}
