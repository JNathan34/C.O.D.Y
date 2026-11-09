using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents;
using HeyClicky.Agents.Clickys;
using HeyClicky.Agents.Harness;
using HeyClicky.Agents.Jobs;
using HeyClicky.Agents.Runtime;
using HeyClicky.Agents.Turns;
using HeyClicky.App.Billing;
using HeyClicky.App.Browser;
using HeyClicky.App.Demo;
using HeyClicky.App.Design;
using HeyClicky.App.Dock;
using HeyClicky.App.Documents;
using HeyClicky.App.Drive;
using HeyClicky.App.Home;
using HeyClicky.App.Ink;
using HeyClicky.App.Interop;
using HeyClicky.App.Notch;
using HeyClicky.App.Notch.Peek;
using HeyClicky.App.Notch.Surfaces;
using HeyClicky.App.Onboarding;
using HeyClicky.App.OneBrain;
using HeyClicky.App.Portraits;
using HeyClicky.App.Proactive;
using HeyClicky.App.Services;
using HeyClicky.App.Services.Updates;
using HeyClicky.App.Settings;
using HeyClicky.App.Shell;
using HeyClicky.App.UI;
using HeyClicky.App.Wiring;
using HeyClicky.Core.Auth;
using HeyClicky.Core.Billing;
using HeyClicky.Core.Browser;
using HeyClicky.Core.Configuration;
using HeyClicky.Core.Dictation;
using HeyClicky.Core.Drive;
using HeyClicky.Core.Ink;
using HeyClicky.Core.Notch;
using HeyClicky.Core.Onboarding;
using HeyClicky.Core.Proactive;
using HeyClicky.Core.Settings;
using HeyClicky.Core.Telemetry;
using HeyClicky.Core.Tools;
using HeyClicky.Core.Voice;
using HeyClicky.Core.Worker;
using HeyClicky.Drawing;
using HeyClicky.Drawing3D;
using HeyClicky.Platform.Audio;
using HeyClicky.Platform.Input;
using HeyClicky.Platform.Win32;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.VisualBasic.FileIO;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.UI;

namespace HeyClicky.App;

public sealed class AppHost : INotchCardActions, IAppActions, INotchActions
{
	private int agentCostLaneReadInFlight;

	private DispatcherQueueTimer? ambientTimer;

	private string? lastAgentSignature;

	private bool lastFullscreenOnNotch;

	private readonly HashSet<string> autoOpenedTurns = new HashSet<string>();

	private readonly List<(string TaskId, string Artifact, string? Workspace)> heldArtifactOpens = new List<(string, string, string)>();

	private DispatcherQueueTimer? heldArtifactDrain;

	private BillingUi? billing;

	private bool openBrowserSettingsWhenReady;

	private bool paywallIntroVideoPlaying;

	private bool newAgentsUiDemoRun;

	private CompanionNotchBridge? bridge;

	private HotkeyRouter? hotkeys;

	private bool quitting;

	private bool cursorShownForOnboarding;

	private OneBrainStatsPanel? oneBrainStatsPanel;

	private bool realServicesStarted;

	private readonly List<string[]> pendingLaunchArgs = new List<string[]>();

	private bool cursorDockFlightInProgress;

	private CancellationTokenSource? pendingFinishCue;

	private bool lastTurnTyped;

	private DockLaunchFlight? launchFlight;

	private bool notchWindowHovered;

	private bool deckPointerOnNotch;

	private readonly HashSet<string> dockKnownTasks = new HashSet<string>();

	private readonly Dictionary<string, AgentTaskStatus> dockLastStatus = new Dictionary<string, AgentTaskStatus>();

	private bool dockFirstSync = true;

	private Action<string>? AnnounceComputerUseAsk;

	private readonly List<(string TaskId, int Slot)> launchPaletteSlots = new List<(string, int)>();

	private GoodMorningBrief? morningBrief;

	private ClickyInkNoteConnect? inkConnect;

	private CursorCompanion? cursorCompanion;

	private MediaPlayer? music;

	private bool introSequenceActive;

	private static readonly string ResearchBuddyPrompt = "I am a CEO of SpaceX, the rocket company. Do a simple competitor reserach for this rocket company, save it as a PDF inside your own projects folder (the cwd you were started in; do NOT save to Downloads, Desktop, Documents, or anywhere else). Do NOT open the file yourself, just list it in your ARTIFACTS block and HeyClicky will open the finished file automatically once you're done. Don't overcomplicate this, max 2 pages. Include a picture of a newest NASA rocket. Don't spend more than 1 minute on this. ";

	private static readonly string ShippyPrompt = "agent, create a very simple but fun looking personalized welcome website on this computer: one plain .html file (CSS baked in, no frameworks, no javascript, no server). It must be a SINGLE non-scrolling screen: everything fits in one 100vh viewport, body overflow hidden, no scrollbars. Top/center: a big friendly hero that says `hello {name}`; learn the name of the user from the context you know (their HeyClicky signup name, maybe name of the user on this PC), and you can add one short personal line under it if you know anything about me. Along the BOTTOM: a small friendly section heading like `you can use HeyClicky with any app`, then one compact horizontal row of 4-5 apps ACTUALLY installed on this PC (check the Start menu shortcuts under %ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs and %AppData%\\Microsoft\\Windows\\Start Menu\\Programs), each as a small card: the app's REAL icon, the app name, and 2-3 punchy bullet points (max ~7 words each) on using HeyClicky with THAT app. Write bullets ONLY from HeyClicky's real capabilities, matched to what the app is for: hold ctrl+alt and talk about anything on screen; circle something while asking and HeyClicky sees exactly what you marked; it points at buttons and walks you through apps step by step; or hand it a one-command background task (agents research the web, write files/PDFs/spreadsheets, build and preview websites, do git and GitHub work, and use connected apps like Gmail, Calendar, Notion, and Linear). Never promise scheduled automation, always-on monitoring, or image/video generation. REAL icons only, never emoji or drawn placeholders: extract each icon from the app's .exe or .lnk target with PowerShell (System.Drawing.Icon ExtractAssociatedIcon, saved as a 128px png), save the pngs NEXT to the .html, and reference them with relative paths. Save the .html inside your own projects folder (the cwd you were started in; do NOT save to Downloads, Desktop, Documents, or anywhere else). Do NOT open the file yourself, just list the plain .html file (file://...) in your ARTIFACTS block and HeyClicky will open it automatically once you're done. Do NOT spin up a local server or open a localhost URL. Ignore github or anything like this, just a plain demo .html file right where you are. (Ignore the rocket topic.)";

	private const string ResearchBuddyAsk = "I'm the CEO of this rocket company you see on my screen. Can you research my competitors and save it as a PDF?";

	private const string ShippyAsk = "Can you make me a website for the beautiful person watching this video right now, and open it in the browser when you're done?";

	private readonly HashSet<DispatcherQueueTimer> hostTimers = new HashSet<DispatcherQueueTimer>();

	private MediaPlayer? preloadedIntroPlayer;

	private IntroVideoSourceKind preloadedIntroSource;

	private readonly HostedVideoFailureReporter introVideoFailures = new HostedVideoFailureReporter();

	private readonly List<DispatcherQueueTimer> dryRunTimers = new List<DispatcherQueueTimer>();

	private LessonService? lessons;

	private bool rosterAttached;

	private bool observingNotchLinkOpens;

	private bool notchWasOpen;

	private static readonly bool EarconsMuted = Environment.GetEnvironmentVariable("HEYCLICKY_MUTE_AUDIO") == "1";

	private readonly HashSet<string> announcedExtraUsage = new HashSet<string>();

	private readonly Dictionary<string, AgentTaskStatus> lastAgentStatus = new Dictionary<string, AgentTaskStatus>();

	private PreSignInIntroViewModel? introVm;

	private NotchOnboardingCardViewModel? cardVm;

	private readonly ConcurrentDictionary<string, byte> onboardingDemoTaskIds = new ConcurrentDictionary<string, byte>();

	private EventHandler? manualUpdateProbe;

	private bool resetting;

	private const nint PBT_POWERSETTINGCHANGE = 32787;

	private static readonly Guid GUID_CONSOLE_DISPLAY_STATE = new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");

	private nint displayPowerNotification;

	private const int DEVICE_NOTIFY_WINDOW_HANDLE = 0;

	private const int SystemPowerCapabilities = 4;

	private AppSettings? appliedSettings;

	private bool accountWasSignedIn;

	private static readonly HashSet<string> CoverageIgnoredProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
	{
		"chrome", "msedge", "firefox", "brave", "opera", "opera_gx", "vivaldi", "arc", "zen", "duckduckgo",
		"iexplore"
	};

	private nint coverageForeground;

	private CancellationTokenSource? coverageProbe;

	private UpdateService? updates;

	private readonly HashSet<string> agentsSeen = new HashSet<string>();

	private const uint WM_POWERBROADCAST = 536u;

	private const nint PBT_APMSUSPEND = 4;

	private const nint PBT_APMRESUMESUSPEND = 7;

	private const nint PBT_APMRESUMEAUTOMATIC = 18;

	private DateTimeOffset lastResume;

	private int claimingReferral;

	private TaskbarButton? taskbarButton;

	private HomeTour? tour;

	private long lastRefusalAt;

	private bool finaleSuppressesEndLine;

	private bool paywallLineWired;

	private Action? afterOnboardingPaywall;

	private DispatcherQueueTimer? notchAboveDrawingTimer;

	private bool trayTooltipWired;

	private TrayIcon? tray;

	private SettingsWindow? settings;

	private IntroWindow? intro;

	private TutorialWindow? tutorial;

	private HatchFlightOverlay? flight;

	private bool notchFirstShownTracked;

	private bool tutorialVmWired;

	private bool fakeIntroWelcomeActive;

	private bool fakeIntroDismissedTracked;

	public static AgentTurnCostLedger? AgentCostLedger { get; private set; }

	public BillingUi? Billing => billing;

	public Action<string>? PresentTaskNeedsYouHook { get; set; }

	public Action? DismissNotchUpdateHook { get; set; }

	public Action<string, string>? NoteClickyEventForOneBrain { get; set; }

	internal VoiceState VoiceState => Services.Companion.State;

	public bool IsPaywallIntroVideoPlaying
	{
		get
		{
			if (paywallIntroVideoPlaying)
			{
				return CursorCompanion.IsPlayingVideo;
			}
			return false;
		}
	}

	public bool IsNewAgentsUiDemoRun => newAgentsUiDemoRun;

	public AppServices Services { get; }

	public AppOptions Options { get; }

	public RealStack? Real { get; }

	public OneBrainJobReports? JobReports => Real?.JobReports;

	public DispatcherQueue DispatcherQueue { get; }

	public NotchView NotchUi { get; private set; }

	internal HotkeyRouter? Hotkeys => hotkeys;

	internal NotchPresenter? CorePresenter => Services.Presenter as NotchPresenter;

	public ArcDock? Dock { get; private set; }

	internal bool InterviewSendOffInProgress { get; private set; }

	public GoodMorningBrief? MorningBrief => morningBrief;

	internal string? AccountFirstNameForTour
	{
		get
		{
			string text = Services.Auth.User?.DisplayName?.Trim();
			if (text != null && text.Length > 0)
			{
				string[] array = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
				if (array != null && array.Length > 0)
				{
					return array[0];
				}
			}
			return null;
		}
	}

	internal bool IsDrawnOnboardingFinalePrefetchReady
	{
		get
		{
			if (DrawnOnboardingTour.IsFinaleEnabled)
			{
				TutorialWindow tutorialWindow = tutorial;
				if (tutorialWindow != null && tutorialWindow.IsRunning && tutorialWindow.CurrentStep == TutorialWindow.Step.Finale && !InterviewSendOffInProgress)
				{
					RealStack real = Real;
					if (real != null && real.Core.Auth.IsSignedIn)
					{
						InterviewController interview = Interview;
						if (interview != null && interview.Transcript.Any((InterviewLine l) => l.Role == "user") && (interview.HasBuiltPlan || !interview.IsPlanInFlight))
						{
							return real.Companion.ActiveTurnCount == 0;
						}
					}
				}
			}
			return false;
		}
	}

	internal PanelWindow? TourPanelWindow => tutorial?.Window;

	internal ClickyTakeOverController? ClickyDrive { get; private set; }

	internal AgentDriveConsent? ClickyDriveConsent { get; private set; }

	public AgentsInkNoteHost? InkNoteHost { get; private set; }

	public CursorCompanion CursorCompanion => cursorCompanion ?? (cursorCompanion = CreateCursorCompanion());

	public bool IsIntroSequenceActive => introSequenceActive;

	public LessonService? Lessons
	{
		get
		{
			LessonService? lessonService = lessons;
			if (lessonService == null)
			{
				RealStack real = Real;
				lessonService = (lessons = ((real != null && real.IsComplete) ? new LessonService(real, DispatcherQueue, ExcludeFromCapture, () => Services.Settings.CursorColorHex)
				{
					NotchPoint = () =>
					{
						Displays.Monitor monitor = Displays.ForWindow(NotchUi.Window.Hwnd);
						return (X: monitor.Bounds.Left + monitor.Bounds.Width / 2, Y: monitor.Bounds.Top);
					}
				} : null));
			}
			return lessonService;
		}
	}

	private bool NotchShowsSettings
	{
		get
		{
			NotchPresenter corePresenter = CorePresenter;
			if (corePresenter != null && corePresenter.IsShowingNotchAgentPeek)
			{
				return corePresenter.Tabs.Selected == NotchTab.Settings;
			}
			return false;
		}
	}

	private bool EdgeDockIsRunning
	{
		get
		{
			if (HasCompletedOnboardingNow && !introSequenceActive)
			{
				RealStack? real = Real;
				if (real == null)
				{
					return true;
				}
				return !real.Tutorial.IsEngaged;
			}
			return false;
		}
	}

	private bool DockShowsFinishes
	{
		get
		{
			if (EdgeDockIsRunning)
			{
				ArcDock? dock = Dock;
				if (dock == null)
				{
					return true;
				}
				return !dock.IsTabTuckedNow;
			}
			return false;
		}
	}

	private PreSignInIntroViewModel? IntroVm
	{
		get
		{
			RealStack real = Real;
			if (real == null)
			{
				return null;
			}
			return introVm ?? (introVm = CreateIntroVm(real));
		}
	}

	internal NotchOnboardingCardViewModel? CardVm
	{
		get
		{
			RealStack real = Real;
			if (real == null)
			{
				return null;
			}
			return cardVm ?? (cardVm = CreateCardVm(real));
		}
	}

	public bool DevSignInAvailable
	{
		get
		{
			RealStack real = Real;
			if (real != null && real.Core.Auth.SupportsPasswordSignIn)
			{
				return AppBundleConfiguration.IsLocalUrl(real.Core.Endpoints.SupabaseUrl);
			}
			return false;
		}
	}

	public bool HidesHomePromotionalButtons
	{
		get
		{
			if (!introSequenceActive && !TourHoldsHome)
			{
				return Real?.Tutorial.IsEngaged ?? false;
			}
			return true;
		}
	}

	public ProactiveCoordinator? Proactive { get; private set; }

	private bool IntroOwnsFlow
	{
		get
		{
			if (IsPreSignInIntroShowing)
			{
				return true;
			}
			NotchOnboardingCardViewModel? notchOnboardingCardViewModel = CardVm;
			if ((notchOnboardingCardViewModel != null && notchOnboardingCardViewModel.IsIntroHomeWelcomeActive) || fakeIntroWelcomeActive)
			{
				return false;
			}
			RealStack real = Real;
			if (real != null)
			{
				return PreSignInIntroViewModel.ShouldPresent(real.Core.Settings.Read((AppSettings s) => s.Onboarding), real.Core.Auth.IsSignedIn);
			}
			return !Services.Settings.HasCompletedIntro;
		}
	}

	private bool HasCompletedOnboardingNow => Real?.Core.Settings.Read((AppSettings s) => s.Onboarding.HasCompletedOnboarding) ?? Services.Settings.HasCompletedOnboarding;

	public Action<string>? BrowserHandoffLineSink { get; set; }

	public Action<string?, bool>? IntegrationAuthCallback { get; set; }

	public static string ChangelogUrl => AppRemoteConfig.Shared.Links.Changelog;

	private static string PendingReferralFile => Path.Combine(AppBundleConfiguration.AppDataDirectory, "pending-referral.json");

	public bool TourHoldsHome
	{
		get
		{
			HomeTour homeTour = tour;
			if (homeTour == null || !homeTour.IsRunning)
			{
				return InterviewSendOffInProgress;
			}
			return true;
		}
	}

	private bool ExcludeFromCapture => !Options.AllowCapture;

	private bool AllPermissionsGranted
	{
		get
		{
			if (Services.Permissions.GetStatus(PermissionKind.Microphone) == PermissionStatus.Granted)
			{
				return Services.Permissions.GetStatus(PermissionKind.ScreenCapture) == PermissionStatus.Granted;
			}
			return false;
		}
	}

	public InterviewController? Interview { get; private set; }

	public bool IsPreSignInIntroShowing => intro?.IsShowing ?? false;

	private void WireAgentCostLedger(RealStack real)
	{
	}

	private void RefreshAgentCostLane(RealStack real)
	{
		AgentTurnCostLedger ledger = AgentCostLedger;
		if (ledger == null || ledger.HasReadCurrentLane || !real.Core.Auth.IsSignedIn || Interlocked.Exchange(ref agentCostLaneReadInFlight, 1) == 1)
		{
			return;
		}
		Task.Run(async () =>
		{
			try
			{
				AgentTurnCostLedger agentTurnCostLedger = ledger;
				agentTurnCostLedger.ApplyModelPolicy(await real.Core.Worker.GetRuntimeModelPolicyAsync().ConfigureAwait(continueOnCapturedContext: false));
			}
			catch (Exception ex)
			{
				Log.Warn("agent cost", "/runtime/model-policy: " + ex.Message);
			}
			finally
			{
				Interlocked.Exchange(ref agentCostLaneReadInFlight, 0);
			}
		});
	}

	private void StartAmbient()
	{
		Services.Agents.TasksChanged += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncAgentActivity);
		};
		ambientTimer = DispatcherQueue.CreateTimer();
		ambientTimer.Interval = TimeSpan.FromMilliseconds(500L, 0L);
		ambientTimer.IsRepeating = true;
		ambientTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			AmbientTick();
		};
		ambientTimer.Start();
		FocusWatch.Start();
		SyncAgentActivity();
		SyncDockedStrip();
	}

	private void SyncAgentActivity()
	{
		List<AgentTaskSnapshot> list = Services.Agents.Tasks.Where((AgentTaskSnapshot t) =>
		{
			AgentTaskStatus status = t.Status;
			return (uint)status <= 1u;
		}).ToList();
		string text = ((list.Count == 0) ? "" : string.Join("|", list.Select((AgentTaskSnapshot t) => t.TaskId + ":" + t.Title)));
		if (text == lastAgentSignature)
		{
			return;
		}
		lastAgentSignature = text;
		if (list.Count == 0)
		{
			Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.AgentMultiActivity));
			return;
		}
		string longestLabel = (from t in list
			select Clamp(t.Title) into t
			orderby t.Length descending
			select t).First();
		Services.Presenter.ShowLiveEvent(new NotchLiveEvent.AgentMultiActivity(longestLabel, list.Count));
		static string Clamp(string s)
		{
			s = s.Trim();
			if (s.Length > 25)
			{
				return s.Substring(0, 24) + "…";
			}
			return s;
		}
	}

	private void SyncDockedStrip()
	{
		if (Services.Settings.CursorDocked && !cursorDockFlightInProgress)
		{
			Services.Presenter.ShowLiveEvent(new NotchLiveEvent.DockedIdle());
		}
		else
		{
			Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.DockedIdle));
		}
	}

	private void AmbientTick()
	{
		TrackDockedStripCoverage();
		if (NotchView.IsAmbient(Services.Presenter.Presentation) && !NotchUi.IsHovering)
		{
			NotchUi.FollowCursorDisplay();
		}
		bool flag = QuietContext.IsFullscreenOn(NotchUi.MonitorHandle);
		if (flag != lastFullscreenOnNotch)
		{
			lastFullscreenOnNotch = flag;
			CorePresenter?.SetAmbientSuppressed(flag);
			NotchUi.SetAmbientHidden(flag);
			nint foregroundWindow = Native.GetForegroundWindow();
			Log.Info("notch", flag ? $"fullscreen app: ambient notch states hidden ({((foregroundWindow == 0) ? "nothing in front" : FullscreenGuard.Describe(foregroundWindow))}, {FullscreenGuard.NotificationState()})" : "fullscreen ended: ambient notch states back");
		}
		FullscreenGuard.GameWindow();
	}

	private void StartArtifactAutoOpen(RealStack real)
	{
		real.Agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			if (e.Kind == AgentTaskEventKind.Finished)
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					AutoOpenPrimaryArtifact(real, e.TaskId);
				});
			}
		};
		real.Tutorial.PropertyChanged += (object? _, PropertyChangedEventArgs e) =>
		{
			if (e.PropertyName == "IsEngaged")
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					if (!real.Tutorial.IsEngaged)
					{
						DrainHeldArtifactOpens(real);
					}
				});
			}
		};
	}

	private void AutoOpenPrimaryArtifact(RealStack real, string taskId)
	{
		try
		{
			AgentTaskDetail taskDetail = real.Agents.GetTaskDetail(taskId);
			if ((object)taskDetail == null || taskDetail.JobId != null || !autoOpenedTurns.Add($"{taskId}|{taskDetail.UserPrompts.Count}|{taskDetail.TurnId}"))
			{
				return;
			}
			string text = taskDetail.Artifacts.FirstOrDefault()?.Trim();
			if (!string.IsNullOrEmpty(text))
			{
				string clickySlug = taskDetail.ClickySlug;
				string text2 = ((clickySlug != null) ? (real.Agents.WorkspacePath(clickySlug) ?? taskDetail.WorkspacePath) : taskDetail.WorkspacePath);
				if (taskDetail.IsDemo || onboardingDemoTaskIds.ContainsKey(taskId))
				{
					Log.Info("agents", "artifact auto_open skipped for demo task " + taskId + ": " + text);
					return;
				}
				if (real.Tutorial.IsEngaged)
				{
					heldArtifactOpens.Add((taskId, text, text2));
					Log.Info("agents", "artifact auto_open held for the tour: " + text);
					return;
				}
				bool value = OpenAgentArtifact(taskId, text, text2);
				Log.Info("agents", $"artifact auto_open opened={value} task={taskId} artifact={text}");
			}
		}
		catch (Exception ex)
		{
			Log.Warn("agents", "artifact auto_open failed: " + ex.Message);
		}
	}

	private bool OpenAgentArtifact(string taskId, string artifact, string? workspace)
	{
		string text = ArtifactPaths.Resolve(artifact, workspace);
		if (ArtifactPaths.IsWebLink(text))
		{
			ChatBlockViews.OpenPath(text);
			FoldNotchForOpenedLink();
			return true;
		}
		if (!File.Exists(text) && !Directory.Exists(text))
		{
			return false;
		}
		if (OpenDocumentInNotch(text, Real?.Agents.GetTaskDetail(taskId)?.Snapshot.ThreadId))
		{
			return true;
		}
		ChatBlockViews.OpenPath(text);
		return true;
	}

	private void DrainHeldArtifactOpens(RealStack real)
	{
		if (heldArtifactOpens.Count == 0 || (object)heldArtifactDrain != null)
		{
			return;
		}
		heldArtifactDrain = DispatcherQueue.CreateTimer();
		heldArtifactDrain.Interval = TimeSpan.FromSeconds(10L);
		heldArtifactDrain.Tick += (DispatcherQueueTimer timer, object _) =>
		{
			if (real.Tutorial.IsEngaged || heldArtifactOpens.Count == 0)
			{
				timer.Stop();
				heldArtifactDrain = null;
			}
			else
			{
				var (taskId, text, workspace) = heldArtifactOpens[0];
				heldArtifactOpens.RemoveAt(0);
				bool value = OpenAgentArtifact(taskId, text, workspace);
				Log.Info("agents", $"artifact held_open opened={value} artifact={text}");
				if (heldArtifactOpens.Count == 0)
				{
					timer.Stop();
					heldArtifactDrain = null;
				}
			}
		};
		heldArtifactDrain.Start();
	}

	public bool ShowPaywall(PaywallSource source)
	{
		return billing?.ShowPaywall(source) ?? false;
	}

	public Task<bool> ShowOnboardingPaywallAsync()
	{
		return billing?.ShowOnboardingPaywallAsync() ?? Task.FromResult(result: false);
	}

	private void StartBilling(RealStack real)
	{
		BillingUi billingUi = new BillingUi(real.Core.Billing, real.Core.Worker, DispatcherQueue, OpenUrl, TuckAwayForPaywall, ExcludeFromCapture)
		{
			CanSayLine = () => Services.Settings.HasCompletedOnboarding && !real.Tutorial.IsEngaged && real.Companion.State == VoiceState.Idle,
			HoldShortcutDescription = () => Services.Settings.PushToTalkDisplay.ToLowerInvariant()
		};
		billingUi.CursorLine += SayBillingLine;
		billing = billingUi;
		Services.Billing = billingUi;
		real.Agents.PaywallReached += (object? _, AgentPaywallEventArgs e) =>
		{
			BillingPaywallDetector.HandleIfPaywall(e.StatusCode, Encoding.UTF8.GetBytes(e.Body), e.Presents);
		};
		real.Agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			AgentTaskEventKind kind = e.Kind;
			if ((kind == AgentTaskEventKind.Finished || kind == AgentTaskEventKind.Stopped) ? true : false)
			{
				_ = real.Core.Billing.RefreshAsync();
			}
		};
		real.Core.Billing.RefreshAsync();
	}

	private void TuckAwayForPaywall()
	{
		NotchPresentation presentation = Services.Presenter.Presentation;
		if ((presentation is NotchPresentation.TextInput || presentation is NotchPresentation.TextResponse) ? true : false)
		{
			Services.Presenter.Present(new NotchPresentation.Idle());
		}
		CorePresenter?.DismissNotchAgentPeek();
	}

	private void SayBillingLine(string line)
	{
		SayAtCursorAsync(line, streamed: true, 5.0);
	}

	private void StartBrowserConnection(RealStack real)
	{
		ClickyBrowserBridge bridge = ClickyBrowserBridge.Shared;
		ChromeSetupFlow flow = ChromeSetupFlow.Shared;
		AgentService agents = real.Agents;
		if (NoteClickyEventForOneBrain == null)
		{
			Action<string, string> action = (NoteClickyEventForOneBrain = (string threadId, string eventText) =>
			{
				NoteJobEventForOneBrain(real, threadId, eventText);
			});
		}
		bridge.CursorColorHex = () => Services.Settings.CursorColorHex;
		bridge.OpenInBrowserExecutable = ChromeInternalPages.Open;
		bridge.ScreenDriveIsAvailable = () => flow.Drive?.IsAvailable ?? false;
		flow.Attach(this);
		bridge.ThreadSkipsChrome = flow.SkipsChrome;
		bridge.AgentTurnLookup = (string thread, string turn) =>
		{
			AgentBrowserTurn agentBrowserTurn = agents.BrowserTurn(thread, turn);
			return ((object)agentBrowserTurn == null) ? null : new BrowserTurnContext(agentBrowserTurn.Title, ClickyBrowserBridge.GroupTitle(agentBrowserTurn.GroupLabel), ClickyBrowserBridge.ProgressLine(agentBrowserTurn.LatestCommentary, agentBrowserTurn.ThinkingHeading), agentBrowserTurn.IsActive);
		};
		agents.BrowserMcpServerProvider = (CancellationToken _) =>
		{
			(string, string)? tuple = bridge.EnsureAgentEndpoint();
			object result;
			if (tuple.HasValue)
			{
				(string, string) valueOrDefault = tuple.GetValueOrDefault();
				result = new AgentHarnessMcpServer("clicky_browser", valueOrDefault.Item1, valueOrDefault.Item2);
			}
			else
			{
				result = null;
			}
			return Task.FromResult((AgentHarnessMcpServer)result);
		};
		agents.BrowserTurnEnded += bridge.Finish;
		agents.BrowserAccessShouldStop += bridge.StopAccess;
		bridge.AgentNeedsChromeConnection += agents.MarkNeedsChromeConnection;
		agents.TaskNeedsChromeConnection += (string thread) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				flow.JobNeedsChrome(thread);
			});
		};
		agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			AgentTaskEventKind kind = e.Kind;
			if ((uint)(kind - 8) <= 2u)
			{
				string thread = agents.GetTaskDetail(e.TaskId)?.Snapshot.ThreadId;
				DispatcherQueue.TryEnqueue(() =>
				{
					flow.TurnEnded(thread);
				});
			}
		};
		bridge.DevelopmentSetupOpened += (string browserName) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				if (!flow.IsBusy)
				{
					SayAtCursorAsync("in " + browserName.ToLowerInvariant() + ", turn on developer mode (top right), then drag the heyclicky folder from explorer onto the page", streamed: true, 16.0);
				}
			});
		};
		bridge.ExtensionConnected += (bool isFirstConnection) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				SayAtCursorAsync(isFirstConnection ? "chrome's connected! i can use the sites you're signed into now ^_^" : "chrome's connected again", streamed: true, 7.0);
			});
		};
		bridge.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				NotchSettingsTab.ShownContent?.OnBrowserConnectionChanged();
			});
		};
		flow.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				NotchSettingsTab.ShownContent?.OnBrowserConnectionChanged();
			});
		};
		Task.Run((Func<Task?>)bridge.StartIfEnabledAsync);
		if (openBrowserSettingsWhenReady)
		{
			DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () =>
			{
				openBrowserSettingsWhenReady = false;
				OpenBrowserSettings();
			});
		}
	}

	private void NoteJobEventForOneBrain(RealStack real, string threadId, string eventText)
	{
		AgentService agents = real.Agents;
		string text = agents.TaskIdForThread(threadId);
		if (text == null)
		{
			return;
		}
		AgentTaskDetail taskDetail = agents.GetTaskDetail(text);
		if ((object)taskDetail == null || taskDetail.IsDemo)
		{
			return;
		}
		real.Core.BrainSession.DropNoteForNextTurn(ClickyNotes.ProgressNoteKey(taskDetail.ClickySlug, threadId, text));
		object obj;
		if (ClickyJobsPreferences.IsEnabled)
		{
			string text2 = taskDetail.JobId ?? agents.Jobs.JobForThread(threadId)?.Id;
			if (text2 != null)
			{
				ClickyJob clickyJob = agents.Jobs.Job(text2);
				if ((object)clickyJob != null)
				{
					string title = clickyJob.Title;
					if (title != null && title.Length > 0)
					{
						obj = title;
						goto IL_00b8;
					}
				}
			}
			obj = taskDetail.ClickyName ?? taskDetail.Snapshot.Title;
			goto IL_00b8;
		}
		real.Core.BrainSession.NoteForNextTurn(ClickyNotes.EventNote(taskDetail.ClickyName, taskDetail.ClickySlug, taskDetail.Snapshot.Title, eventText, null));
		return;
		IL_00b8:
		string name = (string)obj;
		real.Core.BrainSession.NoteForNextTurn(ClickyNotes.JobEventNote(name, threadId, eventText, null));
	}

	private void OpenBrowserSettings()
	{
		OpenSettings(NotchSettingsSection.Integrations);
	}

	internal void AnnounceJobNeedsChrome(string threadId)
	{
		string text = Real?.Agents.GetTaskDetail(Real.Agents.TaskIdForThread(threadId) ?? "")?.Snapshot.Title.Trim() ?? "";
		NoteClickyEventForOneBrain?.Invoke(threadId, "is waiting for them to choose about connecting their Chrome");
		Services.Audio.PlayEarcon("agentNeedsYou");
		AnnounceLineAsync(ChromeSetupFlow.NeedsChromeLine((text.Length == 0) ? null : text, ChromeSetupFlow.Shared.CanDoItForThem));
		PresentTaskNeedsYou(threadId);
	}

	internal void PresentTaskNeedsYou(string threadId)
	{
		Action<string> presentTaskNeedsYouHook = PresentTaskNeedsYouHook;
		if (presentTaskNeedsYouHook != null)
		{
			presentTaskNeedsYouHook(threadId);
		}
		else
		{
			Log.Info("Browser", "needs-you card for " + threadId + ": no dock on Windows yet");
		}
	}

	internal void DismissCurrentNotchCard()
	{
		DismissNotchUpdateHook?.Invoke();
	}

	internal void ClearDrawing()
	{
		Real?.Canvas.Clear();
	}

	internal Task<bool> AnnounceLineAsync(string line)
	{
		return Real?.Companion.AnnounceAsync(line) ?? Task.FromResult(result: false);
	}

	internal void StartAppFactTurn(string fact)
	{
		Real?.Companion.SubmitFactAsync(fact);
	}

	private bool HandleBrowserDeepLink(Uri uri)
	{
		if (uri.Host.ToLowerInvariant() == "settings" && uri.AbsolutePath.TrimEnd('/') == "/browser")
		{
			RealStack real = Real;
			if (real != null && !real.IsComplete)
			{
				openBrowserSettingsWhenReady = true;
				return true;
			}
			DispatcherQueue.TryEnqueue(OpenBrowserSettings);
			return true;
		}
		return false;
	}

	private void StartBundle(RealStack real)
	{
		real.Agents.DeveloperModelSelection = (string slug) =>
		{
			string text = Services.Auth.User?.Email;
			return (text == null || text.Length <= 0) ? (((string, string)?)null) : DeveloperChatModels.Load(real.Core.Settings, text, slug);
		};
		BillingUi billingUi = billing;
		if (billingUi != null)
		{
			billingUi.PaywallShown += (PaywallSource source, PaywallPayload _) =>
			{
				if (source == PaywallSource.LimitHit)
				{
					DispatcherQueue.TryEnqueue(PresentPaywallIntroVideoIfNeeded);
				}
			};
			billingUi.PaywallClosed += (PaywallSource _, PaywallCloseKind _) =>
			{
				DispatcherQueue.TryEnqueue(DismissPaywallIntroVideo);
			};
		}
		if (!AppPaths.IsOverridden)
		{
			Task.Run(() =>
			{
				try
				{
					FileOpenRegistration.Register();
				}
				catch (Exception ex)
				{
					Log.Warn("startup", "open-with registration: " + ex.Message);
				}
			});
		}
		List<string> list = HandedFilesIn(Program.Args);
		if (list != null && list.Count > 0)
		{
			OpenHandedFilesWhenReadyAsync(list);
		}
	}

	public void PresentPaywallIntroVideoIfNeeded()
	{
		RealStack real = Real;
		if (real == null || real.Core.Settings.Read((AppSettings s) => s.HasShownPaywallIntroVideo) || CursorCompanion.IsPlayingVideo)
		{
			return;
		}
		string path = AssetPath("Video", "paywall-intro-v2.mp4");
		if (CursorCompanion.PlayVideo(path, Array.Empty<CursorCompanion.Cue>(), () =>
		{
			paywallIntroVideoPlaying = false;
			Log.Info("video", "paywall intro over");
		}, 1.0, 15.0, 0.0, onboardingAnalytics: false))
		{
			paywallIntroVideoPlaying = true;
			real.Core.Settings.Update((AppSettings s) =>
			{
				s.HasShownPaywallIntroVideo = true;
			});
			Log.Info("video", "paywall intro video presented");
		}
	}

	private void DismissPaywallIntroVideo()
	{
		if (paywallIntroVideoPlaying)
		{
			paywallIntroVideoPlaying = false;
			CursorCompanion.DismissVideo();
		}
	}

	public void ResetPaywallIntroVideo()
	{
		Real?.Core.Settings.Update((AppSettings s) =>
		{
			s.HasShownPaywallIntroVideo = false;
		});
		Log.Info("video", "paywall intro video reset");
	}

	public void PreviewOnboardingPaywall()
	{
		BillingUi billingUi = billing;
		if (billingUi != null)
		{
			PlanSnapshot plan = billingUi.State.Plan;
			PaywallPayload paywallPayload = PaywallPayloads.ManualUpgrade("free", plan?.ProAgentsCap, plan?.MaxAgentsCap, plan?.ProYearlyAvailable == true, plan?.MaxYearlyAvailable == true);
			if ((object)paywallPayload == null)
			{
				Log.Warn("Billing", "preview paywall: no payload");
			}
			else
			{
				billingUi.ShowPaywall(paywallPayload, PaywallSource.DeveloperOnboardingPreview);
			}
		}
	}

	public void PopSuggestionsNotchForDemo()
	{
		ProactiveCoordinator current = ProactiveCoordinator.Current;
		if (current != null)
		{
			current.PreviewMorningNotch();
		}
		else
		{
			Log.Warn("proactive", "suggestions notch demo: no suggestions lane");
		}
	}

	public void PresentNewAgentsUiDemo()
	{
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null && tutorialWindow.IsRunning)
		{
			tutorialWindow.BringForward();
			return;
		}
		CorePresenter?.DismissNotchAgentPeek();
		if (tutorial == null)
		{
			tutorial = CreateTutorial();
		}
		newAgentsUiDemoRun = true;
		RealStack real = Real;
		if (real != null)
		{
			real.Tutorial.SkipsDrawingSteps = true;
		}
		Interview.UsesNewAgentsUiDemoPlan = true;
		StarterCast.Outfit();
		tutorial.Show(TutorialWindow.Step.VoiceHello);
		Log.Info("tutorial", "new agents UI demo: tour opened on voice hello; drawing steps skipped; fixed starter set");
	}

	private void EndNewAgentsUiDemoRun()
	{
		if (newAgentsUiDemoRun)
		{
			newAgentsUiDemoRun = false;
			RealStack real = Real;
			if (real != null)
			{
				real.Tutorial.SkipsDrawingSteps = false;
			}
			InterviewController interview = Interview;
			if (interview != null)
			{
				interview.UsesNewAgentsUiDemoPlan = false;
			}
		}
	}

	private static List<string> HandedFilesIn(IEnumerable<string> args)
	{
		return (from a in args
			where !a.StartsWith("--", StringComparison.Ordinal) && !a.Contains("://", StringComparison.Ordinal)
			select a.Trim('"') into a
			where a.Length > 2 && Path.IsPathRooted(a) && File.Exists(a)
			select a).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
	}

	private bool OpenHandedFiles(IEnumerable<string> args)
	{
		List<string> list = HandedFilesIn(args);
		if (list.Count == 0)
		{
			return false;
		}
		OpenHandedFilesWhenReadyAsync(list);
		return true;
	}

	private async Task OpenHandedFilesWhenReadyAsync(IReadOnlyList<string> files)
	{
		for (int i = 0; i < 100; i++)
		{
			RealStack real = Real;
			if (real == null || real.IsComplete)
			{
				break;
			}
			await Task.Delay(100);
		}
		DispatcherQueue.TryEnqueue(() =>
		{
			OpenFilesHandedToHeyClicky(files);
		});
	}

	private void OpenFilesHandedToHeyClicky(IReadOnlyList<string> files)
	{
		RealStack real = Real;
		bool flag = real != null && real.Core.Auth.IsSignedIn && Services.Settings.HasCompletedOnboarding;
		foreach (string file in files)
		{
			Log.Info("notch", $"file handed over: {Path.GetFileName(file)} (notch viewer: {flag})");
			if (!flag || !OpenDocumentInNotch(file, null))
			{
				OpenOutsideHeyClicky(file);
			}
		}
	}

	private static void OpenOutsideHeyClicky(string file)
	{
		try
		{
			string text = FileOpenRegistration.DefaultHandlerFor(file);
			if (text != null)
			{
				string processPath = Environment.ProcessPath;
				if (processPath != null && string.Equals(Path.GetFullPath(text), Path.GetFullPath(processPath), StringComparison.OrdinalIgnoreCase))
				{
					goto IL_002d;
				}
			}
			if (text != null)
			{
				ShellOpen.Start(file);
				return;
			}
			goto IL_002d;
			IL_002d:
			Process.Start(new ProcessStartInfo("rundll32.exe", "shell32.dll,OpenAs_RunDLL " + file)
			{
				UseShellExecute = false
			});
		}
		catch (Exception ex)
		{
			Log.Warn("notch", "open " + Path.GetFileName(file) + " outside: " + ex.Message);
		}
	}

	public void AnswerIntegrationSuggestion(string toolkit, IntegrationAnswer answer)
	{
		Log.Info("integrations", $"suggestion for {toolkit}: {answer}");
		ProactiveCoordinator proactive = Proactive;
		if (proactive != null)
		{
			proactive.AnswerIntegrationSuggestion(toolkit, answer);
		}
		else
		{
			Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.IntegrationSuggestion));
		}
	}

	public void RemoveDictionaryWord(string word)
	{
		Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.DictionaryWordLearned));
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		real.Core.Settings.Update((AppSettings s) =>
		{
			s.DictationCustomWords.RemoveAll((string w) => string.Equals(w, word, StringComparison.OrdinalIgnoreCase));
		});
		Log.Info("dictation", "removed \"" + word + "\" from the dictionary");
	}

	public void RestoreOutputVolume()
	{
		Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.VoiceReplyMutedCopiedToClipboard));
		Task.Run(() => SystemAudioOutputVolume.RestoreAudibleOutput());
	}

	public void ResumeTutorial()
	{
		Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.OnboardingTutorialResume));
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null)
		{
			if (tutorialWindow.IsRunning)
			{
				ClickyAnalytics.TrackOnboardingTutorialResumedFromNotch();
			}
			tutorialWindow.BringForward();
		}
		else
		{
			StartTutorial();
		}
	}

	private void ShowTutorialResumeCard()
	{
		NotchUi.SizeContext.TutorialResumeShowsContinue = tutorial?.IsBuried ?? true;
		Services.Presenter.ShowLiveEvent(new NotchLiveEvent.OnboardingTutorialResume());
		NotchUi.HoverChanged -= DismissResumeOnHoverOut;
		NotchUi.HoverChanged += DismissResumeOnHoverOut;
	}

	private void DismissResumeOnHoverOut(bool hovering)
	{
		if (!hovering)
		{
			NotchUi.HoverChanged -= DismissResumeOnHoverOut;
			Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.OnboardingTutorialResume));
		}
	}

	public void SendAgentFollowUp(string taskId, string text, IReadOnlyList<string> files)
	{
		string text2 = ((files.Count == 0) ? text : (((text.Length > 0) ? (text + "\n\n") : "") + "Attached files:\n" + string.Join("\n", files.Select((string f) => "- " + f))));
		Log.Info("agents", $"notch follow-up to {taskId} ({text.Length} chars, {files.Count} file(s))");
		Services.Agents.SteerAsync(taskId, text2).ContinueWith((Task t) =>
		{
			if (t.IsFaulted)
			{
				Log.Warn("agents", "notch follow-up to " + taskId + " failed: " + t.Exception?.GetBaseException().Message);
			}
		}, TaskScheduler.Default);
	}

	public AppHost(AppServices services, AppOptions options, RealStack? real)
	{
		Services = services;
		Options = options;
		Real = real;
		DispatcherQueue = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
		if (options.UseFakes)
		{
			ClickyRoster.UseDirectory(AppPaths.Combine("demo"));
		}
		ClickyRoster.Shared.AssignedPackId = () => services.Settings.SquadPack;
	}

	public void Start()
	{
		Anim.Instant = Snapshot.Directory != null;
		ComposerBox.CalibrateLineHeight();
		NotchUi = new NotchView(Services, this, !Options.AllowCapture);
		ScreenCaptureYield.Register(NotchUi.Window.Hwnd);
		SingleInstance.NoteMainWindow(NotchUi.Window.Hwnd);
		ScreenDrawingCanvas screenDrawingCanvas = Real?.Canvas;
		if (screenDrawingCanvas != null)
		{
			nint notchWindow = NotchUi.Window.Hwnd;
			screenDrawingCanvas.NotchWindowProvider = () => notchWindow;
		}
		NotchUi.FirstFrameShown += () =>
		{
			Log.Info("startup", $"cold start → notch visible: {Program.MillisecondsSinceProcessStart():0} ms (since Main: {Program.SinceStart.Elapsed.TotalMilliseconds:0} ms)");
			RealStack real2 = Real;
			if (real2 != null)
			{
				DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Normal, () =>
				{
					CompleteRealServices(real2);
				});
			}
		};
		ShellOpen.UserIsTypingInHeyClicky = () => NotchUi.HasKeyboard;
		NotchUi.HoverDwellCompleted += OnNotchHoverDwell;
		NotchUi.HoverChanged += (bool inside) =>
		{
			notchWindowHovered = inside;
			SyncPointerOnNotch();
		};
		NotchUi.IdleClicked += OnNotchIdleClicked;
		RealStack? real = Real;
		if (real != null && real.Core.Settings.Read((AppSettings s) => s.StreamMode))
		{
			NotchUi.SetStreamMode(on: true);
		}
        if(HeyClicky.App.Cody.CodyEngineBridge.EngineMode && Real!=null){
            NotchUi.EnterEngineMode();
            DispatcherQueue.TryEnqueue(()=>CompleteRealServices(Real));
            return;
        }
		NotchUi.Show();
		Uri deepLink = Options.DeepLink;
		if ((object)deepLink != null)
		{
			if (Real == null)
			{
				HandleDeepLinkSafely(deepLink);
			}
			else
			{
				pendingLaunchArgs.Add(Program.Args);
			}
		}
		if (Real == null)
		{
			bridge = new CompanionNotchBridge(Services, DispatcherQueue);
			StartNotch();
			Services.Shortcuts.Start();
			StartAuxiliary();
			StartAmbient();
			if (!HeyClicky.App.Cody.CodyEngineBridge.EngineMode) StartCursorModes();
			if (Options.DemoStates || Options.DemoOnly != null)
			{
				new DemoRunner(this).Run(Options.DemoOnly);
			}
			else
			{
				DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, StartFirstRunFlow);
			}
		}
	}

	private void OnNotchIdleClicked()
	{
		if (DrawnOnboardingTour.HoldsNotch)
		{
			DrawnOnboardingTour.NudgeNotchClicked(this);
		}
		else if (!introSequenceActive)
		{
			OpenNotchHome();
		}
	}

	internal void SimulateNotchIdleClick()
	{
		OnNotchIdleClicked();
	}

	private void CompleteRealServices(RealStack real)
	{
        if(realServicesStarted)return;
        realServicesStarted=true;
		try
		{
			real.Complete(DispatcherQueue, SynchronizationContext.Current);
			CompositionRoot.FillFromRealStack(Services, real);
			string codyVoiceMarker = Path.Combine(HeyClicky.App.Cody.CodyPaths.StateRoot, "cody-voice-initialized");
			if (!File.Exists(codyVoiceMarker)) { Services.Settings.LibraryModeEnabled = true; File.WriteAllText(codyVoiceMarker, "HeyClicky voice replies enabled for C.O.D.Y.; change with the Voice button."); }
			hotkeys = new HotkeyRouter(Services, real, DispatcherQueue);
			WireRealServices(real);
			StartBrowserConnection(real);
			StartClickyDrive(real);
			StartSystemServices(real);
			StartDock(real);
			StartNotch();
			StartProactive(real);
			StartDrawnTour(real);
			StartAuxiliary();
			StartApplyingSettings();
			StartInkNotes(real);
			StartAmbient();
			if (!HeyClicky.App.Cody.CodyEngineBridge.EngineMode) StartCursorModes();
			if (!HeyClicky.App.Cody.CodyEngineBridge.EngineMode) StartTaskbarButton(real);
			StartNotchPolish(real);
			StartArtifactAutoOpen(real);
			cursorShownForOnboarding = HasCompletedOnboardingNow;
			real.StartBackground(Services.Settings.CursorColorHex, cursorShownForOnboarding && !HeyClicky.App.Cody.CodyEngineBridge.EngineMode);
			real.Core.Settings.Changed += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(SyncCursorWithOnboarding);
			};
			Log.Info("startup", $"all services up: {Program.MillisecondsSinceProcessStart():0} ms since process start");
		}
		catch (Exception ex)
		{
			Log.Error("startup", "real services failed to start", ex);
		}
		realServicesStarted = true;
		HeyClicky.App.Cody.CodyEngineBridge.Start(this);
		HeyClicky.App.Cody.CodySmoke.Run(this);
		if (Program.Args.Contains("--cody-chat")) DispatcherQueue.TryEnqueue(() => ShowInChat(null, null));
		foreach (string[] pendingLaunchArg in pendingLaunchArgs)
		{
			HandleForwardedArgs(pendingLaunchArg);
		}
		pendingLaunchArgs.Clear();
		DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, StartFirstRunFlow);
		string scenario = Options.E2E;
		if (scenario != null)
		{
			DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () =>
			{
				new EndToEnd(this).RunAsync(scenario);
			});
		}
	}

	private void SyncCursorWithOnboarding()
	{
		if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return;
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		bool hasCompletedOnboardingNow = HasCompletedOnboardingNow;
		if (hasCompletedOnboardingNow != cursorShownForOnboarding)
		{
			cursorShownForOnboarding = hasCompletedOnboardingNow;
			if (hasCompletedOnboardingNow)
			{
				real.Cursor.Show();
			}
			else
			{
				real.Cursor.Hide();
			}
			Log.Info("cursor", hasCompletedOnboardingNow ? "onboarding complete: companion cursor shown" : "onboarding reset: companion cursor hidden");
		}
	}

	private void WireRealServices(RealStack real)
	{
		if (real.Microphone is WasapiMicrophoneCapture wasapiMicrophoneCapture)
		{
			wasapiMicrophoneCapture.Trouble += (string? message) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					if (message == null)
					{
						Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.MicrophoneTrouble));
					}
					else
					{
						Services.Presenter.ShowLiveEvent(new NotchLiveEvent.MicrophoneTrouble(message));
					}
				});
			};
		}
		accountWasSignedIn = real.Core.Auth.IsSignedIn;
		real.Core.Auth.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(OnAuthChanged);
		};
		real.Companion.UnhandledDrawingAction += (object? _, DrawingAction action) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				OnDrawingAction(action);
			});
		};
		real.Companion.Failed += (object? _, CompanionError error) =>
		{
			Log.Warn("companion", "failed: " + error.Code + ": " + error.Message);
		};
		real.Companion.TurnCompleted += (object? _, CompanionTurnMetrics m) =>
		{
			NoteTurnKind(m.Typed);
		};
		real.Companion.TurnCompleted += (object? _, CompanionTurnMetrics m) =>
		{
			Log.Info("latency", $"turn {(m.Typed ? "typed" : "voice")}: transcript {m.TranscriptMs} ms, capture {m.CaptureMs} ms, brain first byte {m.BrainFirstByteMs} ms, first say line {m.FirstSayLineMs} ms, first audio {m.FirstAudioMs} ms, first spoken {m.FirstSpokenMs} ms, total {m.TotalMs} ms ({m.Model})");
		};
		real.Tutorial.PropertyChanged += (object? _, PropertyChangedEventArgs e) =>
		{
			bool flag;
			switch (e.PropertyName)
			{
			case "IsRestrictingNormalUse":
			case "Phase":
			case "CurrentStep":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag)
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					CorePresenter?.SetTutorialRestrictingNormalUse(real.Tutorial.IsRestrictingNormalUse);
				});
			}
		};
		if (hotkeys != null)
		{
			hotkeys.AllowsPushToTalk = () => AllowsShortcut(real, text: false);
			hotkeys.AllowsTextMode = () => AllowsShortcut(real, text: true);
			hotkeys.InterceptReleaseAfterPress = () =>
			{
				TutorialWindow t = tutorial;
				if (t == null || !t.IsOnDriveStep)
				{
					return false;
				}
				DispatcherQueue.TryEnqueue(() =>
				{
					t.InterceptPushToTalkRelease();
				});
				return true;
			};
		}
		WireRoutinePower(real);
		StartBilling(real);
		StartBundle(real);
		oneBrainStatsPanel = new OneBrainStatsPanel(real.Core.Settings, !Options.AllowCapture);
		oneBrainStatsPanel.Start();
	}

	private bool AllowsShortcut(RealStack real, bool text)
	{
		if (!text && RoutedPressToMicrophonePermissionCard(real))
		{
			return false;
		}
		if (real.Tutorial.Phase == OnboardingTutorialPhase.InvitePresented)
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				if (real.Tutorial.Phase == OnboardingTutorialPhase.InvitePresented)
				{
					ClickyAnalytics.TrackOnboardingTutorialResolved(text ? "invite_bypassed_by_text" : "invite_bypassed_by_ptt", null);
				}
				real.Tutorial.BypassInvite();
				Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.OnboardingTutorialInvite));
			});
			return true;
		}
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null && tutorialWindow.IsDriveDemoDriving)
		{
			return false;
		}
		if (TourHoldsHome || introSequenceActive)
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				TourRefusal("sorry, i'll let you use the shortcut right after i'm done!");
			});
			return false;
		}
		if (!text)
		{
			return real.Tutorial.AllowsPushToTalk;
		}
		return real.Tutorial.AllowsTextMode;
	}

	internal bool RoutedPressToMicrophonePermissionCard(RealStack real)
	{
		if (!Services.Settings.HasCompletedOnboarding)
		{
			return false;
		}
		PermissionStatus permissionStatus = real.Permissions.RefreshMicrophoneStatus();
		if ((permissionStatus != PermissionStatus.WaitingInSettings && permissionStatus != PermissionStatus.Denied) || 1 == 0)
		{
			return false;
		}
		Log.Info("permissions", $"a press with the microphone {permissionStatus}: the permission card instead of a turn");
		DispatcherQueue.TryEnqueue(() =>
		{
			NotchOnboardingCardViewModel notchOnboardingCardViewModel = CardVm;
			if (notchOnboardingCardViewModel != null)
			{
				notchOnboardingCardViewModel.Refresh();
				SyncOnboardingPin();
				if (notchOnboardingCardViewModel.Kind == NotchOnboardingCardKind.Permission)
				{
					int? num = CardStep(notchOnboardingCardViewModel);
					if (num.HasValue)
					{
						int valueOrDefault = num.GetValueOrDefault();
						Services.Presenter.Present(new NotchPresentation.OnboardingPinned(valueOrDefault));
					}
				}
			}
		});
		return true;
	}

	private void OnAuthChanged()
	{
		RealStack real = Real;
		if (real != null)
		{
			bool isSignedIn = real.Core.Auth.IsSignedIn;
			Log.Info("auth", isSignedIn ? ("signed in as " + real.Core.Auth.User?.Email) : "signed out");
			OnboardingAuthChanged(isSignedIn);
			if (isSignedIn)
			{
				NoteAccountSignedIn();
				real.PrewarmAgents();
				real.Core.StartAsync();
				real.BrainContext.Refresh();
				ConnectedApps.RefreshAsync();
				ConnectorAuth.OnLaunchAsync();
				ClaimPendingReferralCodeAsync();
				real.Companion.Prewarm();
			}
			else
			{
				real.Agents.SignOutAsync();
				ForgetSignedOutAccount(real);
			}
		}
	}

	private void OnDrawingAction(DrawingAction action)
	{
		string kind = action.Kind;
		if (!(kind == "button"))
		{
			if (kind == "figurePart")
			{
				string text = Str(action.Payload, "name") ?? "this part";
				string text2 = ((action.Payload.ValueKind == JsonValueKind.Object && action.Payload.TryGetProperty("isLabelled", out var value) && value.ValueKind == JsonValueKind.True) ? ("the part labelled \"" + text + "\"") : text);
				Log.Info("drawing", "3D part clicked: " + text2);
				Services.Companion.AskFromDrawingAsync("What's this? (I just clicked " + text2 + " on the 3D model you drew.)", "figure_part");
			}
			else if (!HandleTourDrawingAction(action))
			{
				Log.Info("drawing", "unhandled drawing action " + action.Kind);
			}
			return;
		}
		string text3 = Str(action.Payload, "kind") ?? "ask";
		string text4 = Str(action.Payload, "text");
		string text5 = Str(action.Payload, "value");
		Log.Info("drawing", $"button pressed: \"{text4}\" ({text3})");
		if (text3 == "card")
		{
			if (Guid.TryParse(text5, out var result) && (object)Proactive?.Approve(result, null, announce: false) != null)
			{
				Real?.Core.BrainSession.NoteForNextTurn("[clicky drawing] The user pressed \"" + text4 + "\" on the drawing, which started that suggested task in the background.");
			}
		}
		else if (text3.Equals("handoff", StringComparison.OrdinalIgnoreCase))
		{
			RealStack real = Real;
			if (real != null)
			{
				string text6 = AgentTools.HandOffArguments(text5 ?? text4 ?? "");
				if (text6 != null)
				{
					real.Tools.Agents.RunAsync("sessions_spawn", new ToolArgs(text6), CompanionToolContext.None).ContinueWith((Task<string> t) =>
					{
						Log.Info("drawing", "hand-off: " + (t.IsCompletedSuccessfully ? t.Result : t.Exception?.GetBaseException().Message));
					}, TaskScheduler.Default);
					return;
				}
			}
			string text7 = text5 ?? text4;
			if (text7 != null && text7.Length > 0)
			{
				Services.Agents.LaunchAsync(text7);
			}
		}
		else
		{
			string text8 = text5 ?? text4;
			if (text8 != null && text8.Length > 0)
			{
				Services.Companion.AskFromDrawingAsync(text8, "button");
			}
		}
		static string? Str(JsonElement e, string name)
		{
			if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var value2) || value2.ValueKind != JsonValueKind.String)
			{
				return null;
			}
			return value2.GetString();
		}
	}

	public void HandleForwardedArgs(string[] args)
	{
		if (Real != null && !realServicesStarted)
		{
			pendingLaunchArgs.Add(args);
			return;
		}
		AppOptions appOptions = AppOptions.Parse(args);
		if (!OpenHandedFiles(args))
		{
			Uri deepLink = appOptions.DeepLink;
			if ((object)deepLink != null)
			{
				HandleDeepLinkSafely(deepLink);
			}
			else if (appOptions.Background)
			{
				Log.Info("app", "second launch at login: staying quiet");
			}
			else
			{
				HandleReopen();
			}
		}
	}

	private void HandleDeepLinkSafely(Uri uri)
	{
		try
		{
			HandleDeepLink(uri);
		}
		catch (Exception exception)
		{
			CrashReporting.ReportUiException(exception);
		}
	}

	private void HandleDeepLink(Uri uri)
	{
		Log.Info("deeplink", uri.Scheme + "://" + uri.Host + uri.AbsolutePath);
		if (Real == null || !HandleBrowserDeepLink(uri))
		{
			if (uri.Host.Equals("settings", StringComparison.OrdinalIgnoreCase))
			{
				OpenSettings(uri.AbsolutePath.TrimEnd('/').Equals("/browser", StringComparison.OrdinalIgnoreCase) ? NotchSettingsSection.Integrations : NotchSettingsSection.Account);
			}
			else if (uri.Host.Equals("tutorial", StringComparison.OrdinalIgnoreCase))
			{
				StartTutorial();
			}
			else if (uri.Host.Equals("auth-callback", StringComparison.OrdinalIgnoreCase) || !HandleSystemDeepLink(uri))
			{
				HandleAccountLinkAsync(uri);
			}
		}
	}

	private async Task HandleAccountLinkAsync(Uri uri)
	{
		_ = 2;
		try
		{
			if (await Services.Auth.HandleDeepLinkAsync(uri))
			{
				return;
			}
			CheckoutCompleteLink checkout = WorkerClient.ParseCheckoutCompleteLink(uri);
			if ((object)checkout != null)
			{
				Log.Info("deeplink", $"checkout complete: {checkout}");
				for (int i = 0; i < 100; i++)
				{
					if (billing != null)
					{
						break;
					}
					if (Real == null)
					{
						break;
					}
					await Task.Delay(100);
				}
				BillingUi b = billing;
				if (b != null)
				{
					DispatcherQueue.TryEnqueue(() =>
					{
						b.HandleCheckoutComplete(checkout);
					});
					return;
				}
				RealStack real = Real;
				if (real != null)
				{
					await real.Core.Billing.HandleCheckoutCompleteAsync(checkout);
				}
			}
			else
			{
				Log.Info("deeplink", "unhandled link: " + uri.Scheme + "://" + uri.Host);
			}
		}
		catch (Exception ex)
		{
			Log.Warn("deeplink", ex.Message);
		}
	}

	public void OpenUrl(string url)
	{
		try
		{
			ShellOpen.Start(url);
		}
		catch (Exception ex)
		{
			Log.Warn("app", "open url failed: " + ex.Message);
		}
	}

	public void SetPaused(bool paused)
	{
		Services.Settings.IsPaused = paused;
		if (paused)
		{
			Services.Companion.Cancel();
			Services.Presenter.Present(new NotchPresentation.Idle());
		}
	}

	public async void Quit()
	{
		if (quitting)
		{
			return;
		}
		quitting = true;
		Log.Info("app", "quit");
		SingleInstance.Release();
		Stopwatch quitStarted = Stopwatch.StartNew();
		Thread thread = new Thread(() =>
		{
			Thread.Sleep(TimeSpan.FromSeconds(15L));
			Log.Warn("shutdown", $"still running {quitStarted.Elapsed.TotalSeconds:0} s after quit: terminating now");
			Program.Terminate();
		});
		thread.IsBackground = true;
		thread.Name = "QuitWatchdog";
		thread.Start();
		Step("letting go of keys a drive left down", () =>
		{
			ClickyScreenActuator.ReleaseStrandedKeys("quitting");
		});
		Step("stopping hotkeys", () =>
		{
			hotkeys?.Dispose();
		});
		Step("stopping the notch bridge", () =>
		{
			bridge?.Dispose();
		});
		Step("stopping proactive", () =>
		{
			Proactive?.Dispose();
		});
		Step("stopping shortcuts", () =>
		{
			if (Services.Shortcuts != null)
			{
				Services.Shortcuts.Stop();
			}
		});
		Step("stopping the tray", DisposeAuxiliary);
		Step("stopping updates", () =>
		{
			updates?.ApplyOnQuitIfReady();
			updates?.Dispose();
		});
		Log.Info("shutdown", "flushing analytics");
		try
		{
			await Task.WhenAny(ClickyAnalytics.FlushAsync(), Task.Delay(2000));
		}
		catch
		{
		}
		Log.Info("shutdown", "flushing crash reports");
		try
		{
			await CrashReporter.Current.FlushAsync(TimeSpan.FromSeconds(2L));
		}
		catch
		{
		}
		RealStack real = Real;
		if (real != null)
		{
			Log.Info("shutdown", "disposing services");
			try
			{
				await real.DisposeAsync();
			}
			catch (Exception ex)
			{
				Log.Warn("shutdown", ex.Message);
			}
		}
		Log.Info("shutdown", $"services stopped in {quitStarted.ElapsedMilliseconds} ms; exiting");
		Application.Current.Exit();
		Task.Delay(1500).ContinueWith((Task _) =>
		{
			Log.Info("shutdown", "exited");
			Program.Exit();
		}, TaskScheduler.Default);
		static void Step(string what, Action stop)
		{
			Log.Info("shutdown", what);
			try
			{
				stop();
			}
			catch (Exception ex2)
			{
				Log.Warn("shutdown", what + ": " + ex2.Message);
			}
		}
	}

	public Task SayAtCursorAsync(string text, bool streamed = true, double holdSeconds = 6.0, CancellationToken ct = default(CancellationToken))
	{
		if (string.IsNullOrWhiteSpace(text))
		{
			return Task.CompletedTask;
		}
		if (CursorLinesSuppressed())
		{
			Log.Info("cursor", "line beside the cursor skipped: presentation / fullscreen game");
			return Task.CompletedTask;
		}
		Log.Info("cursor", $"line beside the cursor ({(streamed ? "streamed" : "cue")}, hold {holdSeconds:0.#} s): \"{Shorten(text, 80)}\"");
		return Services.Cursor.ShowMessageAsync(text, streamed, holdSeconds, ct);
	}

	private void StartCursorModes()
	{
		ICursorOverlay cursor = Services.Cursor;
		cursor.ShakeToDetachEnabled = Services.Settings.ShakeToDetachEnabled;
		Services.Settings.Changed += (object? _, EventArgs _) =>
		{
			cursor.ShakeToDetachEnabled = Services.Settings.ShakeToDetachEnabled;
		};
		cursor.DetachedCursorClicked += () =>
		{
			DispatcherQueue.TryEnqueue(OnDetachedCursorClicked);
		};
		cursor.CursorDetached += ClickyAnalytics.TrackCursorDetached;
		cursor.DetachedCursorAutoReattached += ClickyAnalytics.TrackCursorDetachedAutoReattach;
		if (Services.Settings.CursorDocked)
		{
			cursor.DockAsync(NotchUi.DockAnchorPx());
		}
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		real.Agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			if (e.Kind == AgentTaskEventKind.StatusChanged && e.Text == "Starting")
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					OnAgentEventForCursor(e);
				});
			}
		};
	}

	private void OnDetachedCursorClicked()
	{
		ICompanionSession companion = Services.Companion;
		switch (companion.State)
		{
		case VoiceState.Idle:
		{
			ClickyAnalytics.TrackCursorDetachedClickStart();
			RealStack real = Real;
			if (real != null && RoutedPressToMicrophonePermissionCard(real))
			{
				Services.Cursor.EndDetach();
				break;
			}
			Log.Info("cursor", "detached cursor clicked: listening");
			Services.Audio.PlayEarcon("textOpen");
			companion.BeginPushToTalkAsync();
			break;
		}
		case VoiceState.Listening:
			Log.Info("cursor", "detached cursor clicked again: sending");
			ClickyAnalytics.TrackCursorDetachedClickStop();
			companion.EndPushToTalkAsync();
			Services.Cursor.EndDetach();
			break;
		default:
			Services.Cursor.EndDetach();
			break;
		}
	}

	public async void SetCursorDocked(bool dock)
	{
		if (dock == Services.Settings.CursorDocked || cursorDockFlightInProgress)
		{
			return;
		}
		if (dock)
		{
			if (CursorLinesSuppressed())
			{
				Services.Settings.CursorDocked = true;
				await Services.Cursor.DockAsync(default);
				SyncDockedStrip();
				Log.Info("cursor", "docked (no goodbye: visuals suppressed)");
				return;
			}
			cursorDockFlightInProgress = true;
			Log.Info("cursor", "hiding: saying goodbye");
			try
			{
				await Services.Cursor.SayGoodbyeAndDockAsync("okay see you <3");
			}
			catch (Exception ex)
			{
				Log.Warn("cursor", "goodbye: " + ex.Message);
			}
			Services.Settings.CursorDocked = true;
			cursorDockFlightInProgress = false;
			SyncDockedStrip();
			Log.Info("cursor", "docked");
		}
		else
		{
			Services.Settings.CursorDocked = false;
			cursorDockFlightInProgress = true;
			SyncDockedStrip();
			Log.Info("cursor", "undocking from the notch");
			try
			{
				await Services.Cursor.UndockAsync(NotchUi.DockAnchorPx());
			}
			catch (Exception ex2)
			{
				Log.Warn("cursor", "dock flight: " + ex2.Message);
			}
			cursorDockFlightInProgress = false;
			SyncDockedStrip();
			Log.Info("cursor", "undocked");
		}
	}

	private static bool CursorLinesSuppressed()
	{
		bool flag = QuietContext.ShellReportsFullscreen();
		if (flag)
		{
			QuietContext.NotificationState notificationState = QuietContext.QueryNotificationState();
			bool flag2 = (uint)(notificationState - 3) <= 1u;
			flag = flag2;
		}
		return flag;
	}

	public Task PlayCursorWelcomeAsync()
	{
		Log.Info("cursor", "welcome line");
		return Task.WhenAny(Services.Cursor.PlayWelcomeAsync(), Task.Delay(6000));
	}

	private void OnAgentEventForCursor(AgentTaskEvent e)
	{
		AgentService agentService = Real?.Agents;
		if (agentService != null)
		{
			AgentTaskDetail taskDetail = agentService.GetTaskDetail(e.TaskId);
			if ((object)taskDetail != null && !taskDetail.IsRoutineRun && e.Kind == AgentTaskEventKind.StatusChanged && e.Text == "Starting" && (Services.Presenter.Presentation is NotchPresentation.TextResponse || (Services.Companion.State == VoiceState.Idle && lastTurnTyped)))
			{
				string prompt = taskDetail.UserPrompts.LastOrDefault() ?? taskDetail.Snapshot.Title;
				bool fresh = taskDetail.UserPrompts.Count <= 1;
				ShowStartCueAsync(agentService, prompt, fresh);
			}
		}
	}

	internal void NoteTurnKind(bool typed)
	{
		lastTurnTyped = typed;
	}

	private async Task ShowStartCueAsync(AgentService agents, string prompt, bool fresh)
	{
		string cue = await agents.TextStartCueAsync(prompt, fresh);
		if (!string.IsNullOrWhiteSpace(cue))
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				SayAtCursorAsync(cue, streamed: false, 4.0);
			});
		}
	}

	private void ScheduleFinishCue(string taskId, string reply)
	{
		pendingFinishCue?.Cancel();
		CancellationTokenSource cts = (pendingFinishCue = new CancellationTokenSource());
		string text = CursorText(reply);
		Task.Run(async () =>
		{
			_ = 2;
			try
			{
				DateTimeOffset started = DateTimeOffset.Now;
				long waitFrom = Environment.TickCount64;
				bool sawBusy = false;
				while (!cts.IsCancellationRequested)
				{
					if (Services.Companion.State != VoiceState.Idle)
					{
						sawBusy = true;
						waitFrom = Environment.TickCount64;
						await Task.Delay(120, cts.Token);
					}
					else if (sawBusy)
					{
						await Task.Delay(1500, cts.Token);
						if (Services.Companion.State == VoiceState.Idle)
						{
							break;
						}
					}
					else
					{
						if (Native.MillisecondsSinceLastInput() < Environment.TickCount64 - waitFrom || DateTimeOffset.Now - started >= TimeSpan.FromMinutes(3L))
						{
							break;
						}
						await Task.Delay(120, cts.Token);
					}
				}
				if (!cts.IsCancellationRequested)
				{
					if (QuietContext.IsQuiet())
					{
						Log.Info("cursor", "agent finish line skipped: on a call / Do Not Disturb");
					}
					else
					{
						DispatcherQueue.TryEnqueue(() =>
						{
							SayAtCursorAsync(text, streamed: true, 6.0, cts.Token);
						});
					}
				}
			}
			catch (OperationCanceledException)
			{
			}
		});
	}

	private static string CursorText(string markdown)
	{
		string input = Regex.Replace(markdown, "```[\\s\\S]*?```", " ");
		input = Regex.Replace(input, "!\\[[^\\]]*\\]\\([^)]*\\)", " ");
		input = Regex.Replace(input, "\\[([^\\]]+)\\]\\([^)]*\\)", "$1");
		input = Regex.Replace(input, "[*_`#>]+", "");
		input = Regex.Replace(input, "^\\s*[-•]\\s+", "", RegexOptions.Multiline);
		input = Regex.Replace(input, "\\s+", " ").Trim();
		if (input.Length <= 280)
		{
			return input;
		}
		int num = input.LastIndexOfAny(new char[3] { '.', '!', '?' }, 279);
		if (num <= 120)
		{
			return input.Substring(0, 279).TrimEnd() + "…";
		}
		return input.Substring(0, num + 1);
	}

	private static string Shorten(string s, int max)
	{
		if (s.Length > max)
		{
			return s.Substring(0, max - 1) + "…";
		}
		return s;
	}

	public void DebugLaunchOnboardingWebsiteAgent()
	{
		LaunchOnboardingDemoAgent(StarterCast.Shippy, "Can you make me a website for the beautiful person watching this video right now, and open it in the browser when you're done?", ShippyPrompt);
	}

	public void DebugLaunchOnboardingSpaceXReportAgent()
	{
		LaunchOnboardingDemoAgent(StarterCast.ResearchBuddy, "I'm the CEO of this rocket company you see on my screen. Can you research my competitors and save it as a PDF?", ResearchBuddyPrompt);
	}

	public async void StartHomeTourForDebug()
	{
		if (TourHoldsHome || Real == null)
		{
			return;
		}
		Log.Info("tour", "debug: Start Home tour");
		tour = new HomeTour(this, Interview)
		{
			IsDebugPreview = true
		};
		CursorCompanion.WatchEscape(on: true);
		try
		{
			if (await tour.RunAsync() && !tour.WasAborted)
			{
				StreamHoldToTalkLineAfterOnboarding();
			}
		}
		catch (Exception ex)
		{
			Log.Warn("tour", "debug Home tour: " + ex.Message);
		}
		finally
		{
			tour = null;
			CursorCompanion.WatchEscape(on: false);
			HeaderPills.RaiseChanged();
			SyncRestingMark();
			lastAgentSignature = null;
			SyncAgentActivity();
		}
	}

	public void TestClickyInterview()
	{
		OpenTutorialForDebug(TutorialWindow.Step.ClickyInterview);
	}

	public void JumpToTutorialFinale()
	{
		StarterCast.Unlock();
		OpenTutorialForDebug(TutorialWindow.Step.Finale);
	}

	public void OpenTutorialForDebug(TutorialWindow.Step step)
	{
		Log.Info("tutorial", $"debug: opening the tour at {step}");
		DrawnOnboardingNotch.DismissPeek(this);
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null && tutorialWindow.IsRunning)
		{
			tutorialWindow.BringForward();
			return;
		}
		EndNewAgentsUiDemoRun();
		if (tutorial == null)
		{
			tutorial = CreateTutorial();
		}
		tutorial.Show(step);
	}

	public void DeleteAllLocalClickys()
	{
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		CorePresenter?.DismissNotchAgentPeek();
		IReadOnlyList<string> workspaces;
		try
		{
			workspaces = real.Agents.DeleteAllLocalClickys();
		}
		catch (InvalidOperationException ex)
		{
			SayAtCursorAsync(ex.Message.ToLowerInvariant(), streamed: true, 3.0);
			return;
		}
		ClickyRoster.Shared.ForgetAll();
		string root = Path.GetFullPath(real.Agents.ProjectsRoot);
		Task.Run(() =>
		{
			foreach (string item in workspaces)
			{
				if (Path.GetFullPath(item).StartsWith(root, StringComparison.OrdinalIgnoreCase))
				{
					try
					{
						FileSystem.DeleteDirectory(item, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin);
						Log.Info("debug", item + " → Recycle Bin");
					}
					catch (Exception ex2)
					{
						Log.Warn("debug", "recycle " + item + ": " + ex2.Message);
					}
				}
			}
		});
	}

	public void SetUseProductionBackend(bool on)
	{
		try
		{
			if (on)
			{
				File.WriteAllText(AppBundleConfiguration.UseProductionBackendFlagPath, "on\n");
			}
			else if (File.Exists(AppBundleConfiguration.UseProductionBackendFlagPath))
			{
				File.Delete(AppBundleConfiguration.UseProductionBackendFlagPath);
			}
		}
		catch (Exception ex)
		{
			Log.Warn("settings", "use production backend: " + ex.Message);
			return;
		}
		Log.Info("settings", $"use production backend = {on}; relaunching");
		Relaunch();
	}

	private void SyncPointerOnNotch()
	{
		CorePresenter?.SetPointerInside(notchWindowHovered || deckPointerOnNotch);
	}

	private void StartDock(RealStack real)
	{
		AgentService agents = real.Agents;
		ArcDockHost host = new ArcDockHost
		{
			NotchSurfacePx = () =>
			{
				(int, int, int, int) value = NotchUi.SurfaceRectPx();
				return (value.Item3 <= 0) ? (((int, int, int, int)?)null) : new (int, int, int, int)?(value);
			},
			NotchIsExpanded = () => CorePresenter?.IsShowingNotchAgentPeek ?? false,
			NotchIsOpenOnHome = () =>
			{
				NotchPresenter corePresenter2 = CorePresenter;
				return !HeyClicky.App.Cody.CodyChrome.Enabled && corePresenter2 != null && corePresenter2.IsShowingNotchAgentPeek && corePresenter2.Tabs.Selected == NotchTab.Home;
			},
			NotchHoldsOpenWithoutArc = () => CorePresenter?.HoldsNotchOpenWithoutArc ?? false,
			SetNotchHeldOpenByArc = (bool held) =>
			{
				CorePresenter?.SetNotchHeldOpenByArc(held);
			},
			OpenNotchHome = OpenNotchHome,
			DismissNotch = () =>
			{
				CorePresenter?.DismissNotchAgentPeek();
			},
			IsFullscreenOnDockDisplay = () => NotchUi.IsAmbientHidden,
			HasLatestReply = (string? jobId, string? slug) => NotchChat.HandOffs?.LatestReplyEntryId(jobId, slug) != null,
			ShowFullReply = (string? jobId, string? slug) =>
			{
				NotchPresenter corePresenter2 = CorePresenter;
				if (corePresenter2 != null)
				{
					string text = NotchChat.HandOffs?.LatestReplyEntryId(jobId, slug);
					if (text != null)
					{
						corePresenter2.Tabs.ShowFullReply(text);
						corePresenter2.OpenNotchAgentPeekOnRequest();
					}
				}
			},
			ShowChat = ShowInChat,
			RequestComposerFocus = () =>
			{
				CorePresenter?.Tabs.RequestComposerFocus();
			},
			LatestChatEventAt = (string target) => NotchChat.HandOffs?.Entries.LastOrDefault((ChatHandOff e) => e.TargetKey == target)?.CreatedAt,
			LatestReplyAnswer = (string? jobId, string? slug) =>
			{
				ChatHandOffs handOffs = NotchChat.HandOffs;
				if (handOffs != null)
				{
					string text = handOffs.LatestReplyEntryId(jobId, slug);
					if (text != null)
					{
						JsonObject jsonObject = handOffs.Entry(text)?.Answer;
						if (jsonObject != null)
						{
							return ClickyAnswer.Parse(jsonObject.ToJsonString());
						}
					}
				}
				return (ClickyAnswer?)null;
			},
			OpensInNotchDocumentViewer = (string path) => !ArtifactPaths.IsWebLink(path) && ArtifactPaths.SupportsInline(path),
			OpenInNotchViewer = (string path, string? _, string? threadId) => !ArtifactPaths.IsWebLink(path) && OpenDocumentInNotch(path, threadId),
			PresentNotchUpdate = (string railKey, string kind) =>
			{
				NotchPresenter corePresenter2 = CorePresenter;
				if (corePresenter2 != null)
				{
					NotchUpdates notchUpdates = corePresenter2.Updates;
					NotchUpdateKind kind2 = ((!(kind == "needs_you")) ? ((kind == "failed") ? NotchUpdateKind.Failed : NotchUpdateKind.Done) : NotchUpdateKind.NeedsYou);
					notchUpdates.Present(railKey, kind2);
				}
			},
			DismissNotchUpdate = (string railKey) =>
			{
				CorePresenter?.Updates.Dismiss(railKey);
			},
			HasCompletedOnboarding = () => HasCompletedOnboardingNow,
			OnboardingHidesDock = () => introSequenceActive || (real.Tutorial.IsEngaged && !DrawnOnboardingNotchShowcase.Shared.ShowsDock),
			SuppressesVisualSurfaces = () => Services.Settings.IsPaused,
			IsTourRunning = () => TourHoldsHome,
			PlaysSounds = () => (HeyClicky.App.Cody.CodyDrawingSounds.Supported && real.Core.Settings.Read((AppSettings s) => s.DrawingSoundsEnabled)),
			VoiceHoldDescription = () => Services.Settings.PushToTalkDisplay,
			IsListening = () => Services.Companion.State == VoiceState.Listening,
			UnreadClickySlugs = () => ClickyReadMarks.Unread(agents),
			MarkClickyRead = ClickyReadMarks.MarkRead,
			NoteTitle = ClickyArcPlanNotes.NoteTitle,
			NoteChecklistPlan = (string notePath) => ClickyArcPlanNotes.Read(agents.LiveSteps, notePath),
			StartWaitingJob = (ClickyJob job) =>
			{
				Guid? suggestionCardId = job.SuggestionCardId;
				if (suggestionCardId.HasValue)
				{
					Guid valueOrDefault = suggestionCardId.GetValueOrDefault();
					ISet<Guid>? set = LiveSuggestionCardIds();
					if (set != null && set.Contains(valueOrDefault))
					{
						return (object)Proactive?.Approve(valueOrDefault, null, announce: false) != null;
					}
				}
				return false;
			},
			LiveSuggestionCardIds = LiveSuggestionCardIds
		};
		ArcDock arcDock = (Dock = new ArcDock(agents, host, () => real.JobReports, ExcludeFromCapture));
		ArcDock dock = arcDock;
		ArcDockView.NotchHwnd = () => NotchUi.Window.Hwnd;
		NotchUi.RaisedToTop += dock.KeepAboveNotch;
		dock.PointerOnNotchChanged += (bool on) =>
		{
			deckPointerOnNotch = on;
			SyncPointerOnNotch();
		};
		dock.SubmitFact = (string fact) => real.Companion.SubmitFactAsync(fact);
		IReadOnlyList<string> readOnlyList = agents.TakeLegacyClickyMigration();
		if (readOnlyList != null)
		{
			ClickyReadMarks.MarkAllRead(readOnlyList);
		}
		NotchExtensions.HomeDock = new ArcNotchHomeDock(dock, () => CorePresenter?.Tabs.Selected);
		DrawnOnboardingNotchShowcase shared = DrawnOnboardingNotchShowcase.Shared;
		DrawnOnboardingNotchShowcase.SetDockTourShowcase = (bool on) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				dock.IsTourShowcase = on;
			});
		};
		shared.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(dock.Refresh);
		};
		real.Tutorial.PropertyChanged += (object? _, PropertyChangedEventArgs e) =>
		{
			string propertyName = e.PropertyName;
			if ((propertyName == "IsEngaged" || propertyName == "Phase") ? true : false)
			{
				dock.NoteMembershipInputsChanged();
			}
		};
		real.Core.Settings.Changed += (object? _, EventArgs _) =>
		{
			dock.NoteMembershipInputsChanged();
		};
		Services.Auth.Changed += (object? _, EventArgs _) =>
		{
			dock.NoteMembershipInputsChanged();
		};
		ClickyTourJobCards.ArcCardFactory = (TourJobCardContent card, bool showsCover) =>
		{
			ArcCardView arcCardView = new ArcCardView(dock, new ArcCardContent
			{
				RailKey = card.RailKey,
				Title = card.Title,
				Summary = card.Summary,
				State = ArcCardState.Suggested,
				Paper = new ArcPaper((PaperStock)card.Paper)
			});
			arcCardView.SetPresentation(showsCover, isLive: false, animated: false);
			return arcCardView;
		};
		NotchExtensions.RestingMarkState = () =>
		{
			if (!EdgeDockIsRunning)
			{
				return new NotchRestingMarkState(0, "idle");
			}
			var (workingCount, alertPhase) = dock.RestingMark();
			return new NotchRestingMarkState(workingCount, alertPhase);
		};
		NotchExtensions.LiveWork = new ArcChatLiveWork(dock, agents, new WorkChatLiveWork(agents, () => Real?.JobReports));
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			corePresenter.PresentationChanged += (object? _, EventArgs _) =>
			{
				dock.NotchChanged();
			};
			corePresenter.PresentationChanged += (object? _, EventArgs _) =>
			{
				dock.NoteMembershipInputsChanged();
			};
			ArcVoicePill arcPill = new ArcVoicePill(corePresenter, dock, NotchUi, ExcludeFromCapture);
			corePresenter.VoicePillChanged += () =>
			{
				DispatcherQueue.TryEnqueue(arcPill.Sync);
			};
			corePresenter.PresentationChanged += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(arcPill.Sync);
			};
			corePresenter.Tabs.SelectionChanged += (NotchTab tab) =>
			{
				if (DispatcherQueue.HasThreadAccess)
				{
					NoteTab(tab);
				}
				else
				{
					DispatcherQueue.TryEnqueue(() =>
					{
						NoteTab(tab);
					});
				}
			};
		}
		AgentDriveJobs jobs = new AgentDriveJobs(agents, (string taskId, string reason) =>
		{
			PresentEdgeDockWindow(agents, taskId, reason);
		}, (string threadId, string eventText) =>
		{
			NoteClickyEventForOneBrain?.Invoke(threadId, eventText);
		}, AnnounceLineAsync);
		if (ClickyDrive != null)
		{
			AgentDriveConsent consent = AttachAgentJobs(jobs);
			dock.DriveConsent = consent;
			ClickyBrowserBridge.Shared.MacStepHandler = consent.AnswerMacStepToolCallAsync;
			real.ToolHost.ApproveComputerUseHook = consent.ApproveComputerUse;
			real.ToolHost.DeclineComputerUseHook = consent.DeclineComputerUse;
			real.JobReports.IsPcStepMomentInProgress = () => consent.IsPcStepMomentInProgress;
			agents.IsClickyDriveAvailable = () => consent.AgentClickyDriveIsAvailable;
			agents.TakeUnansweredComputerUseStep = MacStepWaiters.Shared.TakeUnansweredStep;
			AnnounceComputerUseAsk = (string taskId) =>
			{
				consent.AnnounceAgentAsksToUsePcIfNeeded(new DriveJob(agents, taskId));
			};
		}
		ChromeSetupFlow.Shared.Jobs = new ChromeSetupJobs(agents, (string railKey) =>
		{
			host.PresentNotchUpdate?.Invoke(railKey, "needs_you");
		});
		ClickyBrowserBridge.Shared.JobFolderForThread = (string thread) => agents.Jobs.JobForThread(thread)?.FolderPath;
		AgentToolHooks.HoldJobForChrome = (AgentToolLaunch launch) => HoldJobForChrome(agents, launch, real.Companion.CurrentTurnSpokenLines);
		AgentToolHooks.AnswerChromeSetup = (string? threadId, string choice) => OnUiAsync(() =>
		{
			ChromeSetupFlow shared2 = ChromeSetupFlow.Shared;
			ChromeSetupFlow.Target target = shared2.TargetFor(threadId);
			if ((object)target != null)
			{
				ChromeSetupFlow.Choice? choice2 = ChromeSetupFlow.Parse(choice);
				if (choice2.HasValue)
				{
					ChromeSetupFlow.Choice valueOrDefault = choice2.GetValueOrDefault();
					ChromeSetupFlow.Choice choice3 = ((valueOrDefault == ChromeSetupFlow.Choice.DoItForMe && !shared2.CanDoItForThem) ? ChromeSetupFlow.Choice.ShowMeHow : valueOrDefault);
					shared2.Choose(choice3, target);
					return ChromeSetupFlow.Raw(choice3);
				}
			}
			return (string?)null;
		});
		AgentToolHooks.StartWaitingJobNamed = (string label, string task) => OnUiAsync(() => StartWaitingJobNamed(dock, agents, label, task));
		FlowHooks.EdgeDockFocusNote = () => dock.FocusNoteForOneBrainTurn();
		if (hotkeys != null)
		{
			Func<bool> allows = hotkeys.AllowsPushToTalk;
			hotkeys.AllowsPushToTalk = () =>
			{
				if (!allows())
				{
					return false;
				}
				if (!dock.NotePushToTalkDown() && !real.Tutorial.IsEngaged)
				{
					string text = NotchFullReplyFollowUpKey(agents);
					if (text != null)
					{
						dock.NoteFullReplyVoiceFollowUp(text);
					}
				}
				return true;
			};
		}
		Services.Companion.StateChanged += (object? _, EventArgs _) =>
		{
			if (Services.Companion.State == VoiceState.Idle)
			{
				dock.ClearVoiceFollowUp();
			}
			dock.NoteVoiceStateChanged();
		};
		agents.TasksChanged += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				SyncLaunchFlights(agents);
			});
		};
		SyncLaunchFlights(agents);
		dock.Start();
		Log.Info("dock", "the agent dock hangs from the notch's Home tab");
		void NoteTab(NotchTab tab)
		{
			bool flag = tab == NotchTab.Home;
			if (flag)
			{
				NotchUi.RelayoutPeek();
			}
			dock.NotchTabChanged(flag, tab.RawValue());
		}
	}

	private string? NotchFullReplyFollowUpKey(AgentService agents)
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null && corePresenter.IsShowingNotchAgentPeek)
		{
			string expandedReplyEntryId = corePresenter.Tabs.ExpandedReplyEntryId;
			if (expandedReplyEntryId != null)
			{
				ChatHandOff chatHandOff = NotchChat.HandOffs?.Entry(expandedReplyEntryId);
				if ((object)chatHandOff != null)
				{
					string jobId = chatHandOff.JobId;
					if (jobId != null)
					{
						ClickyJob clickyJob = agents.Jobs.Job(jobId);
						if ((object)clickyJob != null)
						{
							return clickyJob.RailKey;
						}
					}
					string clickySlug = chatHandOff.ClickySlug;
					if (clickySlug != null && (object)agents.FindClicky(clickySlug) != null)
					{
						return clickySlug;
					}
					return null;
				}
			}
		}
		return null;
	}

	private string? HoldJobForChrome(AgentService agents, AgentToolLaunch launch, IReadOnlyList<string> spokenLines)
	{
		if (!ChromeSetupFlow.Shared.HoldsNewWebsiteJobs || !AgentToolHooks.BrainAskedAboutChrome(spokenLines))
		{
			return null;
		}
		ClickyJob job = agents.Jobs.CreateJob(launch.NewClickyName ?? launch.Prompt, launch.Prompt, agents.ProjectsRoot);
		DispatcherQueue.TryEnqueue(() =>
		{
			ChromeSetupFlow.Shared.Hold(job.Id, (bool withoutChrome) =>
			{
				if (withoutChrome)
				{
					agents.Jobs.SetSkipsChrome(job.Id);
				}
				Task<string> task = agents.LaunchAsync(new AgentLaunchRequest
				{
					Prompt = launch.Prompt,
					JobId = job.Id,
					LaunchSource = launch.LaunchSource,
					ImagesJpeg = launch.ImagesJpeg,
					AttachedFilePaths = launch.AttachedFilePaths,
					IsGeneratedTaskBrief = launch.IsGeneratedTaskBrief,
					LaunchContext = (withoutChrome ? (launch.LaunchContext + " They chose not to connect Chrome for this job: don't ask about Chrome again. For a step on a website they're signed into, call mac_step and HeyClicky does it on their screen while they watch.") : launch.LaunchContext)
				});
				ClickyAnalytics.TrackProductEvent("job_action", null, null, new JsonObject { ["action"] = "started" });
				task.ContinueWith((Task<string> t) =>
				{
					if (t.IsCompletedSuccessfully)
					{
						DispatcherQueue.TryEnqueue(() =>
						{
							NoteHandOffStarted(agents, t.Result, launch.Prompt, isFollowUp: false);
						});
					}
					else
					{
						Log.Warn("chrome", "held job \"" + job.Title + "\" didn't start: " + t.Exception?.GetBaseException().Message);
					}
				}, TaskScheduler.Default);
			});
		});
		return job.Title;
	}

	private ISet<Guid>? LiveSuggestionCardIds()
	{
		return Proactive?.VisibleCards.Select((ProactiveSuggestionCard c) => c.Id).ToHashSet();
	}

	private string? StartWaitingJobNamed(ArcDock dock, AgentService agents, string label, string task)
	{
		string name = label.Trim();
		if (name.Length == 0)
		{
			return null;
		}
		ClickyJob clickyJob = dock.ShelfJobs().FirstOrDefault((ClickyJob j) => j.IsWaitingToStart && string.Equals(j.Title.Trim(), name, StringComparison.OrdinalIgnoreCase));
		Guid? guid = clickyJob?.SuggestionCardId;
		if (guid.HasValue)
		{
			Guid valueOrDefault = guid.GetValueOrDefault();
			string text = task.Trim();
			string adjustmentText = ((text.Length == 0 || string.Equals(text, name, StringComparison.OrdinalIgnoreCase)) ? null : text);
			if ((object)Proactive?.Approve(valueOrDefault, adjustmentText, announce: false) == null)
			{
				return null;
			}
			ClickyJob clickyJob2 = agents.Jobs.Job(clickyJob.Id);
			if ((object)clickyJob2 != null && clickyJob2.IsWaitingToStart)
			{
				agents.Jobs.Dismiss(clickyJob.Id);
			}
			Log.Info("dock", "\"" + clickyJob.Title + "\" started by the voice's yes (no second job)");
			return clickyJob.Title;
		}
		return null;
	}

	private Task<T?> OnUiAsync<T>(Func<T?> work) where T : class
	{
		if (DispatcherQueue.HasThreadAccess)
		{
			return Task.FromResult(work());
		}
		TaskCompletionSource<T?> done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
		if (!DispatcherQueue.TryEnqueue(() =>
		{
			try
			{
				done.TrySetResult(work());
			}
			catch (Exception exception)
			{
				done.TrySetException(exception);
			}
		}))
		{
			done.TrySetResult(null);
		}
		return done.Task;
	}

	private void SyncLaunchFlights(AgentService agents)
	{
		foreach (AgentTaskSnapshot task in agents.Tasks)
		{
            if(HeyClicky.App.Cody.CodyQuickActions.IsForeground(agents.GetTaskDetail(task.TaskId)))continue;
			bool flag = dockKnownTasks.Add(task.TaskId);
			AgentTaskStatus status = task.Status;
			bool flag2 = (uint)status <= 1u;
			bool flag3 = flag2;
			flag2 = dockLastStatus.TryGetValue(task.TaskId, out var value);
			if (flag2)
			{
				bool flag4 = (uint)value <= 1u;
				flag2 = flag4;
			}
			bool flag5 = flag2;
			dockLastStatus[task.TaskId] = task.Status;
			int value2;
			if (flag)
			{
				value2 = AssignLaunchPaletteSlot(agents, task.TaskId);
			}
			else
			{
				value2 = ((flag3 && !flag5) ? PromoteLaunchPaletteSlot(task.TaskId) : (-1));
			}
			if ((!flag || dockFirstSync || !flag3) | flag5)
			{
				continue;
			}
			AgentTaskDetail taskDetail = agents.GetTaskDetail(task.TaskId);
			if ((object)taskDetail == null || taskDetail.IsRoutineRun)
			{
				continue;
			}
			ArcDock? dock = Dock;
			if ((dock == null || !dock.IsLaunchingFromOpenWindow) && !Services.Settings.IsPaused)
			{
				PointD? pointD = Real?.Cursor.RenderedPositionPx();
				PointD endPx = Dock?.LaunchLandingPointPx() ?? FallbackLaunchLandingPx(pointD);
				uint num = AgentLaunchPalette.SwatchRgb[Math.Clamp(value2, 0, AgentLaunchPalette.SlotCount - 1)];
				Color color = Color.FromArgb(byte.MaxValue, (byte)(num >> 16), (byte)(num >> 8), (byte)num);
                if(HeyClicky.App.Cody.CodyEngineBridge.EngineMode){
                    var start=pointD??HeyClicky.Platform.Input.ClickyScreenActuator.CurrentPointer;
                    HeyClicky.App.Cody.CodyEngineBridge.PublishAgentLaunch(new{id=task.TaskId,x=start.X,y=start.Y});
                    PlayAgentEarcon("agentLaunch",0.55f);continue;
                }
				if (launchFlight == null)
				{
					launchFlight = new DockLaunchFlight(ExcludeFromCapture);
				}
				launchFlight.Fly(endPx, color, () =>
				{
					PlayAgentEarcon("agentLaunch", 0.55f);
				}, pointD);
			}
		}
		dockFirstSync = false;
	}

	private int AssignLaunchPaletteSlot(AgentService agents, string taskId)
	{
		HashSet<int> activeSlots = (from s in agents.Tasks.Where((AgentTaskSnapshot t) =>
			{
				bool flag = t.TaskId != taskId;
				if (flag)
				{
					AgentTaskStatus status = t.Status;
					bool flag2 = (uint)status <= 1u;
					flag = flag2;
				}
				return flag;
			}).Select((AgentTaskSnapshot t) =>
			{
				(string, int) tuple = launchPaletteSlots.FirstOrDefault(((string TaskId, int Slot) s) => s.TaskId == t.TaskId);
				return (tuple.Item1 == null) ? (-1) : tuple.Item2;
			})
			where s >= 0
			select s).ToHashSet();
		int num = AgentLaunchPalette.NextIndex(launchPaletteSlots.Select(((string TaskId, int Slot) s) => s.Slot).ToList(), activeSlots);
		launchPaletteSlots.Insert(0, (taskId, num));
		if (launchPaletteSlots.Count > 64)
		{
			launchPaletteSlots.RemoveAt(launchPaletteSlots.Count - 1);
		}
		return num;
	}

	private int PromoteLaunchPaletteSlot(string taskId)
	{
		int num = launchPaletteSlots.FindIndex(((string TaskId, int Slot) s) => s.TaskId == taskId);
		if (num < 0)
		{
			return -1;
		}
		(string, int) item = launchPaletteSlots[num];
		launchPaletteSlots.RemoveAt(num);
		launchPaletteSlots.Insert(0, item);
		return item.Item2;
	}

	private static PointD FallbackLaunchLandingPx(PointD? start)
	{
		Displays.Monitor monitor;
		if (start.HasValue)
		{
			PointD valueOrDefault = start.GetValueOrDefault();
			monitor = Displays.At((int)valueOrDefault.X, (int)valueOrDefault.Y);
		}
		else
		{
			monitor = Displays.UnderCursor();
		}
		Displays.Monitor monitor2 = monitor;
		return new PointD((double)monitor2.Work.Right - 38.0 * monitor2.Scale, (double)monitor2.Work.Top + 38.0 * monitor2.Scale);
	}

	private void StartDrawnTour(RealStack real)
	{
		ClickyTourJobCards.Shared.Attach(this);
		morningBrief = new GoodMorningBrief(this, real);
		WireTour660Hooks(real);
		FlowHooks.TakeFlowBrief = () => DrawnOnboardingTour.ConsumePendingBrief() ?? GoodMorningBrief.ConsumePendingBrief();
		FlowHooks.TakePillPlanNote = ClickyTourJobCards.Shared.TakePendingPillPlanNote;
		FlowHooks.IsDrawnTourRunning = () => DrawnOnboardingTour.IsRunning;
		FlowHooks.IsInterviewSendOffInProgress = () => InterviewSendOffInProgress;
		FlowHooks.TourStepNote = () =>
		{
			OnboardingTutorialStep? currentStep = real.Tutorial.CurrentStep;
			if (currentStep.HasValue)
			{
				OnboardingTutorialStep valueOrDefault = currentStep.GetValueOrDefault();
				if (real.Tutorial.Phase == OnboardingTutorialPhase.Running)
				{
					return TourStepNotes.Note(valueOrDefault, Interview?.Transcript ?? Array.Empty<InterviewLine>(), SpokenTalkKeys());
				}
			}
			return (string?)null;
		};
		real.Companion.OneBrainTurnEnded += () =>
		{
			DispatcherQueue.TryEnqueue(PrefetchDrawnOnboardingFinaleIfReady);
		};
		BillingUi billingUi = Services.Billing;
		if (billingUi == null)
		{
			return;
		}
		billingUi.PaywallClosed += (PaywallSource _, PaywallCloseKind _) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				DrawnOnboardingTour.ReleaseNotch();
				ClickyTourJobCards.Shared.PopHeldNextQuestions(0.9);
			});
		};
	}

	internal string SpokenTalkKeys()
	{
		return Services.Settings.PushToTalkDisplay.ToLowerInvariant().Replace(" + ", " and ");
	}

	private bool HandleTourDrawingAction(DrawingAction action)
	{
		bool flag;
		switch (action.Kind)
		{
		case "tourtuck":
		case "tourasks":
		case "tourjob":
		case "tournotch":
		case "tourfade":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (!flag)
		{
			return false;
		}
		int num = ((action.Payload.ValueKind == JsonValueKind.Object && action.Payload.TryGetProperty("line", out var value) && value.TryGetInt32(out var value2)) ? value2 : 0);
		string text = ((action.Payload.ValueKind == JsonValueKind.Object && action.Payload.TryGetProperty("text", out var value3) && value3.ValueKind == JsonValueKind.String) ? (value3.GetString() ?? "") : "");
		if (!DrawnOnboardingTour.IsRunning && !GoodMorningBrief.IsPlaying)
		{
			Log.Info("drawing", $"{action.Kind} in beat {num + 1} not run: no tour or morning is running");
			return true;
		}
		switch (action.Kind)
		{
		case "tourtuck":
			Log.Info("drawing", $"tuckJobs in beat {num + 1}");
			ClickyTourJobCards.Shared.TuckIntoNotchNowAsync();
			break;
		case "tournotch":
			Log.Info("drawing", $"showNotch({text}) in beat {num + 1}");
			if (text == "apps")
			{
				DrawnOnboardingNotchShowcase.Shared.PopApps(this);
			}
			else
			{
				DrawnOnboardingNotchShowcase.Shared.Show(this);
			}
			break;
		case "tourfade":
			Log.Info("drawing", $"fadeAway in beat {num + 1}");
			DrawnOnboardingNotchShowcase.Shared.FadeDrawingAway(this);
			break;
		case "tourasks":
			ClickyTourJobCards.Shared.NoteNextQuestions(text);
			Log.Info("drawing", $"nextQuestions in beat {num + 1}");
			break;
		case "tourjob":
		{
			ClickyTourJob clickyTourJob = ClickyTourJob.FromPayload(text);
			if (clickyTourJob == null)
			{
				Log.Info("drawing", $"tourJob in beat {num + 1} skipped: unreadable {((text.Length > 120) ? text.Substring(0, 120) : text)}");
			}
			else
			{
				Log.Info("drawing", $"tourJob in beat {num + 1}: {clickyTourJob.Title}");
				ClickyTourJobCards.Shared.Show(clickyTourJob, Real?.Canvas.DrawingDisplay);
			}
			break;
		}
		}
		return true;
	}

	internal async Task<bool> RunDrawnOnboardingFinaleAsync()
	{
		RealStack real = Real;
		if (real != null)
		{
			InterviewController interview = Interview;
			if (interview != null)
			{
				IReadOnlyList<InterviewLine> transcript = interview.Transcript;
				if (!transcript.Any((InterviewLine l) => l.Role == "user"))
				{
					return false;
				}
				DrawnOnboardingNotch.DismissPeek(this);
				DrawnOnboardingTour.HoldNotchUntilPaywallAnswered(this);
				ClickyTourJobCards.Shared.DismissAll();
				DrawnOnboardingNotchShowcase.Shared.Reset(this);
				ClickyTourJobCards.Shared.SuggestionCheckReason = ProactiveCheckReason.Onboarding;
				DrawnOnboardingTour.IsRunning = true;
				DrawnOnboardingFinalePrefetch.Prefetched prefetched = DrawnOnboardingFinalePrefetch.Shared.Take(real.Core.Auth.UserId);
				int num;
				if ((object)prefetched != null)
				{
					num = prefetched.PlannedCardCount;
				}
				else
				{
					List<ProactiveSuggestionCard> list = (Proactive?.VisibleCards ?? Array.Empty<ProactiveSuggestionCard>()).Where((ProactiveSuggestionCard c) => c.CheckReason == ProactiveCheckReason.Onboarding).Take(3).ToList();
					num = list.Count;
					DrawnOnboardingTour.Arm(DrawnOnboardingTour.TourBrief(AccountFirstNameForTour ?? "there", transcript, SpokenTalkKeys(), list));
				}
				DrawnOnboardingTour.TrackFinaleStarted("onboarding", num, Enumerable.Count(transcript, (InterviewLine l) => l.Role == "user"), (object)prefetched != null);
				Log.Info("drawn tour", $"finale: drawing the tour from the interview ({num} planned card(s)" + (((object)prefetched == null) ? ")" : $", prefetched {(int)(DateTimeOffset.Now - prefetched.StartedAt).TotalSeconds}s ago, {prefetched.CodeCharactersReady} characters ready)"));
				await Task.Delay(((object)prefetched == null) ? 1300 : 300);
				if ((object)prefetched == null)
				{
					await real.Companion.SubmitFactAsync("[App] The welcome tour's last moment: the user pressed Show me. Draw their welcome now, as the note says.");
				}
				else
				{
					await real.Companion.PlayPrefetchedTurnAsync(prefetched.Turn);
				}
				DrawnOnboardingTour.ConsumePendingBrief();
				DrawnOnboardingFinalePrefetch.Shared.Reset();
				await FinishDrawnOnboardingTourAsync(ProactiveCheckReason.Onboarding, streamsHoldToTalkLine: false);
				DrawnOnboardingTour.PlannedCardsById = new Dictionary<string, ProactiveSuggestionCard>();
				await Task.Delay(600);
				return true;
			}
		}
		return false;
	}

	internal void PrefetchDrawnOnboardingFinaleIfReady()
	{
		DrawnOnboardingFinalePrefetch.Shared.StartIfReady(this);
	}

	private void OnTourStepChanged(TutorialWindow.Step? step)
	{
		if (step == TutorialWindow.Step.Finale)
		{
			PrefetchDrawnOnboardingFinaleIfReady();
		}
		else if (!step.HasValue && !InterviewSendOffInProgress)
		{
			DrawnOnboardingFinalePrefetch.Shared.DiscardUnlessAdopted("the tour ended");
		}
	}

	internal async Task FinishDrawnOnboardingTourAsync(ProactiveCheckReason suggestionCheckReason, bool streamsHoldToTalkLine = true)
	{
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		ScreenDrawingCanvas canvas = real.Canvas;
		long started = Environment.TickCount64;
		long? quietSince = null;
		bool narrationTimedOut = true;
		while (Environment.TickCount64 - started < 180000)
		{
			await Task.Delay(150);
			if (canvas.IsStreamingNarration || real.Companion.State == VoiceState.Responding)
			{
				quietSince = null;
				continue;
			}
			quietSince.GetValueOrDefault();
			if (!quietSince.HasValue)
			{
				long tickCount = Environment.TickCount64;
				quietSince = tickCount;
			}
			if (!(Environment.TickCount64 - quietSince >= 600))
			{
				continue;
			}
			narrationTimedOut = false;
			break;
		}
		DrawnOnboardingNotchShowcase showcase = DrawnOnboardingNotchShowcase.Shared;
		showcase.Close(this);
		DisplayInfo display = canvas.DrawingDisplay;
		int cardsShownCount = ClickyTourJobCards.Shared.PlacedCardCount;
		canvas.FadeDrawingKeepingAskButtons();
		try
		{
			ClickyTourJobCards.Shared.SuggestionCheckReason = suggestionCheckReason;
			await ClickyTourJobCards.Shared.TuckRemainingCardsIntoSuggestionsAsync();
			Log.Info("drawn tour", "ended");
			ClickyTourJobCards.Shared.HoldNextQuestions(display);
			string outcome;
			if (narrationTimedOut)
			{
				outcome = "narration_timeout";
			}
			else
			{
				outcome = (((object)display == null) ? "no_drawing" : "finished");
			}
			DrawnOnboardingTour.TrackFinaleEnded(outcome, cardsShownCount, ClickyTourJobCards.Shared.HeldNextQuestionCount);
			DrawnOnboardingTour.IsRunning = false;
			FadeOutOnboardingMusic(3.0);
			if (streamsHoldToTalkLine)
			{
				await Task.Delay(900);
				StreamHoldToTalkLineAfterOnboarding();
			}
		}
		finally
		{
			showcase.Reset(this);
		}
	}

	public void PresentDrawnOnboardingTourForDebugTest()
	{
		RealStack real = Real;
		if (real == null || !real.Core.Auth.IsSignedIn)
		{
			Log.Info("drawn tour", "not signed in: nothing to run");
			return;
		}
		DrawnOnboardingNotch.DismissPeek(this);
		if (Services.Presenter.Presentation is NotchPresentation.TextInput)
		{
			Services.Presenter.Present(new NotchPresentation.Idle());
		}
		ClickyTourJobCards.Shared.DismissAll();
		DrawnOnboardingNotchShowcase.Shared.Reset(this);
		ClickyTourJobCards.Shared.SuggestionCheckReason = ProactiveCheckReason.Debug;
		DrawnOnboardingTour.IsRunning = true;
		(string, IReadOnlyList<InterviewLine>, int?) tuple = DrawnOnboardingTour.TestInterview();
		DrawnOnboardingTour.Arm(DrawnOnboardingTour.TourBrief(tuple.Item1, tuple.Item2, SpokenTalkKeys()));
		DrawnOnboardingTour.TrackFinaleStarted("developer_test", 0, Enumerable.Count(tuple.Item2, (InterviewLine l) => l.Role == "user"));
		int? item = tuple.Item3;
		string text;
		if (item.HasValue)
		{
			int valueOrDefault = item.GetValueOrDefault();
			text = $"real interview #{valueOrDefault + 1}";
		}
		else
		{
			text = "the made-up interview (Sam)";
		}
		Log.Info("drawn tour", "test: drawing the tour for " + text);
		RunDrawnTourTestAsync(real, tuple.Item1);
	}

	private async Task RunDrawnTourTestAsync(RealStack real, string name)
	{
		await Task.Delay(700);
		SetTourMusic(playing: true);
		await real.Companion.SubmitFactAsync($"[App] Developer test of the drawn welcome tour for another person's interview, {name}; nothing in this turn is about the real user. Draw {name}'s tour now, as the note says.");
		DrawnOnboardingTour.ConsumePendingBrief();
		await FinishDrawnOnboardingTourAsync(ProactiveCheckReason.Debug);
	}

	public void PresentOnboardingDrawStepForDebugTest()
	{
		DrawnOnboardingNotch.DismissPeek(this);
		OpenTutorialForDebug(TutorialWindow.Step.DrawDemo);
		(string, IReadOnlyList<InterviewLine>, int?) tuple = DrawnOnboardingTour.TestInterview();
		Interview?.UseTranscriptForDrawStepTest(tuple.Item2);
		int? item = tuple.Item3;
		string text;
		if (item.HasValue)
		{
			int valueOrDefault = item.GetValueOrDefault();
			text = $"real interview #{valueOrDefault + 1}";
		}
		else
		{
			text = "the made-up interview (Sam)";
		}
		Log.Info("tutorial", "draw step test: drawing step for " + text);
	}

	private void StartClickyDrive(RealStack real)
	{
		ClickyTakeOverController drive = new ClickyTakeOverController(real.Companion, real.Capture, DispatcherQueue)
		{
			Accent = () => DS.CursorColor(Services.Settings.CursorColorHex),
			IsAvailable = () =>
			{
				string text = real.Core.Settings.Read((AppSettings s) => s.OneBrainModel);
				return text == null || text.Length <= 0 || text.StartsWith("gpt-", StringComparison.Ordinal);
			},
			RefundEarlyStop = async (string leaseId) =>
			{
				byte[] bytes = (await real.Core.Worker.SendRawAsync(HttpMethod.Post, "/agent/turn-lease/" + leaseId + "/refund-early-stop", new StringContent("{}", Encoding.UTF8, "application/json"), authenticated: true, CancellationToken.None, TimeSpan.FromSeconds(15L), "companion").ConfigureAwait(continueOnCapturedContext: false)) ?? throw new InvalidOperationException("No access token to refund a stopped drive.");
				Log.Info("drive", "early-stop refund for the drive's lease " + leaseId.Substring(0, Math.Min(8, leaseId.Length)) + ": " + Encoding.UTF8.GetString(bytes));
			},
			RefreshBilling = () => real.Core.Billing.RefreshAsync()
		};
		real.Companion.AttachDrive(drive);
		ClickyDrive = drive;
		ChromeSetupFlow.Shared.Drive = new ChromeSetupDrive(drive, real.Companion);
		drive.ChromeSetupIsRunning = () => ChromeAutoInstall.IsRunning;
		if (hotkeys != null)
		{
			hotkeys.DriveClaimsEscape = () => drive.ClaimsEscape;
			hotkeys.DriveEscape = drive.HandleEscape;
		}
		Log.Info("drive", "Clicky drive ready");
	}

	internal AgentDriveConsent AttachAgentJobs(IAgentDriveJobs jobs)
	{
		if (ClickyDrive == null)
		{
			throw new InvalidOperationException("Clicky drive isn't up yet");
		}
		return ClickyDriveConsent = new AgentDriveConsent(ClickyDrive, jobs);
	}

	internal void PreviewClickyDrive()
	{
		ClickyDrive?.PreviewForDebug();
	}

	private void StartInkNotes(RealStack real)
	{
		ClickyLiveNotePreferences.Settings = real.Core.Settings;
		ClickyInkLinkPreviewPlate.WorkerBaseUrl = (ClickyInkImages.WorkerBaseUrl = real.Core.Endpoints.WorkerBaseUrl.AbsoluteUri);
		ClickyInkImages.PhotoSearch = (string query, CancellationToken ct) => real.Canvas.PhotoAsync(query, ct, null);
		AgentService agents = real.Agents;
		ClickyInkNoteStore.ClearLiveSteps = (string key) =>
		{
			agents.LiveSteps.Clear(key);
		};
		ClickyInkPaths.MainArtifacts = new ClickyInkPaths.FileRules((IReadOnlyList<string> paths) => ClickyMainArtifacts.SupportingPaths(paths), ClickyMainArtifacts.IsMeaningfulFile);
		agents.LiveNotes = new ClickyInkLiveNoteTurns(agents, DispatcherQueue);
		InkNoteHost = new AgentsInkNoteHost(agents)
		{
			FindJob = (string jobId) =>
			{
				ClickyJob clickyJob = agents.Jobs.Job(jobId);
				return ((object)clickyJob == null) ? null : ClickyInkLiveNoteTurns.InkJob(agents, clickyJob);
			},
			LiveStatus = (string slug) => AgentsInkNoteHost.InkLive(agents.LiveStatusForClicky(slug)),
			IsUnread = (string slug) => ClickyReadMarks.Unread(agents).Contains(slug),
			SetInterval = (string routineId, int minutes, string source) =>
			{
				agents.Routines.SetInterval(routineId, minutes, source);
			},
			OpenInViewer = (string target, string? _, string? threadId) => OpenDocumentInNotch(target, threadId),
			OpenJobArtifactHandler = (string target, string jobId) =>
			{
				if (!OpenDocumentInNotch(target, agents.Jobs.Job(jobId)?.ThreadId))
				{
					ClickyInkNoteBridge.OpenInItsApp(target);
				}
			},
			SendOnThread = (string threadId, string message, string launchContext) =>
			{
				ClickyJob clickyJob = agents.Jobs.JobForThread(threadId);
				if ((object)clickyJob == null)
				{
					Log.Warn("ink", "no job for thread " + threadId);
				}
				else
				{
					agents.LaunchAsync(new AgentLaunchRequest
					{
						Prompt = message,
						JobId = clickyJob.Id,
						TargetThreadId = threadId,
						LaunchContext = launchContext,
						LaunchSource = "text",
						UsageContext = "agent_chat"
					});
				}
			}
		};
		if (ClickyInkNoteBridge.Host == null)
		{
			ClickyInkNoteBridge.Host = InkNoteHost;
		}
		ClickyInkNoteConnect connect = (inkConnect = new ClickyInkNoteConnect(real.Agents, DispatcherQueue, OpenUrl)
		{
			BringAppToFront = () =>
			{
				Native.ForceForeground(NotchUi.Window.Hwnd);
			}
		});
		connect.Sync(ConnectedApps.Catalog?.Integrations);
		ConnectedApps.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				connect.Sync(ConnectedApps.Catalog?.Integrations);
			});
		};
	}

	private bool InkNoteSignInReturned(string? toolkit, bool failed)
	{
		return inkConnect?.OnAuthCallback(toolkit, failed) ?? false;
	}

	private CursorCompanion CreateCursorCompanion()
	{
		CursorCompanion cursorCompanion = new CursorCompanion(ExcludeFromCapture, () => Services.Settings.CursorColorHex);
		cursorCompanion.DoubleEscape += () =>
		{
			HomeTour homeTour = tour;
			if (homeTour != null && homeTour.IsRunning)
			{
				homeTour.AbortForEscape();
			}
		};
		return cursorCompanion;
	}

	private void SetIntroSequenceActive(bool active)
	{
		introSequenceActive = active;
		CorePresenter?.SetOnboardingIntroOwnsStage(active);
		SyncNotchRouting();
	}

	private static string AssetPath(params string[] parts)
	{
		string baseDirectory = AppContext.BaseDirectory;
		string text = "Assets";
		int num = 0;
		string[] array = new string[2 + parts.Length];
		array[num] = baseDirectory;
		num++;
		array[num] = text;
		num++;
		ReadOnlySpan<string> readOnlySpan = new ReadOnlySpan<string>(parts);
		readOnlySpan.CopyTo(new Span<string>(array).Slice(num, readOnlySpan.Length));
		num += readOnlySpan.Length;
		return Path.Combine(new ReadOnlySpan<string>(array));
	}

	public void DemoIntroSequence(bool isReplay)
	{
		BeginOnboardingIntroSequence(isReplay);
	}

	public void ReplayOnboardingExperienceFromSettings()
	{
		if (Services.Auth.IsSignedIn && !introSequenceActive)
		{
			RealStack? real = Real;
			if (real == null || !real.Tutorial.IsEngaged)
			{
				TutorialWindow tutorialWindow = tutorial;
				if (tutorialWindow == null || !tutorialWindow.IsRunning)
				{
					Log.Info("video", "replaying the welcome tour from Settings");
					ClickyAnalytics.TrackOnboardingReplayed();
					CorePresenter?.DismissNotchAgentPeek();
					Services.Companion.Cancel();
					RealStack real2 = Real;
					if (real2 != null)
					{
						real2.Core.Settings.Update((AppSettings s) =>
						{
							s.Onboarding.TutorialCompletedAtEpochSeconds = null;
						});
					}
					else
					{
						Services.Settings.HasCompletedTutorial = false;
					}
					BeginOnboardingIntroSequence(isReplay: true);
					return;
				}
			}
		}
		Log.Info("video", "replay refused: not signed in, or the intro or the tour is already running");
	}

	private void BeginOnboardingIntroSequence(bool isReplay = false)
	{
		if (!introSequenceActive)
		{
			SetIntroSequenceActive(active: true);
			Log.Info("video", $"intro sequence started (replay: {isReplay})");
			ScreenDrawingCanvas.WarmUpFigures();
			RealStack real = Real;
			if (real != null && !cursorShownForOnboarding)
			{
				cursorShownForOnboarding = true;
				real.Cursor.Show();
			}
			HeaderPills.RaiseChanged();
			Services.Presenter.ReturnToIdle();
			StartOnboardingMusic(0.3);
			WelcomeThenVideoAsync(isReplay);
		}
	}

	private async Task WelcomeThenVideoAsync(bool isReplay)
	{
		try
		{
			await PlayCursorWelcomeAsync();
		}
		catch (Exception ex)
		{
			Log.Warn("video", "welcome: " + ex.Message);
		}
		AfterSeconds(0.5, () =>
		{
			SetupOnboardingVideo(isReplay);
		});
	}

	private void SetupOnboardingVideo(bool isReplay)
	{
		IReadOnlyList<CursorCompanion.Cue> readOnlyList;
		if (!(Environment.GetEnvironmentVariable("HEYCLICKY_NO_VIDEO_CUES") == "1"))
		{
			readOnlyList = OnboardingVideoCues(isReplay);
		}
		else
		{
			IReadOnlyList<CursorCompanion.Cue> readOnlyList2 = Array.Empty<CursorCompanion.Cue>();
			readOnlyList = readOnlyList2;
		}
		IReadOnlyList<CursorCompanion.Cue> cues = readOnlyList;
		(MediaPlayer, IntroVideoSourceKind)? tuple = TakeIntroPlayer();
		if (tuple.HasValue)
		{
			(MediaPlayer, IntroVideoSourceKind) valueOrDefault = tuple.GetValueOrDefault();
			if (PlayIntroReel(valueOrDefault, cues, isFallback: false))
			{
				if ((object)music != null)
				{
					music.Volume = 0.2;
				}
				return;
			}
		}
		FinishOnboardingVideoAndShowPrompt();
	}

	private void FinishOnboardingVideoAndShowPrompt()
	{
		FadeOutOnboardingMusic(3.0);
		AfterSeconds(2.0, () =>
		{
			SetIntroSequenceActive(active: false);
			HeaderPills.RaiseChanged();
			RealStack real = Real;
			if (real?.Tutorial.ShouldOfferAfterVideo(isUpgradingUser: false, real.Core.Auth.IsSignedIn) ?? (!Services.Settings.HasCompletedTutorial))
			{
				RealStack? real2 = Real;
				if (real2 == null || real2.Tutorial.PresentInvite())
				{
					Services.Presenter.ShowLiveEvent(new NotchLiveEvent.OnboardingTutorialInvite());
					Sounds.Play("clicky-question", 0.4);
					Real?.Companion.Mouth.EnsureOpenAsync();
					ClickyAnalytics.TrackOnboardingTutorialInvitePresented();
					return;
				}
			}
			SayAtCursorAsync("press " + Services.Settings.PushToTalkDisplay.ToLowerInvariant() + " to introduce yourself in your language");
		});
	}

	private IReadOnlyList<CursorCompanion.Cue> OnboardingVideoCues(bool isReplay)
	{
		return new _003C_003Ez__ReadOnlyArray<CursorCompanion.Cue>(new CursorCompanion.Cue[5]
		{
			new CursorCompanion.Cue(36.0, () =>
			{
				ClickyAnalytics.TrackOnboardingDemoTriggered();
				PointAtSomethingInterestingAsync();
			}),
			new CursorCompanion.Cue(60.0, () =>
			{
				OpenUrl("https://www.spacex.com/vehicles/starship");
			}),
			new CursorCompanion.Cue(67.0, () =>
			{
				if (!isReplay)
				{
					LaunchOnboardingDemoAgent(StarterCast.ResearchBuddy, "I'm the CEO of this rocket company you see on my screen. Can you research my competitors and save it as a PDF?", ResearchBuddyPrompt);
				}
			}),
			new CursorCompanion.Cue(85.0, () =>
			{
				if (!isReplay)
				{
					LaunchOnboardingDemoAgent(StarterCast.Shippy, "Can you make me a website for the beautiful person watching this video right now, and open it in the browser when you're done?", ShippyPrompt);
				}
			}),
			new CursorCompanion.Cue(110.0, () =>
			{
				OpenUrl("https://mail.google.com/mail/?view=cm&fs=1&to=hi@heyclicky.com&su=hi%20clicky%20team&body=%3Cjk%20my%20twitter%20dm%27s%20got%20way%20too%20crazy%2C%20so%20email%20me%20here%3E");
			})
		});
	}

	private async Task PointAtSomethingInterestingAsync()
	{
		RealStack real = Real;
		if (real != null && real.Core.Auth.IsSignedIn)
		{
			await OnboardingDemoPointer.RunAsync(real.Core, real.Capture, Services.Cursor, () => real.Companion.State);
		}
	}

	private void LaunchOnboardingDemoAgent(StarterCast.Member member, string spokenAsk, string prompt)
	{
		RealStack real = Real;
		if (real == null || !real.Core.Auth.IsSignedIn)
		{
			Log.Warn("video", "demo agent skipped: not signed in");
			return;
		}
		string context = "HeyClicky launched this job programmatically as part of the onboarding demo reel. Treat it as a canned demo, not a live user request. The user is brand new and is watching your progress, so your FIRST commentary message must be a short friendly line (two sentences, no list) that says what you're about to make for them. Every later progress message is one short plain line, like a text to a friend.";
		string slug = null;
		Task.Run(async () =>
		{
			try
			{
				string text = await real.Agents.LaunchAsync(new AgentLaunchRequest
				{
					Prompt = prompt,
					DisplayPrompt = spokenAsk,
					ClickySlug = slug,
					NewClickyName = ((slug == null) ? member.Name : null),
					NewClickyRole = member.Role,
					NewClickyOneLiner = member.OneLiner,
					LaunchContext = context,
					LaunchSource = "text",
					UsageContext = "onboarding",
					AutoApproveExtraUsage = true,
					IsGeneratedTaskBrief = true
				});
				Log.Info("video", "demo agent " + member.Name + " → " + text);
				onboardingDemoTaskIds[text] = 0;
			}
			catch (Exception ex)
			{
				Log.Warn("video", "demo agent " + member.Name + ": " + ex.Message);
			}
		});
	}

	private void StartOnboardingMusic(double volume)
	{
		if (Environment.GetEnvironmentVariable("HEYCLICKY_MUTE_AUDIO") == "1")
		{
			return;
		}
		try
		{
			string text = AssetPath("Audio", "ff.m4a");
			if (File.Exists(text))
			{
				music?.Dispose();
				music = new MediaPlayer
				{
					Source = MediaSource.CreateFromUri(new Uri(text)),
					IsLoopingEnabled = true,
					Volume = volume,
					AudioCategory = MediaPlayerAudioCategory.Media
				};
				music.Play();
			}
		}
		catch (Exception ex)
		{
			Log.Warn("music", ex.Message);
		}
	}

	private void FadeOutOnboardingMusic(double seconds)
	{
		MediaPlayer mp = music;
		if ((object)mp == null)
		{
			return;
		}
		music = null;
		double from = mp.Volume;
		int step = 0;
		DispatcherQueueTimer t = DispatcherQueue.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(seconds / 30.0);
		hostTimers.Add(t);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			step++;
			mp.Volume = Math.Max(0.0, from * (1.0 - (double)step / 30.0));
			if (step < 30)
			{
				return;
			}
			t.Stop();
			hostTimers.Remove(t);
			try
			{
				mp.Pause();
				mp.Dispose();
			}
			catch (Exception ex)
			{
				Log.Warn("music", "stop: " + ex.Message);
			}
		};
		t.Start();
	}

	private void AfterSeconds(double seconds, Action a)
	{
		DispatcherQueueTimer t = DispatcherQueue.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(Math.Max(0.001, seconds));
		t.IsRepeating = false;
		hostTimers.Add(t);
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			hostTimers.Remove(t);
			a();
		};
		t.Start();
	}

	private static Uri? IntroVideoUri(IntroVideoSourceKind kind)
	{
		if (kind == IntroVideoSourceKind.Hosted)
		{
			return new Uri("https://stream.mux.com/7bOYF1PGo02RKwcQW00L00Aa01iRKElKXoch4xhtsJzv8QU.m3u8");
		}
		string text = AssetPath("Video", "onboarding-intro-v2-windows.mp4");
		if (!File.Exists(text))
		{
			return null;
		}
		return new Uri(text);
	}

	private MediaPlayer? MakeIntroPlayer(IntroVideoSourceKind kind, string phase, bool muted)
	{
		Uri uri = IntroVideoUri(kind);
		if ((object)uri == null)
		{
			introVideoFailures.Report(new HostedVideoFailure("onboarding", phase, "bundled_resource_missing", "Assets/Video/onboarding-intro-v2-windows.mp4", "ClickyBundledVideo", -1, "Bundled onboarding video resource is missing"));
			return null;
		}
		try
		{
			return HeyClicky.App.Onboarding.CursorCompanion.CreatePlayer(uri, muted);
		}
		catch (Exception ex)
		{
			introVideoFailures.Report(new HostedVideoFailure("onboarding", phase, "player_create_failed", IntroVideoSources.Redacted(uri.ToString()), "MediaPlayer", ex.HResult, ex.Message));
			return null;
		}
	}

	private (MediaPlayer Player, IntroVideoSourceKind Source)? MakeIntroPlayerInOrder(string phase, bool muted)
	{
		IReadOnlyList<IntroVideoSourceKind> readOnlyList = IntroVideoSources.PlaybackOrder(IntroVideoSources.PrefersHosted);
		MediaPlayer mediaPlayer = MakeIntroPlayer(readOnlyList[0], phase, muted);
		if ((object)mediaPlayer != null)
		{
			return (mediaPlayer, readOnlyList[0]);
		}
		MediaPlayer mediaPlayer2 = MakeIntroPlayer(readOnlyList[1], phase + "_" + IntroVideoSources.AnalyticsName(readOnlyList[1]) + "_fallback", muted);
		if ((object)mediaPlayer2 != null)
		{
			return (mediaPlayer2, readOnlyList[1]);
		}
		return null;
	}

	private void PreloadOnboardingVideoIfNeeded()
	{
		if ((object)preloadedIntroPlayer == null && !HasCompletedOnboardingNow && !Options.UseFakes)
		{
			(MediaPlayer, IntroVideoSourceKind)? tuple = MakeIntroPlayerInOrder("preload", muted: true);
			if (tuple.HasValue)
			{
				(MediaPlayer, IntroVideoSourceKind) valueOrDefault = tuple.GetValueOrDefault();
				AdoptPreload(valueOrDefault.Item1, valueOrDefault.Item2, fallbackAllowed: true);
			}
		}
	}

	private void AdoptPreload(MediaPlayer mp, IntroVideoSourceKind source, bool fallbackAllowed)
	{
		preloadedIntroPlayer = mp;
		preloadedIntroSource = source;
		Log.Info("video", "intro reel preloading (" + IntroVideoSources.AnalyticsName(source) + ")");
		mp.MediaOpened += (MediaPlayer _, object _) =>
		{
			Log.Info("video", "intro reel preloaded (" + IntroVideoSources.AnalyticsName(source) + ")");
		};
		mp.MediaFailed += (MediaPlayer _, MediaPlayerFailedEventArgs e) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				if (!(preloadedIntroPlayer != mp))
				{
					introVideoFailures.Report(Failure("preload", (source == IntroVideoSourceKind.Hosted) ? "player_status_failed" : "bundled_player_status_failed", source, e));
					preloadedIntroPlayer = null;
					try
					{
						mp.Dispose();
					}
					catch
					{
					}
					IntroVideoSourceKind introVideoSourceKind = IntroVideoSources.Alternate(source);
					if (fallbackAllowed)
					{
						MediaPlayer mediaPlayer = MakeIntroPlayer(introVideoSourceKind, (source == IntroVideoSourceKind.Hosted) ? "preload_fallback" : "preload_hosted_fallback", muted: true);
						if ((object)mediaPlayer != null)
						{
							AdoptPreload(mediaPlayer, introVideoSourceKind, fallbackAllowed: false);
						}
					}
				}
			});
		};
	}

	private (MediaPlayer Player, IntroVideoSourceKind Source)? TakeIntroPlayer()
	{
		MediaPlayer mediaPlayer = preloadedIntroPlayer;
		if ((object)mediaPlayer != null)
		{
			preloadedIntroPlayer = null;
			return (mediaPlayer, preloadedIntroSource);
		}
		return MakeIntroPlayerInOrder("playback", muted: false);
	}

	private bool PlayIntroReel((MediaPlayer Player, IntroVideoSourceKind Source) made, IReadOnlyList<CursorCompanion.Cue> cues, bool isFallback)
	{
		var (mp, source) = made;
		if (!isFallback)
		{
			introVideoFailures.Reset();
		}
		bool flag = CursorCompanion.PlayVideo(mp, IntroVideoSources.Redacted(IntroVideoUri(source)?.ToString()), IntroVideoSources.AnalyticsName(source), cues, FinishOnboardingVideoAndShowPrompt, Failed);
		if (flag && !isFallback && source == IntroVideoSourceKind.Hosted && IntroVideoSources.ForcesHostedFailure)
		{
			AfterSeconds(0.1, () =>
			{
				if (!(CursorCompanion.CurrentPlayer != mp))
				{
					HostedVideoFailure failure = new HostedVideoFailure("onboarding", "playback", "debug_forced_hosted_failure", "https://stream.mux.com/7bOYF1PGo02RKwcQW00L00Aa01iRKElKXoch4xhtsJzv8QU.m3u8", "ClickyHostedVideoDebug", -9001, "Debug-forced hosted intro video failure");
					if (!FallBackAfterIntroFailure(mp, source, failure, cues, isFallback: false))
					{
						CursorCompanion.DismissVideo();
					}
				}
			});
		}
		return flag;
		bool Failed(MediaPlayerFailedEventArgs e)
		{
			return FallBackAfterIntroFailure(mp, source, Failure("playback", "item_status_failed", source, e), cues, isFallback);
		}
	}

	private bool FallBackAfterIntroFailure(MediaPlayer failed, IntroVideoSourceKind source, HostedVideoFailure failure, IReadOnlyList<CursorCompanion.Cue> cues, bool isFallback)
	{
		introVideoFailures.Report(failure);
		if (isFallback || CursorCompanion.CurrentPlayer != failed)
		{
			return false;
		}
		IntroVideoSourceKind introVideoSourceKind = IntroVideoSources.Alternate(source);
		string phase = ((source == IntroVideoSourceKind.Hosted) ? "playback_fallback_after_hosted_failure" : "playback_fallback_after_bundled_failure");
		MediaPlayer mediaPlayer = MakeIntroPlayer(introVideoSourceKind, phase, muted: true);
		if ((object)mediaPlayer == null)
		{
			return false;
		}
		Log.Info("video", "intro reel: " + IntroVideoSources.AnalyticsName(source) + " failed, starting over on " + IntroVideoSources.AnalyticsName(introVideoSourceKind));
		return PlayIntroReel((Player: mediaPlayer, Source: introVideoSourceKind), cues, isFallback: true);
	}

	public void StartOnboardingVideoDemoDryRun()
	{
		foreach (DispatcherQueueTimer dryRunTimer in dryRunTimers)
		{
			dryRunTimer.Stop();
		}
		dryRunTimers.Clear();
		IReadOnlyList<CursorCompanion.Cue> readOnlyList = OnboardingVideoCues(isReplay: false);
		Log.Info("video", $"dry run with {readOnlyList.Count} cues");
		foreach (CursorCompanion.Cue cue in readOnlyList)
		{
			DispatcherQueueTimer t = DispatcherQueue.CreateTimer().Rooted();
			t.Interval = TimeSpan.FromSeconds(cue.AtSeconds);
			t.IsRepeating = false;
			t.Tick += (DispatcherQueueTimer _, object _) =>
			{
				dryRunTimers.Remove(t);
				Log.Info("video", $"dry run: cue @{cue.AtSeconds:0}s");
				try
				{
					cue.Fire();
				}
				catch (Exception ex)
				{
					Log.Warn("video", $"dry run cue @{cue.AtSeconds}: {ex.Message}");
				}
			};
			dryRunTimers.Add(t);
			t.Start();
		}
	}

	private static HostedVideoFailure Failure(string phase, string reason, IntroVideoSourceKind source, MediaPlayerFailedEventArgs e)
	{
		return new HostedVideoFailure("onboarding", phase, reason, IntroVideoSources.Redacted(IntroVideoUri(source)?.ToString()), "MediaPlayer", e.ExtendedErrorCode?.HResult ?? ((int)e.Error), string.IsNullOrEmpty(e.ErrorMessage) ? e.Error.ToString() : e.ErrorMessage, "failed", "failed");
	}

	private void StartNotch()
	{
		if (!NotchExtensions.DocumentRenderers.OfType<NotchDocumentRenderer>().Any())
		{
			NotchDocumentRenderer.Register();
		}
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			corePresenter.HoverOpenedNotch += () =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					Sounds.Play("clicky-text-open", 0.22);
				});
			};
			corePresenter.DragOpenedChatAbandoned += ClickyAnalytics.TrackNotchFileDragAbandoned;
			corePresenter.Tabs.SelectionChanged += (NotchTab _) =>
			{
				DispatcherQueue.TryEnqueue(EndChatSessionIfLeftBehind);
			};
			corePresenter.NotchSessionChanged += () =>
			{
				DispatcherQueue.TryEnqueue(SyncNotchSizeContext);
			};
			corePresenter.Tabs.EntryLookup = (string id) => NotchChat.HandOffs?.Entry(id);
			corePresenter.Updates.JobThreadId = (string id) => Real?.Agents.Jobs.Job(id)?.ThreadId;
			corePresenter.PresentationChanged += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(OnNotchPresentationForDock);
			};
			NotchUi.SizeContext.ClickyUpdateHeight = ClickyUpdateHeight;
		}
		if (NotchExtensions.UpdateContent == null)
		{
			RealStack real = Real;
			NotchExtensions.UpdateContent = ((real != null) ? new WorkNotchUpdates(real.Agents, () => Real?.JobReports, this) : null);
		}
		if (NotchExtensions.RestingMarkState == null)
		{
			NotchExtensions.RestingMarkState = RestingMarkFromWork;
		}
		if (NotchExtensions.LiveWork == null)
		{
			RealStack real2 = Real;
			NotchExtensions.LiveWork = ((real2 != null) ? new WorkChatLiveWork(real2.Agents, () => Real?.JobReports) : null);
		}
		AttachClickyRoster();
		RealStack real3 = Real;
		if (real3 == null)
		{
			return;
		}
		real3.Agents.Routines.ProductEvent += TrackRoutineEvent;
		real3.Agents.ClickyFounded += (string slug) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				ClickyRoster.Shared.TrackCreated(slug, "agent");
			});
		};
		NotchChat.History = new ConversationHistory(() => real3.Core.Auth.UserId, ConversationHistory.WorkerFetcher(real3.Core.Worker));
		NotchChat.HandOffs = new ChatHandOffs(() => real3.Core.Auth.UserId)
		{
			Directory = new WorkHandOffDirectory(real3.Agents),
			RefreshHistorySoon = () =>
			{
				NotchChat.History?.Refresh();
			},
			TakeRestartInterruptions = () => (from t in real3.Agents.RestartInterruptions.TakeInterruptionsForChat()
				select (Slug: t.Slug, ThreadId: t.ThreadId, InterruptedAt: t.InterruptedAt)).ToList()
		};
		NotchChat.History.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(EndChatSessionIfLeftBehind);
		};
		NotchChat.Lessons = Lessons;
		ChatReplyPreview.StripCitationMarkers = CitationMarkers.Strip;
		FlowHooks.RendersTextInNotchChat = () => CorePresenter?.RendersTextResponsesInNotchChat ?? false;
		if (!observingNotchLinkOpens)
		{
			observingNotchLinkOpens = true;
			Markdown.LinkOpened += (XamlRoot? _, Uri _) =>
			{
				DispatcherQueue.TryEnqueue(FoldNotchForOpenedLink);
			};
		}
		FlowHooks.StepNotchChatAsideForDrawing = () =>
		{
			NotchPresenter corePresenter2 = CorePresenter;
			if (corePresenter2 == null || !corePresenter2.IsNotchChatSessionOpen)
			{
				return false;
			}
			DispatcherQueue.TryEnqueue(StepNotchChatAsideForDrawing);
			return true;
		};
		FlowHooks.NotchNote = NotchFullReplyFocusNote;
		real3.OpenHome = (string? _) =>
		{
			DispatcherQueue.TryEnqueue(OpenNotchHome);
			return true;
		};
		real3.CloseHome = () =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				CorePresenter?.DismissNotchAgentPeek();
			});
			return true;
		};
		AgentToolHost.Launched = (AgentToolLaunch launch, string taskId) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				NoteHandOffStarted(real3.Agents, taskId, launch.Prompt, isFollowUp: false);
			});
		};
		AgentToolHost.Steered = (string taskId, string text) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				NoteHandOffStarted(real3.Agents, taskId, text, isFollowUp: true);
			});
		};
		real3.Agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			AgentTaskEventKind kind = e.Kind;
			if ((kind == AgentTaskEventKind.StatusChanged || (uint)(kind - 8) <= 3u) ? true : false)
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					OnAgentTaskStatus(real3.Agents, e.TaskId);
				});
			}
		};
		real3.Agents.TasksChanged += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncRestingMark);
		};
		real3.Agents.Jobs.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncRestingMark);
		};
		OneBrainJobReports jobReports = real3.JobReports;
		if (jobReports != null)
		{
			jobReports.PresentingChanged += () =>
			{
				DispatcherQueue.TryEnqueue(SyncRestingMark);
			};
		}
		WireFinishedWork(real3);
		real3.Companion.StateChanged += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				FinishChatAnswerIfDone(real3);
			});
		};
		real3.Companion.TextDelivered += (string text, string? app, bool copied) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				NotchChat.HandOffs?.NoteTextDelivered(text, app, copied);
			});
		};
		real3.Companion.TurnFinished += (object? _, CompanionTurnFinish finish) =>
		{
			if (finish.WordedTurn)
			{
				double[] array = new double[2] { 1.5, 4.0 };
				for (int i = 0; i < array.Length; i++)
				{
					_ = Task.Delay(TimeSpan.FromSeconds(array[i])).ContinueWith((Task task) =>
					{
						NotchChat.History?.Refresh();
					}, TaskScheduler.Default);
				}
			}
		};
		real3.Core.Auth.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncNotchRouting);
		};
		real3.Core.Settings.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncNotchRouting);
		};
		real3.Tutorial.PropertyChanged += (object? _, PropertyChangedEventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncNotchRouting);
		};
		Services.Permissions.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SyncNotchRouting);
		};
		SyncNotchRouting();
		SyncRestingMark();
	}

	private void AttachClickyRoster()
	{
		if (!rosterAttached)
		{
			rosterAttached = true;
			ClickyRoster shared = ClickyRoster.Shared;
			AgentService agentService = Real?.Agents;
			IHomeSource source;
			if (agentService == null)
			{
				IHomeSource homeSource = new DemoHomeSource();
				source = homeSource;
			}
			else
			{
				IHomeSource homeSource = new AgentHomeSource(agentService);
				source = homeSource;
			}
			shared.Attach(source);
			ClickyRoster.IsOnboardingEngaged = () =>
			{
				RealStack? real = Real;
				return real != null && real.Tutorial?.IsEngaged == true;
			};
			AgentService agentService2 = Real?.Agents;
			if (agentService2 != null)
			{
				agentService2.Jobs.CloudColorsInUseByClickys = ClickyRoster.Shared.CloudColorsInUse;
			}
		}
	}

	private void TrackRoutineEvent(string productEvent, string? clickySlug, IReadOnlyDictionary<string, object?> properties)
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
		if (productEvent == "clicky_routine_created")
		{
			RealStack? real = Real;
			jsonObject["is_onboarding"] = real != null && real.Tutorial?.IsEngaged == true;
		}
		ClickyAnalytics.TrackProductEvent(productEvent, clickySlug, null, jsonObject);
	}

	private void SyncNotchRouting()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			bool isSignedIn = Services.Auth.IsSignedIn;
			bool hasCompletedOnboardingNow = HasCompletedOnboardingNow;
			bool flag = Real?.Tutorial.IsEngaged ?? false;
			bool nativeShell = !HeyClicky.App.Cody.CodyEngineBridge.EngineMode;
			corePresenter.SetHoverRoutesToNotch(nativeShell && (isSignedIn & hasCompletedOnboardingNow) && AllPermissionsGranted && !DrawnOnboardingTour.SuppressesNotchHover);
			corePresenter.SetRoutesTextModeToNotchChat(nativeShell && (isSignedIn & hasCompletedOnboardingNow) && !flag && !introSequenceActive);
			SyncRestingMark();
		}
	}

	private void OnNotchHoverDwell()
	{
		if (!Services.Auth.IsSignedIn)
		{
			return;
		}
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = CardVm;
		if ((notchOnboardingCardViewModel == null || !notchOnboardingCardViewModel.IsIntroHomeWelcomeActive) && !fakeIntroWelcomeActive)
		{
			Proactive?.RefreshMeetingsForNotchExpand();
			OnboardingTutorialViewModel onboardingTutorialViewModel = Real?.Tutorial;
			if (onboardingTutorialViewModel != null && onboardingTutorialViewModel.IsRestrictingNormalUse)
			{
				ShowTutorialResumeCard();
			}
		}
	}

	internal void SimulateNotchHoverDwell()
	{
		OnNotchHoverDwell();
	}

	public void OpenSettings()
	{
		OpenSettings(NotchSettingsSection.Account);
	}

	public void OpenSettings(NotchSettingsSection section)
	{
        if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return;
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			NotchExtensions.HomeDock?.NotchShowsHome(showsHome: false);
			corePresenter.Tabs.ShowSettings(section);
			Log.Info("notch", "settings: " + section.RawValue());
		}
	}

	public void OpenSettings(SettingsWindow.Page page)
	{
		OpenSettings(NotchSettingsTab.ToSection(page));
	}

	public void OpenNotchHome()
	{
        if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return;
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null && !introSequenceActive)
		{
			corePresenter.Tabs.Show(NotchTab.Chat, null);
			corePresenter.OpenNotchAgentPeekOnRequest();
		}
	}

	public void ShowInChat(string? jobId, string? clickySlug)
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			string focusingEntryId = NotchChat.HandOffs?.LatestEntryId(jobId, clickySlug);
			corePresenter.Tabs.Show(NotchTab.Chat, focusingEntryId);
			corePresenter.OpenNotchAgentPeekOnRequest();
		}
	}

	public bool OpenDocumentInNotch(string path, string? threadId)
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null || !ArtifactPaths.SupportsInline(path))
		{
			return false;
		}
		corePresenter.Tabs.ShowDocument(Path.GetFullPath(path), threadId);
		return true;
	}

	public void FoldNotchForOpenedLink()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null && corePresenter.IsShowingNotchAgentPeek)
		{
			corePresenter.DismissNotchAgentPeek();
		}
	}

	private void OnNotchPresentationForDock()
	{
		bool flag = CorePresenter?.IsShowingNotchAgentPeek ?? false;
		if (flag == notchWasOpen)
		{
			return;
		}
		notchWasOpen = flag;
		if (!flag)
		{
			NotchExtensions.HomeDock?.NotchFolded("the notch folded away");
			return;
		}
		INotchHomeDock? homeDock = NotchExtensions.HomeDock;
		if (homeDock != null)
		{
			NotchPresenter? corePresenter = CorePresenter;
			homeDock.NotchShowsHome(!HeyClicky.App.Cody.CodyChrome.Enabled && corePresenter != null && corePresenter.Tabs.Selected == NotchTab.Home);
		}
	}

	private void SyncNotchSizeContext()
	{
		NotchUi.Relayout();
	}

	internal bool ToggleNotchChatFromShortcut()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null)
		{
			return false;
		}
		if (!corePresenter.RoutesTextModeToNotchChat && !corePresenter.IsNotchChatSessionOpen)
		{
			return false;
		}
		if (corePresenter.IsNotchChatSessionOpen && corePresenter.NotchChatComposerHasKeyboard && NotchUi.HasKeyboard)
		{
			corePresenter.CloseNotchChatSession(NotchChatSessionCloseReason.DoubleControl);
			NotchUi.ReleaseKeyboard();
			Services.Audio.PlayEarcon("textClose");
		}
		else if (corePresenter.IsNotchChatSessionOpen)
		{
			corePresenter.Tabs.ShowChatForTyping(corePresenter.IsShowingNotchAgentPeek);
			corePresenter.Tabs.RequestComposerFocus();
			Services.Audio.PlayEarcon("textOpen");
		}
		else
		{
			corePresenter.OpenNotchChatSession();
			Services.Audio.PlayEarcon("textOpen");
		}
		return true;
	}

	internal bool HandleNotchEscape()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null)
		{
			return false;
		}
		if (corePresenter.Tabs.IsShowingDocument)
		{
			corePresenter.Tabs.CloseDocument();
			return true;
		}
		if (corePresenter.Tabs.ExpandedReplyEntryId != null && corePresenter.Tabs.Selected == NotchTab.Chat && corePresenter.IsShowingNotchAgentPeek)
		{
			corePresenter.Tabs.CloseFullReply(NotchChatFullReplyCloseVia.Escape);
			return true;
		}
		if (!corePresenter.IsNotchChatSessionOpen)
		{
			return false;
		}
		bool flag = corePresenter.IsTextResponseInProgress;
		if (!flag)
		{
			VoiceState state = Services.Companion.State;
			bool flag2 = (uint)(state - 2) <= 1u;
			flag = flag2;
		}
		if (flag)
		{
			Services.Companion.Cancel();
			corePresenter.Present(new NotchPresentation.Idle());
			NotchChat.History?.NoteAnswerStopped();
		}
		else
		{
			corePresenter.CloseNotchChatSession(NotchChatSessionCloseReason.Escape);
			NotchUi.ReleaseKeyboard();
			Services.Audio.PlayEarcon("textClose");
		}
		return true;
	}

	internal bool NotchEscapeWouldClaim()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null)
		{
			return false;
		}
		if (!corePresenter.IsNotchChatSessionOpen)
		{
			return NotchViewerEscapeWouldClaim();
		}
		return true;
	}

	internal bool NotchViewerEscapeWouldClaim()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null)
		{
			return false;
		}
		if (!corePresenter.IsNotchDocumentOpen)
		{
			if (corePresenter.Tabs.ExpandedReplyEntryId != null)
			{
				return corePresenter.IsShowingNotchAgentPeek;
			}
			return false;
		}
		return true;
	}

	private void EndChatSessionIfLeftBehind()
	{
		CorePresenter?.EndNotchChatSessionIfLeftBehind(NotchChat.History?.IsAwaitingAnswerToSentMessage ?? false);
	}

	private void FinishChatAnswerIfDone(RealStack real)
	{
		EndChatSessionIfLeftBehind();
		if (real.Companion.State != VoiceState.Idle)
		{
			return;
		}
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null || !corePresenter.RendersTextResponsesInNotchChat)
		{
			return;
		}
		NotchPresentation.TextResponse currentTextResponse = corePresenter.CurrentTextResponse;
		if ((object)currentTextResponse != null)
		{
			if (!currentTextResponse.IsThinking && currentTextResponse.Answer.Trim().Length > 0)
			{
				NotchChat.History?.NoteAssistantReplyFinished(currentTextResponse.Answer);
				NotchChat.History?.RefreshSoon();
			}
			else
			{
				NotchChat.History?.NoteAnswerStopped();
			}
			corePresenter.Present(new NotchPresentation.Idle());
		}
	}

	private void StepNotchChatAsideForDrawing()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null || !corePresenter.IsNotchChatSessionOpen)
		{
			return;
		}
		if (corePresenter.RendersTextResponsesInNotchChat)
		{
			NotchPresentation.TextResponse currentTextResponse = corePresenter.CurrentTextResponse;
			if ((object)currentTextResponse != null && !currentTextResponse.IsThinking && currentTextResponse.Answer.Trim().Length > 0)
			{
				NotchChat.History?.NoteAssistantReplyFinished(currentTextResponse.Answer);
				NotchChat.History?.RefreshSoon();
				corePresenter.Present(new NotchPresentation.Idle());
			}
		}
		Log.Info("notch", "the answer draws on the screen: the chat steps aside");
		corePresenter.CloseNotchChatSession(NotchChatSessionCloseReason.DrawingCaption);
	}

	internal bool AllowsChatSubmission()
	{
		if (!TourHoldsHome)
		{
			return true;
		}
		Log.Info("tour", "chat send refused during the reveal");
		TourRefusal("sorry, let me finish the tour first. you can send this right after!");
		return false;
	}

	public void SubmitChatText(string text, IReadOnlyList<string> files)
	{
		ProactiveCoordinator? proactive = Proactive;
		if (proactive == null || !proactive.SubmitRemoteTaskModification(text))
		{
			Services.Companion.SubmitTextAsync(text, files);
		}
	}

	private string? NotchFullReplyFocusNote()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null && corePresenter.IsShowingNotchAgentPeek)
		{
			string expandedReplyEntryId = corePresenter.Tabs.ExpandedReplyEntryId;
			if (expandedReplyEntryId != null)
			{
				ChatHandOff chatHandOff = NotchChat.HandOffs?.Entry(expandedReplyEntryId);
				if ((object)chatHandOff == null)
				{
					return null;
				}
				string clickySlug = chatHandOff.ClickySlug;
				if (clickySlug != null)
				{
					ClickyInfo clickyInfo = Real?.Agents.FindClicky(clickySlug);
					if ((object)clickyInfo != null)
					{
						string value = clickyInfo.Name.Replace("\"", "'");
						return $"[Notch] The user held the voice keys while a reply from \"{value}\" (clicky_slug: {clickyInfo.Slug}) was open in full in the notch. Their words are most likely for or about {value}. Use judgment: an instruction, a change, or an answer to what it asked goes to it with sessions_send (that clicky_slug), and you say in a few words that you passed it on; " + "a question about what it did or found you answer yourself (clicky_memory); if they clearly mean another Clicky or something else, do that instead.";
					}
				}
				if (chatHandOff.JobId != null)
				{
					string text = (chatHandOff.TaskTitle ?? chatHandOff.Title).Replace("\"", "'");
					if (text.Length > 80)
					{
						text = text.Substring(0, 80);
					}
					string threadId = chatHandOff.ThreadId;
					if (threadId == null)
					{
						return "[Notch] The user held the voice keys while the job \"" + text + "\"'s reply was open in full in the notch. Their words are most likely about it.";
					}
					return $"[Notch] The user held the voice keys while the job \"{text}\" (codexThreadId: {threadId})'s reply was open in full in the notch. " + "Their words are most likely for or about this job. Use judgment: an instruction, a change, or an answer to what it asked goes to it with sessions_send (that codexThreadId), and you say in a few words that you passed it on; a question about its progress or result you answer yourself (session_status); if they clearly mean something else, do that instead.";
				}
				return null;
			}
		}
		return null;
	}

	public void OpenChatArtifact(string entry, string? threadId, string? clickySlug)
	{
		string workspace;
		if (clickySlug == null)
		{
			workspace = ((threadId == null) ? null : Real?.Agents.Jobs.JobForThread(threadId)?.FolderPath);
		}
		else
		{
			workspace = Real?.Agents.WorkspacePath(clickySlug);
		}
		string path = ArtifactPaths.Resolve(entry, workspace);
		if (!ArtifactPaths.IsWebLink(path) && OpenDocumentInNotch(path, threadId))
		{
			return;
		}
		CorePresenter?.DismissNotchAgentPeek();
		DispatcherQueue.TryEnqueue(() =>
		{
			if (ArtifactPaths.IsWebLink(path) || File.Exists(path) || Directory.Exists(path))
			{
				OpenUrl(path);
			}
			else
			{
				ArtifactPaths.Reveal(path);
			}
		});
	}

	public void SendChatFollowUp(ChatHandOff entry, string followUp)
	{
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		bool flag = false;
		string clickySlug = entry.ClickySlug;
		if (clickySlug != null && (object)real.Agents.FindClicky(clickySlug) != null)
		{
			real.Agents.LaunchAsync(new AgentLaunchRequest
			{
				Prompt = followUp,
				ClickySlug = clickySlug,
				LaunchContext = "The user tapped one of the follow-ups you suggested under your last reply.",
				LaunchSource = "text"
			});
			NotchChat.HandOffs?.NoteStarted(clickySlug, null, isFollowUp: true, followUp);
			flag = true;
		}
		else
		{
			object obj = entry.JobId;
			if (obj == null)
			{
				string threadId = entry.ThreadId;
				obj = ((threadId == null) ? null : real.Agents.Jobs.JobForThread(threadId)?.Id);
			}
			string text = (string)obj;
			if (text != null)
			{
				ClickyJob clickyJob = real.Agents.Jobs.Job(text);
				if ((object)clickyJob != null)
				{
					real.Agents.LaunchAsync(new AgentLaunchRequest
					{
						Prompt = followUp,
						JobId = clickyJob.Id,
						TargetThreadId = clickyJob.ThreadId,
						LaunchContext = "The user tapped one of the follow-ups you suggested under your last reply.",
						LaunchSource = "text"
					});
					NotchChat.HandOffs?.NoteStarted(null, clickyJob.ThreadId, isFollowUp: true, followUp);
					flag = true;
				}
			}
		}
		if (flag)
		{
			Sounds.Play("clicky-text-send", 0.2);
			bool flag2 = CorePresenter?.Tabs.ExpandedReplyEntryId == entry.Id;
			ClickyAnalytics.TrackProductEvent("notch_peek_action", entry.ClickySlug, entry.ThreadId, NotchChatAnalytics.ChatFollowUpSuggestion(entry, followUp, flag2));
			if (flag2)
			{
				CorePresenter?.Tabs.CloseFullReply(NotchChatFullReplyCloseVia.FollowUpSent);
			}
		}
	}

	public void OpenInItsApp(string path, string? threadId)
	{
		ClickyAnalytics.TrackArtifactAction("open_in_app", path, null, new JsonObject { ["success"] = true });
		CorePresenter?.DismissNotchAgentPeek();
		ChatBlockViews.OpenPath(path);
	}

	public void RevealInExplorer(string path)
	{
		ClickyAnalytics.TrackArtifactAction("reveal_in_finder", path);
		ArtifactPaths.Reveal(path);
	}

	public void PlayDrawing(string lessonId, bool onWhiteBoard)
	{
		LessonService service = Lessons;
		if (service == null)
		{
			return;
		}
		StoredLesson lesson = service.Store.List().FirstOrDefault((StoredLesson l) => l.Data.Id == lessonId);
		if (lesson == null)
		{
			return;
		}
		CorePresenter?.DismissNotchAgentPeek();
		DispatcherQueue.TryEnqueue(() =>
		{
			if (onWhiteBoard)
			{
				service.PlayAsync(lesson, withVoice: true, onWhiteBoard: true);
			}
			else
			{
				service.PlayInWindow(lesson);
			}
		});
	}

	private void PlayAgentEarcon(string name, float volume)
	{
		if (!EarconsMuted)
		{
			Real?.Audio.PlayEarcon(name, volume);
		}
	}

	private void WireFinishedWork(RealStack real)
	{
		AgentService agents = real.Agents;
		agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			AgentTaskEventKind kind = e.Kind;
			if ((kind == AgentTaskEventKind.Failed || kind == AgentTaskEventKind.NeedsExtraUsageApproval) ? true : false)
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					PlayAttentionCue(agents, e.TaskId, e.Kind);
				});
			}
		};
		OneBrainJobReports jobReports = real.JobReports;
		if (jobReports != null)
		{
			jobReports.ReportPresented += (IReadOnlyList<string> _, IReadOnlyList<string> lines) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					NotchChat.History?.NoteAssistantReport(string.Join("\n\n", lines));
					NotchChat.History?.RefreshSoon();
				});
			};
			jobReports.HeadsUpReady += (string taskId) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					PresentEdgeDockWindow(agents, taskId, "finished");
				});
			};
		}
		agents.ResultCardShown += (string threadId) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				ClickyAnswer clickyAnswer = agents.ResultCard(threadId);
				if ((object)clickyAnswer != null)
				{
					JsonObject jsonObject = AnswerJson(clickyAnswer);
					if (jsonObject != null)
					{
						NotchChat.HandOffs?.NoteCard(jsonObject, threadId);
					}
				}
			});
		};
		if (PresentTaskNeedsYouHook == null)
		{
			Action<string> action = (PresentTaskNeedsYouHook = (string threadId) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					string text = agents.TaskIdForThread(threadId);
					if (text != null)
					{
						PresentEdgeDockWindow(agents, text, "needs_you");
					}
					else
					{
						ClickyJob clickyJob = agents.Jobs.JobForThread(threadId);
						if ((object)clickyJob != null)
						{
							PresentJobUpdate(agents, clickyJob, NotchUpdateKind.NeedsYou, "needs_you");
						}
					}
				});
			});
		}
		if (DismissNotchUpdateHook == null)
		{
			Action action3 = (DismissNotchUpdateHook = () =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					CorePresenter?.Updates.DismissCurrent();
				});
			});
		}
		real.AgentVoice.FinishShowsOnNotchCard = FinishShowsOnNotchCard;
		NotchExtensions.AnnounceFinishedWorkOnRequest = AnnounceFinishedWorkOnRequest;
		NotchExtensions.MarkFinishedWorkSeen = (NotchUpdateContent content) =>
		{
			string jobId = content.JobId;
			if (jobId != null)
			{
				agents.Jobs.MarkSeen(jobId);
			}
			else
			{
				string clickySlug = content.ClickySlug;
				if (clickySlug != null)
				{
					ClickyReadMarks.MarkRead(clickySlug);
				}
			}
		};
	}

	private static JsonObject? AnswerJson(ClickyAnswer? answer)
	{
		if ((object)answer != null)
		{
			return JsonSerializer.SerializeToNode(answer) as JsonObject;
		}
		return null;
	}

	private void PlayAttentionCue(AgentService agents, string taskId, AgentTaskEventKind kind)
	{
		AgentTaskDetail taskDetail = agents.GetTaskDetail(taskId);
		if ((object)taskDetail == null)
		{
			return;
		}
		if (taskDetail.IsDemo)
		{
			RealStack? real = Real;
			if (real != null && real.Tutorial.IsEngaged)
			{
				return;
			}
		}
		if (kind == AgentTaskEventKind.NeedsExtraUsageApproval)
		{
			if (announcedExtraUsage.Add(taskId))
			{
				PlayAgentEarcon("agentNeedsYou", 0.8f);
			}
		}
		else
		{
			if (taskDetail.RequiresExtraUsageApproval)
			{
				return;
			}
			if ((object)taskDetail != null && taskDetail.IsRoutineRun)
			{
				CompanionError error = taskDetail.Error;
				if ((object)error != null && error.Code == "agent_offline")
				{
					return;
				}
			}
			PlayAgentEarcon("clickySurprised", 0.7f);
		}
	}

	private static bool QuietSilencesAgentFinish(bool isScheduledRoutineRun)
	{
		if (QuietContext.IgnoredForTests)
		{
			return false;
		}
		if (QuietContext.IsAnotherAppUsingMicrophone() || QuietContext.QueryNotificationState() == QuietContext.NotificationState.PresentationMode)
		{
			return true;
		}
		if (isScheduledRoutineRun)
		{
			return QuietContext.IsDoNotDisturbOn();
		}
		return false;
	}

	private void NoteHandOffStarted(AgentService agents, string taskId, string words, bool isFollowUp, int attempt = 0)
	{
		AgentTaskDetail taskDetail = agents.GetTaskDetail(taskId);
		if (!isFollowUp)
		{
			string text = taskDetail?.JobId;
			if (text != null)
			{
				ClickyJob clickyJob = agents.Jobs.Job(text);
				if ((object)clickyJob != null)
				{
					NotchChat.HandOffs?.NoteStartedJob(clickyJob.Id, clickyJob.Title);
					return;
				}
			}
		}
		if (taskDetail?.ClickySlug == null && taskDetail?.Snapshot.ThreadId == null && attempt < 15)
		{
			DispatcherQueueTimer dispatcherQueueTimer = DispatcherQueue.CreateTimer().Rooted();
			dispatcherQueueTimer.Interval = TimeSpan.FromMilliseconds(200L, 0L);
			dispatcherQueueTimer.IsRepeating = false;
			dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
			{
				NoteHandOffStarted(agents, taskId, words, isFollowUp, attempt + 1);
			};
			dispatcherQueueTimer.Start();
		}
		else
		{
			NotchChat.HandOffs?.NoteStarted(taskDetail?.ClickySlug, taskDetail?.Snapshot.ThreadId, isFollowUp, words);
		}
	}

	private void OnAgentTaskStatus(AgentService agents, string taskId)
	{
		AgentTaskDetail taskDetail = agents.GetTaskDetail(taskId);
		if ((object)taskDetail == null)
		{
			return;
		}
		AgentTaskStatus status = taskDetail.Snapshot.Status;
		if (lastAgentStatus.TryGetValue(taskId, out var value) && value == status)
		{
			return;
		}
		lastAgentStatus[taskId] = status;
		ChatHandOffOutcome? chatHandOffOutcome = status switch
		{
			AgentTaskStatus.Finished => (ChatHandOffOutcome?)ChatHandOffOutcome.Finished, 
			AgentTaskStatus.Failed => ChatHandOffOutcome.Failed, 
			AgentTaskStatus.Stopped => ChatHandOffOutcome.Stopped, 
			AgentTaskStatus.WaitingForUser => ChatHandOffOutcome.NeedsYou, 
			_ => null, 
		};
		SyncRestingMark();
		if (!chatHandOffOutcome.HasValue)
		{
			return;
		}
		ChatHandOffOutcome valueOrDefault = chatHandOffOutcome.GetValueOrDefault();
		string threadId = taskDetail.Snapshot.ThreadId;
		ChatHandOffs? handOffs = NotchChat.HandOffs;
		if (handOffs != null)
		{
			ChatTaskEnd chatTaskEnd = new ChatTaskEnd
			{
				JobId = taskDetail.JobId,
				ClickySlug = taskDetail.ClickySlug,
				ThreadId = threadId,
				IsDemo = taskDetail.IsDemo,
				PendingUserStep = (taskDetail.PendingUserStep?.Step ?? ((status == AgentTaskStatus.WaitingForUser && !taskDetail.RequiresExtraUsageApproval) ? (taskDetail.Summary ?? taskDetail.ProgressSummary) : null)),
				NeedsChromeConnection = (threadId != null && agents.NeedsChromeConnection(threadId)),
				FinalSummary = ((valueOrDefault == ChatHandOffOutcome.Failed) ? (taskDetail.FailureMessage ?? taskDetail.Summary) : taskDetail.Summary),
				FinalResponseMarkdown = taskDetail.Snapshot.FinalResponseMarkdown
			};
			string text = agents.FullReplyText(taskId);
			IReadOnlyList<string> completedAssistantMessages;
			if (text == null || text.Length <= 0)
			{
				string finalResponseMarkdown = taskDetail.Snapshot.FinalResponseMarkdown;
				if (finalResponseMarkdown == null || finalResponseMarkdown.Length <= 0)
				{
					IReadOnlyList<string> readOnlyList = Array.Empty<string>();
					completedAssistantMessages = readOnlyList;
				}
				else
				{
					IReadOnlyList<string> readOnlyList = new _003C_003Ez__ReadOnlySingleElementList<string>(finalResponseMarkdown);
					completedAssistantMessages = readOnlyList;
				}
			}
			else
			{
				IReadOnlyList<string> readOnlyList = new _003C_003Ez__ReadOnlySingleElementList<string>(text);
				completedAssistantMessages = readOnlyList;
			}
			chatTaskEnd = chatTaskEnd with { CompletedAssistantMessages = completedAssistantMessages };
			chatTaskEnd = chatTaskEnd with { UserFacingArtifactPaths = taskDetail.Artifacts };
			chatTaskEnd = chatTaskEnd with { SuggestedNextActions = taskDetail.NextActions };
			chatTaskEnd = chatTaskEnd with { FinalAnswer = AnswerJson(taskDetail.Answer) };
			chatTaskEnd = chatTaskEnd with { IsScheduledRoutineRun = taskDetail.IsRoutineRun };
			chatTaskEnd = chatTaskEnd with { CompletedThreadName = taskDetail.DoneTitle ?? taskDetail.Snapshot.Title };
			handOffs.NoteTaskEnded(chatTaskEnd, (valueOrDefault != ChatHandOffOutcome.NeedsYou) ? valueOrDefault : ChatHandOffOutcome.Finished);
		}
		if (taskDetail.IsDemo)
		{
			return;
		}
		switch (status)
		{
		case AgentTaskStatus.Finished:
			if (agents.PendingComputerUseRequest(taskId) != null)
			{
				PresentEdgeDockWindow(agents, taskId, "needs_you");
				AnnounceComputerUseAsk?.Invoke(taskId);
			}
			else
			{
				AnnounceFinishOnCard(agents, taskDetail);
			}
			break;
		case AgentTaskStatus.Failed:
			PresentEdgeDockWindow(agents, taskId, taskDetail.RequiresExtraUsageApproval ? "needs_you" : "failed");
			break;
		case AgentTaskStatus.Stopped:
			if (taskDetail.RequiresExtraUsageApproval)
			{
				PresentEdgeDockWindow(agents, taskId, "needs_you");
			}
			break;
		case AgentTaskStatus.WaitingForUser:
			PresentEdgeDockWindow(agents, taskId, "needs_you");
			break;
		}
	}

	private void AnnounceFinishOnCard(AgentService agents, AgentTaskDetail detail)
	{
		string taskId = detail.Snapshot.TaskId;
		if (agents.IsTaskWaitingOnUserAnswer(taskId))
		{
			return;
		}
		if (QuietSilencesAgentFinish(detail.IsRoutineRun))
		{
			Log.Info("notch", "finish of " + taskId + " not announced: quiet (a call, a screen share, or Do Not Disturb for a routine run)");
			return;
		}
		RealStack? real = Real;
		int num;
		if (real == null || !real.Core.Settings.Read((AppSettings s) => s.AgentAnnouncementsVoiceEnabled))
		{
			RealStack? real2 = Real;
			num = ((real2 == null || !real2.Core.Settings.Read((AppSettings s) => s.AgentCursorTextAnnouncementsEnabled)) ? 1 : 0);
		}
		else
		{
			num = 0;
		}
		bool flag = (byte)num != 0;
		bool flag2 = !detail.IsRoutineRun && !flag;
		bool flag3 = detail.JobId != null && ClickyJobsPreferences.IsEnabled;
		bool flag4 = !flag3 && !detail.IsDemo && !detail.IsRoutineRun && detail.ClickySlug != null;
		bool flag5 = FinishOpensInNotchViewer(detail);
		bool flag6 = flag5 || ((flag3 | flag4) && DockShowsFinishes);
		int num2;
		if (flag6 && !flag5)
		{
			RealStack? real3 = Real;
			num2 = ((real3 != null && real3.JobReports?.HoldHeadsUpForCard(OneBrainJobReports.TurnKey(taskId, detail.TurnId), flag2) == true) ? 1 : 0);
		}
		else
		{
			num2 = 0;
		}
		bool flag7 = (byte)num2 != 0;
		Log.Info("notch", $"finish of {taskId}: on card {flag6} (job {flag3}, docked Clicky {flag4}, dock shows finishes {DockShowsFinishes}), in viewer {flag5}, heads-up waits for the brain's card {flag7}");
		if (flag2 && !flag7)
		{
			PlayAgentEarcon("agentDone", 0.7f);
		}
		if (flag6 && !flag5 && !flag7)
		{
			PresentEdgeDockWindow(agents, taskId, "finished");
		}
	}

	internal bool FinishShowsOnNotchCard(AgentTaskDetail detail)
	{
		if (detail.IsDemo || detail.IsRoutineRun)
		{
			return false;
		}
		if (FinishOpensInNotchViewer(detail))
		{
			return true;
		}
		int num;
		int num2;
		if (detail.JobId != null)
		{
			num = (ClickyJobsPreferences.IsEnabled ? 1 : 0);
			if (num != 0)
			{
				num2 = 0;
				goto IL_003f;
			}
		}
		else
		{
			num = 0;
		}
		num2 = ((detail.ClickySlug != null) ? 1 : 0);
		goto IL_003f;
		IL_003f:
		bool flag = (byte)num2 != 0;
		if (((uint)num | (flag ? 1u : 0u)) != 0)
		{
			return DockShowsFinishes;
		}
		return false;
	}

	private bool FinishOpensInNotchViewer(AgentTaskDetail detail)
	{
		RealStack real = Real;
		if (real == null || CorePresenter == null || detail.IsDemo || onboardingDemoTaskIds.ContainsKey(detail.Snapshot.TaskId) || real.Tutorial.IsEngaged)
		{
			return false;
		}
		if (detail.JobId != null)
		{
			return false;
		}
		string text = detail.Artifacts.FirstOrDefault()?.Trim();
		if (string.IsNullOrEmpty(text))
		{
			return false;
		}
		string clickySlug = detail.ClickySlug;
		string workspace = ((clickySlug != null) ? (real.Agents.WorkspacePath(clickySlug) ?? detail.WorkspacePath) : detail.WorkspacePath);
		string text2 = ArtifactPaths.Resolve(text, workspace);
		if (!ArtifactPaths.IsWebLink(text2) && File.Exists(text2))
		{
			return ArtifactPaths.SupportsInline(text2);
		}
		return false;
	}

	private void AnnounceFinishedWorkOnRequest(NotchUpdateContent content)
	{
		RealStack real = Real;
		if (real == null || !real.Core.Settings.Read((AppSettings s) => s.AgentAnnouncementsVoiceEnabled))
		{
			return;
		}
		OneBrainJobReports jobReports = real.JobReports;
		if ((jobReports == null || !jobReports.SpeakOnRequest(content.ThreadId)) && real.Companion.State == VoiceState.Idle)
		{
			string line = ClickyNotes.FinishedLine(content.Title, content.Summary ?? "");
			Log.Info("notch", "finished work said on request: " + content.RailKey);
			real.Companion.AnnounceAsync(line, real.Core.Settings.Read((AppSettings s) => s.AgentCursorTextAnnouncementsEnabled));
		}
	}

	internal void PresentEdgeDockWindow(AgentService agents, string taskId, string reason)
	{
		if (CorePresenter != null && EdgeDockIsRunning)
		{
			AgentTaskDetail taskDetail = agents.GetTaskDetail(taskId);
			if ((object)taskDetail != null && !taskDetail.IsDemo)
			{
				string threadId = taskDetail.Snapshot.ThreadId;
				string jobId = taskDetail.JobId;
				ClickyJob clickyJob;
				if (jobId != null)
				{
					clickyJob = agents.Jobs.Job(jobId);
				}
				else
				{
					clickyJob = ((threadId == null) ? null : agents.Jobs.JobForThread(threadId));
				}
				string text = taskDetail.ClickySlug ?? ((threadId == null) ? null : agents.Clickys.FirstOrDefault((ClickyInfo c) => c.ThreadId == threadId)?.Slug);
				bool flag = agents.PendingComputerUseRequest(taskId) != null || taskDetail.RequiresExtraUsageApproval || (object)taskDetail.PendingUserStep != null || (threadId != null && agents.NeedsChromeConnection(threadId)) || ((text == null) ? ((object)clickyJob != null && agents.RailPhase(clickyJob) == ClickyJobRailPhase.NeedsYou) : (agents.LiveStatusForClicky(text).Phase == ClickyAppLiveStatus.Phases.NeedsYou && reason != "failed"));
				NotchUpdateKind kind = ((!((reason == "needs_you") | flag)) ? ((reason == "failed") ? NotchUpdateKind.Failed : NotchUpdateKind.Done) : NotchUpdateKind.NeedsYou);
				Log.Info("notch", $"presentEdgeDockWindow reason={reason} task={threadId ?? "nil"} job={clickyJob?.Id ?? "nil"} slug={text ?? "nil"} kind={kind.RawValue()}");
				if (text != null)
				{
					CorePresenter.Updates.Present(text, kind);
					ClickyAnalytics.TrackProductEvent("clicky_dashboard_action", text, null, new JsonObject
					{
						["action"] = "notch_card_shown",
						["reason"] = reason
					});
				}
				else if ((object)clickyJob != null)
				{
					PresentJobUpdate(agents, clickyJob, kind, reason);
				}
				return;
			}
		}
		Log.Info("notch", $"presentEdgeDockWindow reason={reason} task={taskId}: skipped (dock running {EdgeDockIsRunning}, task known {(object)agents.GetTaskDetail(taskId) != null})");
	}

	private void PresentJobUpdate(AgentService agents, ClickyJob job, NotchUpdateKind kind, string reason)
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null && (!job.IsDismissed || kind != NotchUpdateKind.Done))
		{
			corePresenter.Updates.Present(job.RailKey, kind);
			agents.TrackJobAction("notch_card_shown", job.ThreadId, new Dictionary<string, object> { ["reason"] = reason });
		}
	}

	private double ClickyUpdateHeight(NotchLiveEvent.ClickyUpdate update)
	{
		NotchUpdateKind notchUpdateKind = NotchUpdateKindNames.Parse(update.Kind);
		NotchUpdateContent notchUpdateContent = NotchExtensions.UpdateContent?.Content(update.RailKey);
		if ((object)notchUpdateContent == null)
		{
			return ClickyUpdateLayout.PanelHeight(notchUpdateKind, null, hasPreview: false);
		}
		string detail = ClickyUpdateLayout.Detail(notchUpdateKind, notchUpdateContent);
		bool hasPreview = notchUpdateKind == NotchUpdateKind.Done && notchUpdateContent.Files.Any((string f) => !ArtifactPaths.IsWebLink(f) && File.Exists(f));
		return ClickyUpdateLayout.PanelHeight(notchUpdateKind, detail, hasPreview);
	}

	private NotchRestingMarkState RestingMarkFromWork()
	{
		AgentService agents = Real?.Agents;
		if (agents == null || !EdgeDockIsRunning)
		{
			return new NotchRestingMarkState(0, "idle");
		}
		OneBrainJobReports oneBrainJobReports = Real?.JobReports;
		int num = 0;
		bool flag = false;
		bool flag2 = false;
		foreach (string item in (from t in agents.Tasks
			select agents.GetTaskDetail(t.TaskId) into d
			where (object)d != null && !d.IsDemo
			select d.ClickySlug).OfType<string>().Distinct())
		{
			switch (agents.LiveStatusForClicky(item).Phase)
			{
			case ClickyAppLiveStatus.Phases.Working:
				num++;
				break;
			case ClickyAppLiveStatus.Phases.Finished:
				if (oneBrainJobReports != null && oneBrainJobReports.IsFinalizingResult(item))
				{
					num++;
				}
				break;
			case ClickyAppLiveStatus.Phases.NeedsYou:
				flag = true;
				break;
			case ClickyAppLiveStatus.Phases.Failed:
				flag2 = true;
				break;
			}
		}
		foreach (ClickyJob railJob in agents.Jobs.RailJobs)
		{
			switch (agents.RailPhase(railJob))
			{
			case ClickyJobRailPhase.Queued:
			case ClickyJobRailPhase.Working:
				num++;
				break;
			case ClickyJobRailPhase.Done:
				if (oneBrainJobReports != null && oneBrainJobReports.IsFinalizingResult(railJob))
				{
					num++;
				}
				break;
			case ClickyJobRailPhase.NeedsYou:
				flag = true;
				break;
			case ClickyJobRailPhase.Failed:
				flag2 = true;
				break;
			}
		}
		int workingCount = num;
		string alertPhase;
		if (flag)
		{
			alertPhase = "needsYou";
		}
		else
		{
			alertPhase = (flag2 ? "failed" : "idle");
		}
		return new NotchRestingMarkState(workingCount, alertPhase);
	}

	private void SyncRestingMark()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			NotchRestingMarkState notchRestingMarkState = NotchExtensions.RestingMarkState?.Invoke() ?? RestingMarkFromWork();
			corePresenter.SetRestingMarkState(EdgeDockIsRunning, notchRestingMarkState.WorkingCount > 0);
			NotchExtensions.RaiseRestingMarkChanged();
		}
	}

	private PreSignInIntroViewModel CreateIntroVm(RealStack real)
	{
		PreSignInIntroViewModel preSignInIntroViewModel = new PreSignInIntroViewModel(real.Core.Settings, (string channel, string? other) => real.Core.Worker.SetDiscoveryChannelAsync(channel, other));
		preSignInIntroViewModel.IsSignedIn = real.Core.Auth.IsSignedIn;
		preSignInIntroViewModel.UserFirstName = FirstName(real.Core.Auth.User);
		preSignInIntroViewModel.SignInRequested += (object? _, EventArgs _) =>
		{
			SignIn();
		};
		return preSignInIntroViewModel;
	}

	private NotchOnboardingCardViewModel CreateCardVm(RealStack real)
	{
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = new NotchOnboardingCardViewModel(real.Core.Settings, real.Permissions);
		notchOnboardingCardViewModel.IsSignedIn = real.Core.Auth.IsSignedIn;
		notchOnboardingCardViewModel.SignInRequested += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(SignIn);
		};
		notchOnboardingCardViewModel.OnboardingTriggered += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(async () =>
			{
				BeginOnboardingIntroSequence();
			});
		};
		notchOnboardingCardViewModel.IntroWelcomeFinished += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				intro?.Hide();
			});
		};
		notchOnboardingCardViewModel.PropertyChanged += OnCardVmChanged;
		return notchOnboardingCardViewModel;
	}

	private void OnCardVmChanged(object? sender, PropertyChangedEventArgs e)
	{
		bool flag;
		switch (e.PropertyName)
		{
		case "Kind":
		case "ActivePermission":
		case "ActivePermissionStatus":
		case "NeedsPin":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			DispatcherQueue.TryEnqueue(SyncOnboardingPin);
		}
	}

	private int? CardStep(NotchOnboardingCardViewModel vm)
	{
		return vm.Kind switch
		{
			NotchOnboardingCardKind.SignedOut => (int?)(-1), 
			NotchOnboardingCardKind.PermissionIntro => 0, 
			NotchOnboardingCardKind.Permission => (vm.ActivePermission != PermissionKind.ScreenCapture) ? 1 : 2, 
			NotchOnboardingCardKind.MeetClicky => 3, 
			_ => null, 
		};
	}

	private void SyncOnboardingPin()
	{
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = CardVm;
		if (notchOnboardingCardViewModel == null)
		{
			return;
		}
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null)
		{
			return;
		}
		IntroWindow? introWindow = intro;
		int? onboardingPin = ((introWindow != null && introWindow.Window.Visible && !notchOnboardingCardViewModel.IsIntroHomeWelcomeActive) ? ((int?)null) : CardStep(notchOnboardingCardViewModel));
		if (notchOnboardingCardViewModel.Kind == NotchOnboardingCardKind.SignedOut && Services.Settings.HasCompletedOnboarding)
		{
			onboardingPin = null;
		}
		corePresenter.SetIntroHomeWelcomeActive(notchOnboardingCardViewModel.IsIntroHomeWelcomeActive);
		corePresenter.SetOnboardingPin(onboardingPin);
		RealStack real = Real;
		if (real != null)
		{
			NotchOnboardingCardKind kind = notchOnboardingCardViewModel.Kind;
			if ((uint)(kind - 1) <= 1u)
			{
				real.Permissions.StartPolling();
			}
			else
			{
				real.Permissions.StopPolling();
			}
		}
	}

	private void OnboardingAuthChanged(bool signedIn)
	{
		PreSignInIntroViewModel preSignInIntroViewModel = introVm;
		if (preSignInIntroViewModel != null)
		{
			preSignInIntroViewModel.IsSignedIn = signedIn;
			preSignInIntroViewModel.UserFirstName = FirstName(Real?.Core.Auth.User);
		}
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = cardVm;
		if (notchOnboardingCardViewModel != null)
		{
			notchOnboardingCardViewModel.IsSignedIn = signedIn;
		}
		intro?.OnSignedInChanged(signedIn);
		SyncOnboardingPin();
	}

	private static string? FirstName(UserProfile? user)
	{
		if ((object)user == null)
		{
			return null;
		}
		string text = ((!string.IsNullOrWhiteSpace(user.DisplayName)) ? user.DisplayName.Trim().Split(' ')[0] : user.Email.Split('@')[0].Split('.', '_', '+')[0]);
		if (text.Length != 0)
		{
			ReadOnlySpan<char> readOnlySpan = new ReadOnlySpan<char>(char.ToUpperInvariant(text[0]));
			string text2 = text;
			return string.Concat(readOnlySpan, text2.Substring(1, text2.Length - 1));
		}
		return null;
	}

	public void SignIn()
	{
		Services.Auth.SignInWithGoogleAsync();
	}

	public async Task<bool> DevSignInAsync()
	{
		if (DevSignInAvailable)
		{
			RealStack real = Real;
			if (real != null)
			{
				string text = Environment.GetEnvironmentVariable("HEYCLICKY_DEV_TEST_USER");
				if (string.IsNullOrWhiteSpace(text) || !File.Exists(text))
				{
					text = null;
					for (DirectoryInfo directoryInfo = new DirectoryInfo(AppContext.BaseDirectory); directoryInfo != null; directoryInfo = directoryInfo.Parent)
					{
						string text2 = Path.Combine(directoryInfo.FullName, "windows", "devstack", "test-user.json");
						if (File.Exists(text2))
						{
							text = text2;
							break;
						}
						text2 = Path.Combine(directoryInfo.FullName, "devstack", "test-user.json");
						if (File.Exists(text2))
						{
							text = text2;
							break;
						}
					}
				}
				if (text == null)
				{
					Log.Warn("auth", "dev sign-in: test-user.json not found (set HEYCLICKY_DEV_TEST_USER)");
					return false;
				}
				try
				{
					using JsonDocument doc = JsonDocument.Parse(await File.ReadAllTextAsync(text));
					string email = doc.RootElement.GetProperty("email").GetString();
					string password = doc.RootElement.GetProperty("password").GetString();
					bool flag = await real.Core.Auth.SignInWithPasswordAsync(email, password);
					Log.Info("auth", flag ? "dev sign-in succeeded (local test account)" : "dev sign-in failed");
					return flag;
				}
				catch (Exception ex)
				{
					Log.Error("auth", "dev sign-in", ex);
					return false;
				}
			}
		}
		return false;
	}

	public void DismissOnboardingPin()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null)
		{
			corePresenter.DismissOnboardingPin();
		}
		else
		{
			Services.Presenter.ReturnToIdle();
		}
	}

	private void StartNotchPolish(RealStack real)
	{
		real.Shortcuts.MouseDown += (PointD p) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				OnMouseDownAnywhere(p);
			});
		};
		HotkeyRouter hotkeyRouter = hotkeys;
		if (hotkeyRouter != null)
		{
			hotkeyRouter.NotchChatToggle = ToggleNotchChatFromShortcut;
			hotkeyRouter.NotchEscape = HandleNotchEscape;
			hotkeyRouter.NotchEscapeWouldClaim = NotchEscapeWouldClaim;
			hotkeyRouter.NotchViewerEscapeWouldClaim = NotchViewerEscapeWouldClaim;
			hotkeyRouter.LessonReplaying = () => lessons?.IsReplaying ?? false;
			hotkeyRouter.StopLessonReplay = () =>
			{
				lessons?.StopReplayForEscape();
			};
		}
		NotchUi.HoverChanged += (bool inside) =>
		{
			if (inside && HoverDwellWillOpenSomething())
			{
				Services.Cursor.SetHoverDwell(NotchPresenter.HoverDwell.TotalSeconds);
			}
			else
			{
				Services.Cursor.SetHoverDwell(null);
			}
		};
		NotchUi.HoverDwellCompleted += () =>
		{
			Services.Cursor.SetHoverDwell(null);
		};
		HeaderPills.HidesPromotionalButtons = () => HidesHomePromotionalButtons;
		Services.Updates.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(HeaderPills.RaiseChanged);
		};
		BillingUi billingUi = Services.Billing;
		if (billingUi != null)
		{
			billingUi.Changed += () =>
			{
				DispatcherQueue.TryEnqueue(HeaderPills.RaiseChanged);
			};
		}
		real.Tutorial.PropertyChanged += (object? _, PropertyChangedEventArgs e) =>
		{
			bool flag;
			switch (e.PropertyName)
			{
			case "IsEngaged":
			case "Phase":
			case "IsRestrictingNormalUse":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag)
			{
				DispatcherQueue.TryEnqueue(HeaderPills.RaiseChanged);
			}
		};
	}

	public void OpenMicrophoneSettings()
	{
		OpenSettings(NotchSettingsSection.Microphone);
	}

	private bool HoverDwellWillOpenSomething()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter != null && corePresenter.IsShowingNotchAgentPeek)
		{
			return false;
		}
		NotchPresenter? corePresenter2 = CorePresenter;
		if (corePresenter2 != null && corePresenter2.RequiresPointerExitBeforeHoverExpansion)
		{
			return false;
		}
		if (!Services.Auth.IsSignedIn || introSequenceActive || DrawnOnboardingTour.SuppressesNotchHover)
		{
			return false;
		}
		OnboardingTutorialViewModel onboardingTutorialViewModel = Real?.Tutorial;
		if (onboardingTutorialViewModel != null && onboardingTutorialViewModel.IsRestrictingNormalUse)
		{
			return true;
		}
		if (!TourHoldsHome)
		{
			NotchPresenter? corePresenter3 = CorePresenter;
			if (corePresenter3 == null || !corePresenter3.IsTextResponseInProgress)
			{
				NotchPresentation presentation = Services.Presenter.Presentation;
				bool flag = ((presentation is NotchPresentation.TextInput || presentation is NotchPresentation.TextResponse) ? true : false);
				return !flag;
			}
		}
		return false;
	}

	private void CheckForUpdatesFromMenu(string surface)
	{
		IUpdateService updates = Services.Updates;
		if (updates.State == UpdateState.ReadyToInstall || HeaderPills.PreviewUpdateReady)
		{
			ShowUpdatesRow();
			return;
		}
		if (updates.State == UpdateState.Unavailable)
		{
			Log.Info("updates", "check from " + surface + ": not an installed copy");
			if (!NotchShowsSettings)
			{
				SayAtCursorAsync("this copy of heyclicky can't update itself. the installed app checks every hour.", streamed: true, 5.0);
			}
			else
			{
				ShowUpdatesRow();
			}
			return;
		}
		if (manualUpdateProbe != null)
		{
			updates.Changed -= manualUpdateProbe;
		}
		DateTimeOffset started = DateTimeOffset.Now;
		manualUpdateProbe = (object? _, EventArgs _) =>
		{
			UpdateState state = updates.State;
			bool flag = (uint)(state - 1) <= 1u;
			if (!flag || !(DateTimeOffset.Now - started < TimeSpan.FromMinutes(2L)))
			{
				updates.Changed -= manualUpdateProbe;
				manualUpdateProbe = null;
				FinishManualUpdateProbe(state);
			}
		};
		updates.Changed += manualUpdateProbe;
		updates.CheckNowAsync(surface);
		void ShowUpdatesRow()
		{
			OpenSettings(NotchSettingsSection.General);
		}
	}

	private void FinishManualUpdateProbe(UpdateState state)
	{
		if ((uint)(state - 4) <= 1u)
		{
			OpenSettings(NotchSettingsSection.General);
		}
		else if (!NotchShowsSettings)
		{
			string text = state switch
			{
				UpdateState.UpToDate => "you're up to date, version " + Services.Updates.CurrentVersion + " is the newest.", 
				UpdateState.Failed => "i couldn't check for updates just now. try again in a bit.", 
				_ => null, 
			};
			if (text != null)
			{
				SayAtCursorAsync(text, streamed: true, 5.0);
			}
		}
	}

	private void OnMouseDownAnywhere(PointD p)
	{
		if (NotchUi == null || NotchUi.ContainsScreenPointPx(p) || Native.IsOwnWindowAt((int)p.X, (int)p.Y))
		{
			return;
		}
		NotchPresentation presentation = Services.Presenter.Presentation;
		if ((!(presentation is NotchPresentation.TextInput) && !(presentation is NotchPresentation.TextResponse)) || 1 == 0)
		{
			bool flag = false;
			if (presentation is NotchPresentation.LiveEvent liveEvent && liveEvent.Event is NotchLiveEvent.OnboardingTutorialResume)
			{
				NotchUi.HoverChanged -= DismissResumeOnHoverOut;
				Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.OnboardingTutorialResume));
				flag = true;
			}
			NotchPresenter? corePresenter = CorePresenter;
			if (corePresenter != null && corePresenter.CollapseHoverAfterOutsideClick())
			{
				flag = true;
			}
			if (flag)
			{
				Log.Info("notch", "click outside: the hover-opened card closed");
			}
		}
	}

	private void StartProactive(RealStack real)
	{
		Proactive = new ProactiveCoordinator(this, real);
		Proactive.Changed += () =>
		{
			Dock?.NoteMembershipInputsChanged();
		};
		Proactive.Start();
	}

	internal void CollapseNotchForPreview()
	{
		if (Services.Presenter.Presentation is NotchPresentation.TextInput)
		{
			Services.Presenter.Present(new NotchPresentation.Idle());
		}
		CorePresenter?.CollapseHoverAfterOutsideClick();
		CorePresenter?.SuppressHoverUntilPointerReentry();
	}

	public void OpenRemoteTaskComposer(string title)
	{
		Log.Info("Notifications", "modify \"" + title + "\" by text: composer open");
		Services.Audio.PlayEarcon("textOpen");
		Services.Presenter.Present(new NotchPresentation.TextInput("", new NotchAgentFollowUp(null, "this agent")));
	}

	private void RequestIntroAttention(string source)
	{
		if (intro == null)
		{
			intro = CreateIntro();
		}
		if (intro.IsShowing)
		{
			intro.Window.BringToFrontRecentered();
		}
		else
		{
			intro.Show(intro.CurrentStep);
		}
		ClickyAnalytics.TrackPreSignInIntroAttentionRequested(IntroWindow.AnalyticsName(intro.CurrentStep));
		Log.Info("reopen", source + ": the intro comes to the front (" + IntroWindow.AnalyticsName(intro.CurrentStep) + ")");
	}

	private void HandleReopen()
	{
		ClickyAnalytics.TrackDockIconPanelOpened();
		if (IntroOwnsFlow)
		{
			RequestIntroAttention("second launch");
			return;
		}
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null && tutorialWindow.IsRunning)
		{
			tutorialWindow.BringForward();
			Log.Info("reopen", "second launch: the tour comes to the front");
			return;
		}
		if (HasCompletedOnboardingNow)
		{
			OpenNotchHome();
			Log.Info("reopen", "second launch: the notch's Home");
			return;
		}
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = CardVm;
		if (notchOnboardingCardViewModel != null)
		{
			int? num = CardStep(notchOnboardingCardViewModel);
			if (num.HasValue)
			{
				int valueOrDefault = num.GetValueOrDefault();
				Services.Presenter.Present(new NotchPresentation.OnboardingPinned(valueOrDefault));
			}
		}
		Log.Info("reopen", "second launch: the notch's onboarding card");
	}

	internal void SimulateSecondLaunch()
	{
		HandleReopen();
	}

	private void HandleTrayClick()
	{
		if (IntroOwnsFlow)
		{
			RequestIntroAttention("tray click");
			return;
		}
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null && tutorialWindow.IsRunning)
		{
			tutorialWindow.BringForward();
			Log.Info("reopen", "tray click: the tour comes to the front");
		}
		else
		{
			OpenSettings();
		}
	}

	public void Relaunch()
	{
		Log.Info("app", "relaunch requested");
		if (!AppRelaunch.ScheduleRelaunch())
		{
			Log.Warn("app", "relaunch helper didn't start: staying open");
		}
		else
		{
			Quit();
		}
	}

	public async void ResetAllDataAndQuit()
	{
		if (resetting)
		{
			return;
		}
		resetting = true;
		Log.Info("app", "reset all data and quit");
		string customFolder = null;
		try
		{
			customFolder = Real?.Core.Settings.Current.AgentFolderPath;
		}
		catch
		{
		}
		try
		{
			RealStack real = Real;
			if (real != null)
			{
				await real.Agents.SignOutAsync();
			}
		}
		catch (Exception ex)
		{
			Log.Warn("reset", "agents: " + ex.Message);
		}
		try
		{
			await Services.Auth.SignOutAsync();
		}
		catch (Exception ex2)
		{
			Log.Warn("reset", "sign-out: " + ex2.Message);
		}
		try
		{
			ClickyAnalytics.ResetIdentity();
		}
		catch
		{
		}
		await Task.Run(() =>
		{
			List<string> list = new List<string>();
			if (customFolder == null)
			{
				list.Add(AgentFolders.Default);
			}
			else if (string.Equals(Path.GetFullPath(customFolder).TrimEnd('\\'), AgentFolders.LegacyDocuments, StringComparison.OrdinalIgnoreCase))
			{
				list.Add(Path.Combine(AgentFolders.LegacyDocuments, "agents"));
			}
			foreach (string item in list)
			{
				if (Directory.Exists(item))
				{
					try
					{
						FileSystem.DeleteDirectory(item, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin);
						Log.Info("reset", item + " → Recycle Bin");
					}
					catch (Exception ex3)
					{
						Log.Warn("reset", item + ": " + ex3.Message);
					}
				}
			}
		});
		string appDataDirectory = AppBundleConfiguration.AppDataDirectory;
		if (Path.GetFileName(appDataDirectory.TrimEnd('\\')) == "HeyClicky" && !AppPaths.IsOverridden && appDataDirectory.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), StringComparison.OrdinalIgnoreCase))
		{
			AppRelaunch.RunAfterExit("Remove-Item -LiteralPath " + AppRelaunch.Quote(appDataDirectory) + " -Recurse -Force -ErrorAction SilentlyContinue", "reset");
		}
		Log.Info("reset", appDataDirectory + " is erased once HeyClicky has quit");
		await Task.Delay(250);
		Quit();
	}

	private void WireRoutinePower(RealStack real)
	{
		real.Agents.Routines.Wake.DisplayOffMeansStandby = IsModernStandbyPc();
		NotchUi.Window.RawMessage += (uint msg, nint w, nint l) =>
		{
			if (msg == 536)
			{
				if (w == 4)
				{
					real.Agents.NotifySystemSleeping();
				}
				else
				{
					long num = w;
					if ((num == 7 || num == 18) ? true : false)
					{
						real.Agents.NotifyResumedFromSleep();
					}
					else if (w == 32787 && l != 0)
					{
						bool? flag = DisplayStateFrom(l);
						if (flag.HasValue)
						{
							bool valueOrDefault = flag == true;
							Log.Info("power", "display " + (valueOrDefault ? "on" : "off"));
							real.Agents.NotifyDisplayPower(valueOrDefault);
						}
					}
				}
			}
		};
		displayPowerNotification = RegisterPowerSettingNotification(NotchUi.Window.Hwnd, in GUID_CONSOLE_DISPLAY_STATE, 0);
		if (displayPowerNotification == 0)
		{
			Log.Warn("power", $"display power notifications unavailable ({Marshal.GetLastWin32Error()})");
		}
	}

	private static bool? DisplayStateFrom(nint setting)
	{
		if (Marshal.PtrToStructure<Guid>(setting) != GUID_CONSOLE_DISPLAY_STATE)
		{
			return null;
		}
		if (Marshal.ReadInt32(setting, 16) < 4)
		{
			return null;
		}
		return Marshal.ReadInt32(setting, 20) != 0;
	}

	private static bool IsModernStandbyPc()
	{
		byte[] array = new byte[76];
		try
		{
			if (CallNtPowerInformation(4, 0, 0, array, array.Length) != 0)
			{
				return false;
			}
			bool flag = array[20] != 0;
			Log.Info("power", flag ? "Modern Standby PC: the display going off is the sleep for routines" : "S3 sleep PC");
			return flag;
		}
		catch (Exception ex)
		{
			Log.Warn("power", "power capabilities: " + ex.Message);
			return false;
		}
	}

	[DllImport("user32.dll", SetLastError = true)]
	private static extern nint RegisterPowerSettingNotification(nint hRecipient, in Guid powerSettingGuid, int flags);

	[DllImport("powrprof.dll")]
	private static extern uint CallNtPowerInformation(int informationLevel, nint inputBuffer, int inputBufferLength, byte[] outputBuffer, int outputBufferLength);

	internal static void PrepareStoredSettings(SettingsStore store, AgentRuntimeOptions agentOptions)
	{
        var harnessDirectory = Path.Combine(agentOptions.StateDirectory, "AgentHarness");
        var resumableJobs = Directory.Exists(harnessDirectory)
            ? Directory.EnumerateFiles(harnessDirectory, "job.json", System.IO.SearchOption.AllDirectories)
            : Enumerable.Empty<string>();
        AgentWorkspaceMigration.Move(AgentFolders.PreviousDefault,AgentFolders.Default,AppPaths.Root,
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CODY"),new[]{
                Path.Combine(agentOptions.StateDirectory,"defaults.json"),Path.Combine(agentOptions.StateDirectory,"clickys.json"),
                AppPaths.Combine("clickys.json"),Path.Combine(HeyClicky.App.Cody.CodyPaths.StateRoot,"task-library.json")
            }.Concat(resumableJobs));
        store.Update((AppSettings settings)=>{
            if(settings.AgentFolderPath!=null){
                var mapped=AgentWorkspaceMigration.MapPath(settings.AgentFolderPath,AgentFolders.PreviousDefault,AgentFolders.Default);
                settings.AgentFolderPath=string.Equals(mapped,AgentFolders.Default,StringComparison.OrdinalIgnoreCase)?null:mapped;
            }
        });
		AppSettings current = store.Current;
		agentOptions.ProjectsRoot = current.AgentFolderPath ?? AgentFolders.Default;
		agentOptions.AutoApproveExtraUsage = current.AgentAutoApproveExtraUsage;
		string obsidianVaultPath = current.ObsidianVaultPath;
		agentOptions.ObsidianVaultPath = ((obsidianVaultPath != null && Directory.Exists(obsidianVaultPath)) ? obsidianVaultPath : null);
		AudioDevices.PreferredCaptureId = current.MicrophoneDeviceId;
		AudioDevices.PreferredRenderId = current.OutputDeviceId;
		ScreenDrawingCanvas.JavaScriptJitEnabled = current.DrawingJavaScriptJit;
		OverlayWindow.ShowInScreenRecordings = current.ShowInScreenRecordings;
		ScreenDrawingCanvas.FiguresFloat = current.StreamMode;
		ThreeStage.StreamMode = current.StreamMode;
	}

	private void StartApplyingSettings()
	{
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		SettingsStore store = real.Core.Settings;
		ApplySettings(store.Current, initial: true);
		store.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				ApplySettings(store.Current, initial: false);
			});
		};
		real.Agents.AutoApproveExtraUsageChanged += (bool on) =>
		{
			store.Update((AppSettings s) =>
			{
				s.AgentAutoApproveExtraUsage = on;
			});
		};
		CustomConnectorStore.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(ApplyCustomConnectors);
		};
		ObsidianVault.Initialize(store);
		ConnectorAuth.Initialize(real.Agents, OpenConnectorAuthorization, () =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				OpenSettings(NotchSettingsSection.Integrations);
			});
		});
		ConnectedApps.Initialize(real.Agents, () => real.Core.Endpoints.WorkerBaseUrl.AbsoluteUri);
		if (real.Core.Auth.IsSignedIn)
		{
			ConnectorAuth.OnLaunchAsync();
			ConnectedApps.RefreshAsync();
		}
		real.AgentVoice.ShowAtCursor = (string line) =>
		{
			real.Cursor.ShowMessage(line);
		};
		IntegrationAuthCallback = (string? toolkit, bool failed) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				if (!InkNoteSignInReturned(toolkit, failed))
				{
					ProactiveCoordinator? proactive = Proactive;
					if (proactive == null || !proactive.OnIntegrationAuthCallback(toolkit, failed))
					{
						OpenSettings(NotchSettingsSection.Integrations);
						NotchSettingsTab.NoteIntegrationCallback(toolkit);
						real.Agents.InvalidateConnectedApps();
					}
				}
			});
		};
		ApplyCustomConnectors();
		if (AppPaths.IsOverridden)
		{
			Log.Info("settings", "launch at login not written: the data folder is moved (a test run)");
			return;
		}
		try
		{
			if (LaunchAtLogin.IsEnabled() != store.Current.LaunchAtLogin)
			{
				LaunchAtLogin.SetEnabled(store.Current.LaunchAtLogin);
			}
		}
		catch (Exception ex)
		{
			Log.Warn("settings", "launch at login: " + ex.Message);
		}
	}

	private void OpenConnectorAuthorization(string url)
	{
		string environmentVariable = Environment.GetEnvironmentVariable("HEYCLICKY_DEV_AUTH_URL_FILE");
		if (environmentVariable != null && environmentVariable.Length > 0)
		{
			try
			{
				File.AppendAllText(environmentVariable, url + Environment.NewLine);
				Log.Info("connectors", "authorization URL handed to the test harness");
				return;
			}
			catch (Exception ex)
			{
				Log.Warn("connectors", "dev auth url file: " + ex.Message);
				return;
			}
		}
		DispatcherQueue.TryEnqueue(() =>
		{
			FoldNotchForOpenedLink();
			OpenUrl(url);
		});
	}

	private void ApplyCustomConnectors()
	{
		RealStack real = Real;
		if (real != null && real.IsComplete)
		{
			IReadOnlyList<CustomConnectorRegistration> readOnlyList = CustomConnectorStore.Registrations();
			real.Agents.SetCustomConnectors(readOnlyList);
			Log.Info("settings", $"custom connectors → agents: {readOnlyList.Count}");
		}
	}

	private void ApplySettings(AppSettings now, bool initial)
	{
		RealStack real = Real;
		if (real == null || !real.IsComplete)
		{
			return;
		}
		AppSettings before = appliedSettings;
		appliedSettings = now;
		if (Changed<HotkeyBindings>((AppSettings s) => s.EffectiveHotkeys))
		{
			real.Shortcuts.Configure(now.EffectiveHotkeys);
			HotkeyBindings effectiveHotkeys = now.EffectiveHotkeys;
			real.Dictation.HasDedicatedHandsFreeShortcut = effectiveHotkeys.HandsFreeDictation.Trigger != HotkeyTrigger.DoubleTap || effectiveHotkeys.HandsFreeDictation.Modifiers != effectiveHotkeys.Dictation.Modifiers;
		}
		if (Changed<string>((AppSettings s) => s.MicrophoneDeviceId))
		{
			AudioDevices.PreferredCaptureId = now.MicrophoneDeviceId;
		}
		if (Changed<string>((AppSettings s) => s.OutputDeviceId))
		{
			AudioDevices.PreferredRenderId = now.OutputDeviceId;
		}
		if (Changed<(bool, bool)>((AppSettings s) => (DrawingSoundsEnabled: s.DrawingSoundsEnabled, DrawingPenSoundsEnabled: s.DrawingPenSoundsEnabled)))
		{
			real.Canvas.PlaysSounds = HeyClicky.App.Cody.CodyDrawingSounds.Supported && now.DrawingSoundsEnabled;
			real.Canvas.PlaysPenSounds = HeyClicky.App.Cody.CodyDrawingSounds.Supported && now.DrawingSoundsEnabled && now.DrawingPenSoundsEnabled;
			Log.Info("settings", "drawing sounds " + (real.Canvas.PlaysSounds ? "on" : "off") + ", pen sounds " + ((now.DrawingSoundsEnabled && now.DrawingPenSoundsEnabled) ? "on" : "off"));
		}
		if (Changed<bool>((AppSettings s) => s.DrawingSubtitlesEffective))
		{
			real.Canvas.ShowsSubtitles = now.DrawingSubtitlesEffective;
			Log.Info("settings", "drawing subtitles " + (now.DrawingSubtitlesEffective ? "on" : "off"));
		}
		if (Changed<bool>((AppSettings s) => s.ScreenHighlightEnabled))
		{
			real.Highlight.IsEnabled = now.ScreenHighlightEnabled;
			if (!now.ScreenHighlightEnabled && !initial)
			{
				real.Highlight.Clear();
			}
			Log.Info("settings", "screen highlight " + (now.ScreenHighlightEnabled ? "on" : "off"));
		}
		if (Changed<string>((AppSettings s) => s.CursorColorHex))
		{
			real.Cursor.SetColor(now.CursorColorHex);
			tray?.SetColor(TrayColor(now.CursorColorHex));
		}
		if (Changed<bool>((AppSettings s) => s.ShowInScreenRecordings) && !initial)
		{
			OverlayWindow.ShowInScreenRecordings = now.ShowInScreenRecordings;
		}
		if (Changed<string>((AppSettings s) => s.AgentFolderPath) && !initial)
		{
			real.Agents.SetProjectsRoot(now.AgentFolderPath ?? AgentFolders.Default);
		}
		if (Changed<bool>((AppSettings s) => s.AgentAutoApproveExtraUsage))
		{
			real.Agents.AutoApproveExtraUsage = now.AgentAutoApproveExtraUsage;
		}
		if (Changed<string>((AppSettings s) => s.ObsidianVaultPath) && !initial)
		{
			AgentService agents = real.Agents;
			string obsidianVaultPath = now.ObsidianVaultPath;
			agents.SetObsidianVaultPath((obsidianVaultPath != null && Directory.Exists(obsidianVaultPath)) ? obsidianVaultPath : null);
		}
		if (Changed<bool>((AppSettings s) => s.ShowAgentLabelsInActivityStrip))
		{
			NotchUi.SizeContext.AgentLabelsHidden = !now.ShowAgentLabelsInActivityStrip;
			if (!initial)
			{
				NotchUi.Apply(Services.Presenter.Presentation, force: true);
			}
		}
		if (!initial && Changed<bool>((AppSettings s) => s.DrawingJavaScriptJit))
		{
			Log.Info("settings", "JavaScript JIT change takes effect on the next launch");
		}
		if (Changed<bool>((AppSettings s) => s.StreamMode))
		{
			NotchUi.SetStreamMode(now.StreamMode);
			ScreenDrawingCanvas.FiguresFloat = now.StreamMode;
			ThreeStage.StreamMode = now.StreamMode;
		}
		bool Changed<T>(Func<AppSettings, T> read) where T : notnull
		{
			if (!initial && before != null)
			{
				return !EqualityComparer<T>.Default.Equals(read(before), read(now));
			}
			return true;
		}
	}

	private static uint TrayColor(string hex)
	{
		Color color = DS.CursorColor(hex);
		return (uint)(-16777216 | ((color.R << 16) | (color.G << 8) | color.B));
	}

	private void ForgetSignedOutAccount(RealStack real)
	{
		if (!accountWasSignedIn)
		{
			return;
		}
		accountWasSignedIn = false;
		Log.Info("auth", "signed out: folding the notch and clearing this account's local state");
		CorePresenter?.CloseNotchChatSession();
		CorePresenter?.DismissNotchAgentPeek();
		CorePresenter?.Updates.Reset();
		try
		{
			ClickyBrowserBridge.Shared.Shutdown();
		}
		catch (Exception ex)
		{
			Log.Warn("auth", "browser: " + ex.Message);
		}
		SettingsContent.ClearParkedConnectorDraft();
		try
		{
			ClickyLiveNoteStore.Shared.RemoveAllForSignOut();
		}
		catch (Exception ex2)
		{
			Log.Warn("auth", "ink notes: " + ex2.Message);
		}
		try
		{
			Dock?.RemoveAllForSignOut();
		}
		catch (Exception ex3)
		{
			Log.Warn("auth", "dock: " + ex3.Message);
		}
		real.Core.Settings.Update((AppSettings s) =>
		{
			s.Onboarding.DiscoveryChannel = null;
			s.Onboarding.DiscoveryChannelOther = null;
			s.Onboarding.DiscoveryChannelSynced = false;
			s.DiscoveryChannelPendingSync = null;
		});
		try
		{
			real.Dictation.CancelActiveSession();
		}
		catch (Exception ex4)
		{
			Log.Warn("auth", "dictation: " + ex4.Message);
		}
		try
		{
			if (Services.Companion.State != VoiceState.Idle)
			{
				Services.Companion.Cancel();
			}
		}
		catch (Exception ex5)
		{
			Log.Warn("auth", "companion: " + ex5.Message);
		}
		UpdateTrayTooltip();
	}

	private void NoteAccountSignedIn()
	{
		accountWasSignedIn = true;
	}

	private void TrackDockedStripCoverage()
	{
		NotchPresenter corePresenter = CorePresenter;
		if (corePresenter == null)
		{
			return;
		}
		if (!Services.Settings.CursorDocked)
		{
			if (corePresenter.DockedStripCoversForegroundApp)
			{
				corePresenter.SetDockedStripCoversForegroundApp(covers: false);
			}
			coverageForeground = 0;
			return;
		}
		nint foregroundWindow = Native.GetForegroundWindow();
		if (foregroundWindow != coverageForeground)
		{
			Native.GetWindowThreadProcessId(foregroundWindow, out var pid);
			if (pid != Environment.ProcessId)
			{
				coverageForeground = foregroundWindow;
				coverageProbe?.Cancel();
				SweepDockedStripCoverageAsync(foregroundWindow, (coverageProbe = new CancellationTokenSource()).Token);
			}
		}
	}

	private async Task SweepDockedStripCoverageAsync(nint window, CancellationToken ct)
	{
		_ = 1;
		try
		{
			double previous = 0.0;
			double[] array = new double[5] { 0.0, 1.5, 4.0, 9.0, 15.0 };
			foreach (double at in array)
			{
				if (at > previous)
				{
					await Task.Delay(TimeSpan.FromSeconds(at - previous), ct);
				}
				previous = at;
				bool? flag = await DockedStripCoversAsync(window, ct);
				if (ct.IsCancellationRequested)
				{
					break;
				}
				if (flag.HasValue)
				{
					bool c = flag == true;
					NotchPresenter presenter = CorePresenter;
					if (presenter != null && c != presenter.DockedStripCoversForegroundApp)
					{
						DispatcherQueue.TryEnqueue(() =>
						{
							presenter.SetDockedStripCoversForegroundApp(c);
						});
						Log.Info("notch", $"docked strip coverage → {c}");
					}
				}
				if (flag == true)
				{
					break;
				}
			}
		}
		catch (OperationCanceledException)
		{
		}
		catch (Exception ex2)
		{
			Log.Warn("notch", "strip coverage probe: " + ex2.Message);
		}
	}

	private async Task<bool?> DockedStripCoversAsync(nint window, CancellationToken ct)
	{
		if (window == 0 || Native.IsIconic(window) || !Native.IsWindowVisible(window))
		{
			return false;
		}
		Native.GetWindowThreadProcessId(window, out var pid);
		try
		{
			using Process process = Process.GetProcessById((int)pid);
			if (CoverageIgnoredProcesses.Contains(process.ProcessName))
			{
				return false;
			}
		}
		catch
		{
		}
		if (Native.MonitorFromWindow(window, 2) != NotchUi.MonitorHandle)
		{
			return false;
		}
		RectD bandPx = NotchUi.DockedStripRectPx();
		if (!Native.GetWindowRectPublic(window, out var rc))
		{
			return false;
		}
		if (!((double)rc.Left < bandPx.Right) || !((double)rc.Right > bandPx.X) || !((double)rc.Top <= bandPx.Bottom) || !((double)rc.Bottom > bandPx.Bottom))
		{
			return false;
		}
		return await UIAutomationHelpers.HasControlsUnderBandAsync(window, bandPx, ct);
	}

	private void StartSystemServices(RealStack real)
	{
		ClickyAnalytics.FrontmostApplicationProperties = FrontmostApplicationProperties;
		ClickyAnalytics.TrackAppOpened();
		MainThreadStallMonitor.Start(DispatcherQueue);
		MemoryMonitor.Start();
		string newVersion = null;
		if (!HeyClicky.App.Cody.CodyEngineBridge.AutomaticUpdatesEnabled)
		{
			Services.Updates = NullUpdateService.Instance;
			Log.Info("cody-engine", "automatic app updates and apply-on-quit are disabled for the C.O.D.Y. working copy");
		}
		else
		{
			updates = new UpdateService(DispatcherQueue);
			updates.QuitApp = Quit;
			Services.Updates = updates;
			updates.Start();
			newVersion = updates.ConsumePendingInstallCompletion();
		}
		if (newVersion != null)
		{
			Task.Delay(TimeSpan.FromSeconds(3L)).ContinueWith((Task _) => DispatcherQueue.TryEnqueue(() =>
			{
				PresentAppUpdatedNotice(newVersion);
			}), TaskScheduler.Default);
		}
		Task.Run((Action)CrashReporting.ReportPreviousCrashes);
		RefreshAppConfigAsync();
		WireTelemetry(real);
		WirePower();
		real.Core.Auth.ReferralCodeReceived += (object? _, string code) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				ReceiveFriendReferralCode(code, fromAuthCallback: true);
			});
		};
		if (real.Core.Auth.IsSignedIn)
		{
			ClaimPendingReferralCodeAsync();
		}
	}

	private static JsonObject? FrontmostApplicationProperties()
	{
		ForegroundApp foregroundApp = ForegroundAppInfo.Capture();
		if ((object)foregroundApp == null)
		{
			return null;
		}
		JsonObject jsonObject = new JsonObject();
		if (!string.IsNullOrEmpty(foregroundApp.ProcessName))
		{
			jsonObject["focused_app_bundle_id"] = foregroundApp.ProcessName;
		}
		if (!string.IsNullOrEmpty(foregroundApp.AppName))
		{
			jsonObject["focused_app_name"] = foregroundApp.AppName;
		}
		return jsonObject;
	}

	public void PresentAppUpdatedNotice(string version)
	{
		if (!Services.Settings.HasCompletedOnboarding)
		{
			Log.Info("updates", "updated to v" + version + "; the card is skipped mid-onboarding");
			return;
		}
		Log.Info("updates", "showing the \"HeyClicky updated\" card for v" + version);
		Services.Presenter.ShowLiveEvent(new NotchLiveEvent.AppUpdated(version));
	}

	private Task RefreshAppConfigAsync()
	{
		RealStack real = Real;
		if (real == null)
		{
			return Task.CompletedTask;
		}
		return AppRemoteConfig.Shared.RefreshAsync(real.Core.Worker);
	}

	public void OpenChangelog(string surface)
	{
		ClickyAnalytics.TrackChangelogOpened(surface);
		OpenUrl(ChangelogUrl);
	}

	private void WireTelemetry(RealStack real)
	{
		Services.Shortcuts.ShortcutTriggered += (object? _, ShortcutAction action) =>
		{
			if (!Services.Settings.IsPaused)
			{
				switch (action)
				{
				case ShortcutAction.PushToTalkDown:
					ClickyAnalytics.TrackPushToTalkStarted();
					break;
				case ShortcutAction.PushToTalkUp:
					ClickyAnalytics.TrackPushToTalkReleased();
					break;
				}
			}
		};
		real.Companion.MessageSent += (object? _, (int CharacterCount, bool Typed, string Trigger) m) =>
		{
			NotchPresentation presentation = Services.Presenter.Presentation;
			bool flag = ((presentation is NotchPresentation.OnboardingPinned || presentation is NotchPresentation.TextInput || presentation is NotchPresentation.TextResponse) ? true : false);
			bool notchWasExpanded = flag || (CorePresenter?.IsShowingNotchAgentPeek ?? false);
			string inputMethod = (m.Typed ? "text" : "voice");
			string inputSurface;
			if (!m.Typed)
			{
				inputSurface = "global_voice_input";
			}
			else
			{
				NotchPresenter? corePresenter = CorePresenter;
				inputSurface = ((corePresenter != null && corePresenter.IsNotchChatSessionOpen) ? "notch_chat" : "notch_text_box");
			}
			JsonObject jsonObject = ClickyAnalytics.InteractionContext(inputMethod, inputSurface, "closed", homeWasOpen: false, homeWasVisible: false, notchWasExpanded);
			jsonObject["trigger"] = m.Trigger;
			int item = m.CharacterCount;
			string source = (m.Typed ? "text" : "voice");
			switch (m.Trigger)
			{
			case "voice":
			case "typed":
			case "text":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			ClickyAnalytics.TrackUserMessageSent(item, source, "assistant", !flag, "one_brain", Services.Settings.LibraryModeEnabled, jsonObject);
		};
		real.Companion.Failed += (object? _, CompanionError error) =>
		{
			TrackCompanionFailure(real, error);
		};
		real.Dictation.Completed += (DictationResult result) =>
		{
			if (result.Outcome != DictationDeliveryOutcome.Nothing)
			{
				int wordCount = result.Text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
				int length = result.Text.Length;
				ClickyAnalytics.TrackDictationCompleted(wordCount, length, result.Outcome switch
				{
					DictationDeliveryOutcome.Inserted => "inserted", 
					DictationDeliveryOutcome.PastedBlind => "pasted_blind", 
					_ => "clipboard", 
				}, result.ClipboardReason, result.HandsFree, result.UsedBatch, result.UsedBatch ? "batch" : "deepgram", result.UsedWarmConnection, usedLateFocusRecapture: false, result.ReleaseToInsertMs, null, null);
			}
		};
		real.Agents.TaskEvent += (object? _, AgentTaskEvent e) =>
		{
			TrackAgentEvent(real.Agents, e);
		};
		WireAgentCostLedger(real);
		real.Core.Billing.Changed += (object? _, EventArgs _) =>
		{
			if (real.Core.Auth.IsSignedIn)
			{
				PlanSnapshot plan2 = real.Core.Billing.Plan;
				if ((object)plan2 != null)
				{
					TrackPlan(plan2);
				}
			}
		};
		PlanSnapshot plan = real.Core.Billing.Plan;
		if ((object)plan != null)
		{
			TrackPlan(plan);
		}
	}

	private static void TrackCompanionFailure(RealStack real, CompanionError error)
	{
		string text = error.Code switch
		{
			"turn_failed" => real.Companion.LastTurnWasTyped ? "realtime_typed_turn" : "voice_response", 
			"ears_failed" => "dictation_recognition", 
			"voice_unavailable" => "tts_playback", 
			"no_screenshot" => "screen_capture", 
			_ => null, 
		};
		if (text != null)
		{
			string kind = (error.Message.Contains("credit", StringComparison.OrdinalIgnoreCase) ? "credits_exhausted" : "generic");
			ClickyAnalytics.TrackAppError(text, kind, error.Message, error.Code, 0, UserFacingLine(error));
			if (error.Code == "turn_failed")
			{
				ClickyAnalytics.TrackResponseError(error.Message);
			}
		}
	}

	private static string UserFacingLine(CompanionError error)
	{
		if (error.Code == "turn_failed")
		{
			return error.Message.StartsWith("HTTP 429", StringComparison.Ordinal) ? "You're asking me a lot right now. Give me a minute, then try again." : "Sorry, I couldn't get an answer just now. Try asking me again.";
		}
		return error.Message;
	}

	private static string AgentAnalyticsSource(string? launchSource)
	{
		return launchSource switch
		{
			"voice" => "voice", 
			"routine" => "routine", 
			"suggestion" => "proactive_suggestion", 
			"suggested_action" => "suggested_action", 
			_ => "text", 
		};
	}

	private void TrackAgentEvent(AgentService agents, AgentTaskEvent e)
	{
		try
		{
			AgentTaskDetail taskDetail = agents.GetTaskDetail(e.TaskId);
			string text = taskDetail?.UserPrompts.LastOrDefault();
			string text2 = taskDetail?.Snapshot.ThreadId;
			switch (e.Kind)
			{
			case AgentTaskEventKind.StatusChanged:
				if (e.Text == "Starting")
				{
					bool flag2;
					lock (agentsSeen)
					{
						flag2 = agentsSeen.Add(e.TaskId);
					}
					if (taskDetail?.LaunchSource == "extra_effort")
					{
						return;
					}
					bool flag3 = taskDetail?.IsNewJobRun ?? false;
					if ((!flag2 || text2 != null) | flag3)
					{
						ClickyAnalytics.TrackAgentFollowedUp(text ?? "", AgentAnalyticsSource(taskDetail?.LaunchSource), text2, new JsonObject
						{
							["is_job"] = taskDetail?.JobId != null,
							["is_follow_up"] = true,
							["is_new_job_run"] = flag3,
							["is_steer"] = false
						});
					}
					else
					{
						ClickyAnalytics.TrackAgentStarted(text ?? "", ((object)taskDetail != null && taskDetail.IsRoutineRun) ? "routine" : "text", new JsonObject
						{
							["is_job"] = taskDetail?.JobId != null,
							["is_follow_up"] = false,
							["is_new_job_run"] = false
						});
					}
				}
				break;
			case AgentTaskEventKind.SteerAccepted:
				ClickyAnalytics.TrackAgentFollowedUp(e.Text ?? "", "text", text2, new JsonObject
				{
					["is_job"] = taskDetail?.JobId != null,
					["is_follow_up"] = true,
					["is_new_job_run"] = false,
					["is_steer"] = true
				});
				break;
			case AgentTaskEventKind.IntegrationUsed:
			{
				string text3 = e.Text;
				if (text3 != null && text3.Length > 0)
				{
					ClickyAnalytics.TrackAgentUsedIntegration(text2, text, text3);
				}
				break;
			}
			case AgentTaskEventKind.ExtraUsageApproved:
				ClickyAnalytics.TrackAgentExtraEffortApproved(text2);
				break;
			case AgentTaskEventKind.Finished:
			{
				string? finalMessage = taskDetail?.Snapshot.FinalResponseMarkdown ?? taskDetail?.Summary ?? e.Text ?? "";
				int? durationMilliseconds = (((object)taskDetail == null) ? ((int?)null) : new int?((int)(DateTimeOffset.Now - taskDetail.Snapshot.StartedAt).TotalMilliseconds));
				int? tokenCount = (((object)taskDetail == null) ? ((int?)null) : new int?((int)Math.Min(2147483647L, taskDetail.InputTokens + taskDetail.OutputTokens)));
				ClickyAnalytics.TrackAgentFinished(finalMessage, text2, durationMilliseconds, tokenCount, text);
				break;
			}
			case AgentTaskEventKind.Failed:
			{
				bool flag = taskDetail?.Snapshot.ThreadId != null || taskDetail?.TurnId != null;
				ClickyAnalytics.TrackAgentFailed(e.Text ?? taskDetail?.FailureMessage ?? "unknown", flag ? "run" : "launch", text2, text);
				break;
			}
			case AgentTaskEventKind.Stopped:
				ClickyAnalytics.TrackAgentInterrupted(e.Text ?? "Stopped.", text2, text);
				break;
			case AgentTaskEventKind.NeedsExtraUsageApproval:
				ClickyAnalytics.TrackAgentExtraEffortApprovalShown(text2);
				break;
			}
			AgentTaskEventKind kind = e.Kind;
			bool flag4 = (uint)(kind - 8) <= 2u;
			if (flag4 && (object)taskDetail != null && text2 != null)
			{
				ClickyAITracing.EmitTraceStartIfNeeded(ClickyAITracing.Mode.Agent, text2, new JsonObject { ["clicky_agent_thread_title"] = taskDetail.Snapshot.Title });
				bool flag5 = e.Kind == AgentTaskEventKind.Finished;
				string text4;
				if (flag5)
				{
					text4 = "completed";
				}
				else
				{
					text4 = ((e.Kind == AgentTaskEventKind.Stopped) ? "interrupted" : "failed");
				}
				ClickyAITracing.EmitAgentGeneration(text2, "codex_agent_turn", null, text ?? "", taskDetail.Snapshot.FinalResponseMarkdown ?? taskDetail.Summary ?? "", (taskDetail.InputTokens > 0) ? new long?(taskDetail.InputTokens) : ((long?)null), (taskDetail.OutputTokens > 0) ? new long?(taskDetail.OutputTokens) : ((long?)null), (DateTimeOffset.Now - taskDetail.Snapshot.StartedAt).TotalSeconds, !flag5, flag5 ? null : (e.Text ?? taskDetail.FailureMessage ?? text4), new JsonObject
				{
					["clicky_turn_status"] = text4,
					["clicky_screenshot_count"] = 0,
					["clicky_used_computer_use"] = false,
					["clicky_computer_use_tool_names"] = new JsonArray(),
					["clicky_computer_use_tool_count"] = 0,
					["clicky_integrations_used"] = new JsonArray(),
					["clicky_integrations_used_count"] = 0
				});
			}
		}
		catch (Exception ex)
		{
			Log.Warn("analytics", "agent event: " + ex.Message);
		}
	}

	private static void TrackPlan(PlanSnapshot plan)
	{
		string effectiveTier = plan.EffectiveTier;
		string text;
		if (effectiveTier == "max")
		{
			text = "HeyClicky Max";
		}
		else
		{
			text = ((!(effectiveTier == "pro")) ? "Free" : "HeyClicky Pro");
		}
		string planDisplayName = text;
		ClickyAnalytics.UpdateUserPlanProperties(plan.Plan, planDisplayName, plan.Plan == "unlimited");
	}

	private void WirePower()
	{
		NotchUi.Window.RawMessage += (uint msg, nint w, nint _) =>
		{
			switch (msg)
			{
			case 26u:
				MotionPreference.Refresh();
				break;
			case 536u:
				if (w == 4)
				{
					DispatcherQueue.TryEnqueue(OnSuspend);
				}
				else
				{
					long num = w;
					if ((num == 7 || num == 18) ? true : false)
					{
						DispatcherQueue.TryEnqueue(OnResume);
					}
				}
				break;
			}
		};
	}

	private void OnSuspend()
	{
		Log.Info("power", "going to sleep: stopping voice and dictation");
		try
		{
			Real?.Dictation.CancelActiveSession();
		}
		catch (Exception ex)
		{
			Log.Warn("power", "dictation: " + ex.Message);
		}
		try
		{
			if (Services.Companion.State != VoiceState.Idle)
			{
				Services.Companion.Cancel();
			}
		}
		catch (Exception ex2)
		{
			Log.Warn("power", "companion: " + ex2.Message);
		}
		try
		{
			Real?.Highlight.Clear();
		}
		catch
		{
		}
	}

	private void OnResume()
	{
		if (DateTimeOffset.UtcNow - lastResume < TimeSpan.FromSeconds(5L))
		{
			return;
		}
		lastResume = DateTimeOffset.UtcNow;
		Log.Info("power", "woke up: re-placing windows, warming the voice, refreshing the plan");
		ReplaceSurfacesAfterDisplayChange();
		RealStack real = Real;
		if (real != null && real.Core.Auth.IsSignedIn)
		{
			real.Companion.Prewarm();
			real.Core.Billing.RefreshAsync();
		}
		bool flag = updates != null;
		if (flag)
		{
			UpdateState state = updates.State;
			bool flag2 = ((state == UpdateState.Idle || state == UpdateState.UpToDate || state == UpdateState.Failed) ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			Task.Run(() => updates.CheckAfterWakeAsync());
		}
	}

	private void ReplaceSurfacesAfterDisplayChange()
	{
		try
		{
			Native.SendMessage(NotchUi.Window.Hwnd, 126u, 0, 0);
		}
		catch (Exception ex)
		{
			Log.Warn("power", "notch: " + ex.Message);
		}
	}

	private bool HandleSystemDeepLink(Uri uri)
	{
		string text = uri.Host.ToLowerInvariant();
		string text2 = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
		if (text == null || text.Length != 0)
		{
			switch (text)
			{
			case "referral":
			{
				if (string.IsNullOrWhiteSpace(text2))
				{
					Log.Info("deeplink", "referral link with no code");
					return true;
				}
				bool isSignedIn = Services.Auth.IsSignedIn;
				ClickyAnalytics.TrackReferralDeepLinkOpened(isSignedIn);
				ReceiveFriendReferralCode(Uri.UnescapeDataString(text2), fromAuthCallback: false);
				if (isSignedIn)
				{
					ClickyAnalytics.NoteReferralPageEntryPoint("deep_link");
					OpenSettings(NotchSettingsSection.Referral);
				}
				return true;
			}
			case "skill":
				Log.Info("deeplink", "skill/" + ((text2 == null) ? "" : Uri.UnescapeDataString(text2)) + ": skills are deprecated; ignored");
				return true;
			case "integrations-auth-callback":
			{
				Dictionary<string, string> parameters = AuthDeepLink.ParseParameters(uri.OriginalString);
				string text3 = null;
				string[] array = new string[3] { "integration", "toolkit", "integration_id" };
				foreach (string key in array)
				{
					if (parameters.TryGetValue(key, out string value) && !string.IsNullOrWhiteSpace(value))
					{
						text3 = value.Trim().ToLowerInvariant();
						break;
					}
				}
				bool flag = parameters.Keys.Any((string k) =>
				{
					bool flag5;
					switch (k.ToLowerInvariant())
					{
					case "error":
					case "error_description":
					case "error_code":
						flag5 = true;
						break;
					default:
						flag5 = false;
						break;
					}
					return flag5 && !string.IsNullOrEmpty(parameters[k]);
				});
				if (!flag)
				{
					bool flag2 = parameters.TryGetValue("status", out string value2);
					if (flag2)
					{
						bool flag3;
						switch (value2.Trim().ToLowerInvariant())
						{
						case "error":
						case "failed":
						case "failure":
						case "cancelled":
						case "canceled":
							flag3 = true;
							break;
						default:
							flag3 = false;
							break;
						}
						flag2 = flag3;
					}
					flag = flag2;
				}
				bool flag4 = flag;
				Log.Info("deeplink", "integrations auth callback: " + (text3 ?? "unknown integration") + " " + (flag4 ? "failed" : "connected"));
				if (!Services.Auth.IsSignedIn)
				{
					return true;
				}
				IntegrationAuthCallback?.Invoke(text3, flag4);
				return true;
			}
			case "checkout-complete":
			{
				CheckoutCompleteLink checkoutCompleteLink = WorkerClient.ParseCheckoutCompleteLink(uri);
				if ((object)checkoutCompleteLink != null)
				{
					ClickyAnalytics.TrackCheckoutReturned(checkoutCompleteLink.IsCanceled, checkoutCompleteLink.IsPortal, checkoutCompleteLink.CheckoutSessionId);
				}
				return false;
			}
			default:
				return false;
			}
		}
		SayBrowserHandoffLine("(・ω・)ノ hi, i'm here!");
		return true;
	}

	private void SayBrowserHandoffLine(string line)
	{
		Log.Info("deeplink", "handoff line: " + line);
		Action<string> browserHandoffLineSink = BrowserHandoffLineSink;
		if (browserHandoffLineSink != null)
		{
			browserHandoffLineSink(line);
		}
		else
		{
			SayAtCursorAsync(line, streamed: true, 5.0);
		}
	}

	private void ReceiveFriendReferralCode(string code, bool fromAuthCallback)
	{
		code = code.Trim();
		if (code.Length != 0)
		{
			Log.Info("referral", "friend code received (" + (fromAuthCallback ? "auth callback" : "deep link") + ")");
			try
			{
				Directory.CreateDirectory(Path.GetDirectoryName(PendingReferralFile));
				string text = ((!Services.Auth.IsSignedIn) ? null : Real?.Core.Auth.UserId);
				File.WriteAllText(PendingReferralFile, new JsonObject
				{
					["code"] = code,
					["owner"] = text
				}.ToJsonString());
			}
			catch (Exception ex)
			{
				Log.Warn("referral", "pending code not saved: " + ex.Message);
			}
			if (Services.Auth.IsSignedIn)
			{
				ClaimPendingReferralCodeAsync();
			}
		}
	}

	private async Task ClaimPendingReferralCodeAsync()
	{
		RealStack real = Real;
		if (real == null || !real.Core.Auth.IsSignedIn)
		{
			return;
		}
		string userId = real.Core.Auth.UserId;
		if (userId == null || Interlocked.Exchange(ref claimingReferral, 1) == 1)
		{
			return;
		}
		try
		{
			if (!File.Exists(PendingReferralFile))
			{
				return;
			}
			JsonObject obj = JsonNode.Parse(await File.ReadAllTextAsync(PendingReferralFile).ConfigureAwait(continueOnCapturedContext: false)) as JsonObject;
			string text = obj?["code"]?.GetValue<string>();
			string text2 = obj?["owner"]?.GetValue<string>();
			if (string.IsNullOrWhiteSpace(text))
			{
				File.Delete(PendingReferralFile);
				return;
			}
			if (text2 != null && text2 != userId)
			{
				Log.Info("referral", "pending code belongs to another account; left for it");
				return;
			}
			try
			{
				ReferralOutcomeResponse referralOutcomeResponse = await real.Core.Worker.ClaimReferralAsync(text, "deep_link").ConfigureAwait(continueOnCapturedContext: false);
				string text3 = referralOutcomeResponse?.Outcome ?? "request_failed";
				ClickyAnalytics.TrackReferralFriendCodeClaimResult("deep_link", text3);
				string text4 = referralOutcomeResponse?.Message;
				Log.Info("referral", "claim answered: " + text3 + ((text4 != null) ? (" (" + text4 + ")") : ""));
				if ((object)referralOutcomeResponse != null)
				{
					File.Delete(PendingReferralFile);
				}
			}
			catch (Exception ex)
			{
				ClickyAnalytics.TrackReferralFriendCodeClaimResult("deep_link", "request_failed");
				Log.Warn("referral", "claim failed (kept for next time): " + ex.Message);
			}
		}
		catch (Exception ex2)
		{
			Log.Warn("referral", "pending code: " + ex2.Message);
		}
		finally
		{
			Interlocked.Exchange(ref claimingReferral, 0);
		}
	}

	private void StartTaskbarButton(RealStack real)
	{
		if (OverlayWindow.Offscreen)
		{
			return;
		}
		taskbarButton = new TaskbarButton("HeyClicky", Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico"));
		taskbarButton.Clicked += () =>
		{
			Log.Info("taskbar", "button clicked");
			HandleReopen();
		};
		taskbarButton.CloseRequested += () =>
		{
			Log.Info("taskbar", "quit from the taskbar button");
			Quit();
		};
		SyncTaskbarButton(real);
		real.Core.Settings.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				SyncTaskbarButton(real);
			});
		};
	}

	private void SyncTaskbarButton(RealStack real)
	{
		taskbarButton?.SetShown(real.Core.Settings.Read((AppSettings s) => s.ShowInTaskbar));
	}

	public bool CanRunFinaleReveal()
	{
		InterviewController interview = Interview;
		if (interview == null || (!interview.HasBuiltPlan && !interview.IsPlanInFlight))
		{
			return StarterCast.PresentSlugs().Count > 0;
		}
		return true;
	}

	public bool CanRunDrawnFinale()
	{
		if (DrawnOnboardingTour.IsFinaleEnabled && !InterviewSendOffInProgress)
		{
			return Interview?.Transcript.Any((InterviewLine l) => l.Role == "user") ?? false;
		}
		return false;
	}

	public void TourRefusal(string line)
	{
		if (Environment.TickCount64 - lastRefusalAt >= 6000)
		{
			lastRefusalAt = Environment.TickCount64;
			SayAtCursorAsync(line, streamed: true, 2.5);
		}
	}

	public async Task RunDrawnFinaleAsync()
	{
		if (InterviewSendOffInProgress)
		{
			return;
		}
		InterviewSendOffInProgress = true;
		bool drew = false;
		try
		{
			drew = await RunDrawnOnboardingFinaleAsync();
		}
		catch (Exception ex)
		{
			Log.Error("drawn tour", "finale failed", ex);
		}
		finally
		{
			InterviewSendOffInProgress = false;
		}
		CompleteTutorialAfterFinaleReveal(drew, aborted: false, sendOffLineDue: true);
		AfterFinale();
	}

	public async Task RunFinaleRevealAsync()
	{
		if (!TourHoldsHome)
		{
			DrawnOnboardingNotch.DismissPeek(this);
			tour = new HomeTour(this, Interview);
			CursorCompanion.WatchEscape(on: true);
			bool flag = false;
			try
			{
				flag = await tour.RunAsync();
			}
			finally
			{
				CursorCompanion.WatchEscape(on: false);
			}
			CompleteTutorialAfterFinaleReveal(revealRan: true, tour.WasAborted, flag && !tour.WasAborted);
			tour = null;
			AfterFinale();
		}
	}

	private void AfterFinale()
	{
		HeaderPills.RaiseChanged();
		Dock?.Refresh();
		SyncRestingMark();
		SyncNotchRouting();
		lastAgentSignature = null;
		SyncAgentActivity();
	}

	private void CompleteTutorialAfterFinaleReveal(bool revealRan, bool aborted, bool sendOffLineDue)
	{
		Log.Info("tour", $"finale over (ran: {revealRan}, aborted: {aborted}, line due: {sendOffLineDue})");
		bool flag = newAgentsUiDemoRun;
		finaleSuppressesEndLine = revealRan;
		tutorial?.FinishAfterReveal();
		if (!revealRan)
		{
			return;
		}
		EndNewAgentsUiDemoRun();
		FadeOutOnboardingMusic(3.0);
		if (aborted)
		{
			DrawnOnboardingTour.ReleaseNotch();
			return;
		}
		if (flag)
		{
			DrawnOnboardingTour.ReleaseNotch();
			if (sendOffLineDue)
			{
				StreamHoldToTalkLineAfterOnboarding();
			}
			return;
		}
		PaywallThenAsync(() =>
		{
			DrawnOnboardingTour.ReleaseNotch();
			if (sendOffLineDue)
			{
				StreamHoldToTalkLineAfterOnboarding();
			}
		});
	}

	private async Task PaywallThenAsync(Action then)
	{
		BillingUi billingUi = Services.Billing;
		if (billingUi != null && !paywallLineWired)
		{
			paywallLineWired = true;
			billingUi.PaywallClosed += (PaywallSource source, PaywallCloseKind kind) =>
			{
				if (source == PaywallSource.OnboardingCompleted && kind != PaywallCloseKind.HandedOff)
				{
					Action next = afterOnboardingPaywall;
					afterOnboardingPaywall = null;
					DispatcherQueue.TryEnqueue(() =>
					{
						next?.Invoke();
					});
				}
			};
		}
		afterOnboardingPaywall = then;
		bool shown = false;
		try
		{
			shown = await ShowOnboardingPaywallAsync();
		}
		catch (Exception ex)
		{
			Log.Warn("tour", "onboarding paywall: " + ex.Message);
		}
		Log.Info("tour", "onboarding paywall " + (shown ? "shown" : "not shown"));
		if (!shown)
		{
			afterOnboardingPaywall = null;
			then();
		}
	}

	private void StreamHoldToTalkLineAfterOnboarding()
	{
		ClickyTourJobCards.Shared.PopHeldNextQuestions();
		SayAtCursorAsync("(^_^) hold " + Services.Settings.PushToTalkDisplay.ToLowerInvariant() + " and ask me something.", streamed: true, 25.0);
	}

	public void SetTourMusic(bool playing)
	{
		if (playing)
		{
			if ((object)music == null)
			{
				StartOnboardingMusic(0.12);
			}
		}
		else
		{
			FadeOutOnboardingMusic(0.6);
		}
	}

	private void WireTour660Hooks(RealStack real)
	{
		WireDrawnTourNotch();
		WireTourDrive(real);
		WireTourJobs(real);
		FlowHooks.BrowserStateNote = (bool canDrive) => ClickyBrowserBridge.Shared.BrowserStateNote(canDrive);
		real.Companion.TextAnswerHandedToCaptions += (object? _, EventArgs _) =>
		{
			NotchPresenter corePresenter = CorePresenter;
			if (corePresenter != null)
			{
				corePresenter.SuppressHoverUntilPointerReentry();
				if (corePresenter.RendersTextResponsesInNotchChat)
				{
					NotchChat.History?.NoteAnswerStopped();
				}
				corePresenter.CloseNotchChatSession(NotchChatSessionCloseReason.DrawingCaption);
			}
		};
	}

	private void WireDrawnTourNotch()
	{
		DrawnOnboardingNotchShowcase.OpenNotchOnHome = () =>
		{
			NotchPresenter corePresenter = CorePresenter;
			if (corePresenter != null)
			{
				corePresenter.SetTourShowcaseShowing(showing: true);
				corePresenter.Tabs.Select(NotchTab.Home);
				corePresenter.OpenNotchAgentPeekOnRequest();
				corePresenter.SetNotchHeldOpenForPresentation(held: true);
				NotchExtensions.RaiseShowcaseChanged();
				KeepNotchAboveTheDrawing();
			}
		};
		DrawnOnboardingNotchShowcase.FoldNotch = () =>
		{
			NotchPresenter corePresenter = CorePresenter;
			if (corePresenter != null)
			{
				corePresenter.SetNotchHeldOpenForPresentation(held: false);
				corePresenter.DismissNotchAgentPeek();
				corePresenter.SetTourShowcaseShowing(showing: false);
				NotchExtensions.RaiseShowcaseChanged();
			}
		};
		DrawnOnboardingNotchShowcase.Shared.Changed += () =>
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				NotchExtensions.ShowcaseSampleIntegrationIds = DrawnOnboardingNotchShowcase.Shared.SampleIntegrationIds.ToList();
				NotchExtensions.RaiseShowcaseChanged();
			});
		};
		DrawnOnboardingTour.NotchHoverSuppressionChanged += () =>
		{
			DispatcherQueue.TryEnqueue(SyncNotchRouting);
		};
	}

	private void KeepNotchAboveTheDrawing()
	{
		Raise();
		if ((object)notchAboveDrawingTimer == null)
		{
			DispatcherQueueTimer timer = (notchAboveDrawingTimer = DispatcherQueue.CreateTimer());
			timer.Interval = TimeSpan.FromMilliseconds(200L, 0L);
			timer.Tick += (DispatcherQueueTimer _, object _) =>
			{
				NotchPresenter? corePresenter = CorePresenter;
				if (corePresenter == null || !corePresenter.IsTourShowcaseShowing)
				{
					timer.Stop();
				}
				else
				{
					Raise();
				}
			};
		}
		notchAboveDrawingTimer.Start();
		void Raise()
		{
			Native.SetWindowPos(NotchUi.Window.Hwnd, FullscreenGuard.TopmostInsertAfter(), 0, 0, 0, 0, 19u);
			Dock?.KeepAboveNotch();
		}
	}

	private void WireTourDrive(RealStack real)
	{
		OnboardingDriveDemo demo = OnboardingDriveDemo.Shared;
		TourDrive.StepContent = (Color accent, FrameworkElement askRow, Func<bool> stepCompleted) =>
		{
			if (demo.State != OnboardingDriveDemo.DemoState.Driving && !stepCompleted())
			{
				demo.Reset();
			}
			FrameworkElement frameworkElement = demo.CreateWindowView(DS.CursorColor(Services.Settings.CursorColorHex));
			frameworkElement.HorizontalAlignment = HorizontalAlignment.Center;
			Grid status = new Grid
			{
				Height = 14.0
			};
			StackPanel stackPanel = new StackPanel();
			stackPanel.Spacing = 12.0;
			stackPanel.Children.Add(frameworkElement);
			stackPanel.Children.Add(askRow);
			stackPanel.Children.Add(status);
			stackPanel.Loaded += (object _, RoutedEventArgs _) =>
			{
				demo.Changed += OnChanged;
				real.Companion.StateChanged += OnState;
				Refresh();
			};
			stackPanel.Unloaded += (object _, RoutedEventArgs _) =>
			{
				demo.Changed -= OnChanged;
				real.Companion.StateChanged -= OnState;
			};
			Refresh();
			return stackPanel;
			void OnChanged()
			{
				DispatcherQueue.TryEnqueue(Refresh);
			}
			void OnState(object? sender, EventArgs e)
			{
				DispatcherQueue.TryEnqueue(Refresh);
			}
			void Refresh()
			{
				askRow.Opacity = ((demo.State == OnboardingDriveDemo.DemoState.Driving) ? 0.4 : 1.0);
				status.Children.Clear();
				string text = demo.StatusLine(stepCompleted(), real.Companion.State == VoiceState.Listening);
				if (text != null)
				{
					status.Children.Add(Ui.Text(text, 11.5, FontWeights.Medium, DS.Colors.TextSecondary, TextAlignment.Center));
				}
			}
		};
		TourDrive.Run = () =>
		{
			nint num = tutorial?.Window.Hwnd ?? 0;
			demo.Run(new OnboardingDriveContext
			{
				Display = ((num != 0) ? Displays.ForWindow(num) : Displays.Primary()),
				Accent = DS.CursorColor(Services.Settings.CursorColorHex),
				SpeakLine = (string line) => real.Companion.SpeakVerbatimLineAsync(line),
				AudioPlaybackBeganCount = () => real.Companion.AudioPlaybackBeganCount,
				IsResponding = () => real.Companion.State == VoiceState.Responding,
				FirstName = AccountFirstNameForTour,
				StepCompleted = () =>
				{
					TourDrive.Completed?.Invoke();
				},
				PlayChime = Sounds.Play,
				PlayDrawingSound = real.Canvas.PlayOneShot
			});
		};
		TourDrive.IsDriving = () => demo.State == OnboardingDriveDemo.DemoState.Driving;
		TourDrive.Cancel = demo.Cancel;
	}

	private void WireTourJobs(RealStack real)
	{
		AgentService agents = real.Agents;
		ClickyTourJobCards.CreateWaitingJob = (string title, string pitch, Guid cardId) =>
		{
			try
			{
				agents.Jobs.CreateWaitingJob(title, pitch, cardId, agents.ProjectsRoot);
			}
			catch (Exception ex)
			{
				Log.Warn("drawn tour", "waiting job for \"" + title + "\": " + ex.Message);
			}
		};
		ProactiveHooks.LaunchApprovedCardAsJob = (ProactiveJobLaunch launch) =>
		{
			ProactiveSuggestionCard card = launch.Card;
			ClickyJob clickyJob = agents.Jobs.WaitingJob(card.Id);
			ClickyJob clickyJob2 = (((object)clickyJob != null) ? agents.Jobs.BeginWaitingJob(clickyJob.Id) : null);
			string result;
			try
			{
				result = agents.LaunchAsync(new AgentLaunchRequest
				{
					Prompt = launch.Transcript,
					JobId = clickyJob2?.Id,
					NewClickyName = card.Title,
					LaunchContext = launch.LaunchContext,
					LaunchSource = "suggestion",
					UsageContext = "companion",
					IsGeneratedTaskBrief = true,
					ProactiveSuggestionId = card.ServerSuggestionId
				}).GetAwaiter().GetResult();
			}
			catch (Exception ex)
			{
				Log.Warn("proactive", "\"" + card.Title + "\" as a job: " + ex.Message);
				if ((object)clickyJob2 != null)
				{
					agents.Jobs.Dismiss(clickyJob2.Id);
				}
				return false;
			}
			agents.TrackJobAction("started", null, new Dictionary<string, object> { ["from"] = "suggestion" });
			try
			{
				AgentToolHost.Launched?.Invoke(new AgentToolLaunch(launch.Transcript, null, card.Title, "Helper", null, null, "voice", null, null, "companion", AsJob: true), result);
			}
			catch (Exception ex2)
			{
				Log.Warn("proactive", "hand-off note: " + ex2.Message);
			}
			ProactiveRoutine routine = card.Routine;
			if ((object)routine != null)
			{
				string text = clickyJob2?.Id ?? agents.GetTaskDetail(result)?.JobId;
				if (text != null)
				{
					agents.Routines.RegisterApprovedSuggestion("", string.IsNullOrWhiteSpace(routine.Title) ? card.Title : routine.Title, card.AgentPrompt, routine.ClampedIntervalMinutes, result, text);
				}
			}
			return true;
		};
	}

	private void WireTrayTooltip()
	{
		if (!trayTooltipWired)
		{
			trayTooltipWired = true;
			Services.Auth.Changed += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(UpdateTrayTooltip);
			};
			Services.Settings.Changed += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(UpdateTrayTooltip);
			};
			Services.Agents.TasksChanged += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(UpdateTrayTooltip);
			};
			UpdateTrayTooltip();
		}
	}

	private void UpdateTrayTooltip()
	{
		if (tray == null)
		{
			return;
		}
		try
		{
			List<string> workingClickyNames = (from t in Services.Agents.Tasks.Where((AgentTaskSnapshot t) =>
				{
					AgentTaskStatus status = t.Status;
					return (uint)status <= 1u;
				})
				select t.Title).ToList();
			tray.SetTooltip(TrayTooltip.Text(Services.Auth.IsSignedIn, Services.Settings.IsPaused, workingClickyNames));
		}
		catch (Exception ex)
		{
			Log.Warn("tray", "tooltip: " + ex.Message);
		}
	}

	private void StartAuxiliary()
	{
		if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return;
		DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () =>
		{
			tray = new TrayIcon("HeyClicky", TrayColor(Services.Settings.CursorColorHex));
			tray.OpenSettings += () =>
			{
				DispatcherQueue.TryEnqueue(OpenSettings);
			};
			tray.Clicked += () =>
			{
				DispatcherQueue.TryEnqueue(HandleTrayClick);
			};
			tray.ReportBug += () =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					BugReport.Run(new SettingsHost(Services, this));
				});
			};
			tray.RequestFeature += () =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					ClickyAnalytics.TrackFeatureRequestOpened();
					OpenUrl(SettingsHost.Links.FeatureRequest ?? "");
				});
			};
			tray.WhatsNew += () =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					ClickyAnalytics.TrackChangelogOpened("tray_menu");
					OpenUrl(SettingsHost.Links.Changelog ?? "");
				});
			};
			tray.CheckForUpdates += () =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					CheckForUpdatesFromMenu("tray_menu");
				});
			};
			tray.Quit += () =>
			{
				DispatcherQueue.TryEnqueue(Quit);
			};
			tray.PauseToggled += (bool p) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					SetPaused(p);
				});
			};
			tray.IsPaused = () => Services.Settings.IsPaused;
			WireTrayTooltip();
		});
		Services.Permissions.Changed += (object? _, EventArgs _) =>
		{
			DispatcherQueue.TryEnqueue(AutoAdvancePermissions);
		};
	}

	private void DisposeAuxiliary()
	{
		tray?.Dispose();
		tray = null;
	}

	private void StartFirstRunFlow()
	{
		if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return;
		RealStack real = Real;
		if (real != null)
		{
			OnboardingProgress onboardingProgress = real.Core.Settings.Read((AppSettings s) => s.Onboarding);
			PreloadOnboardingVideoIfNeeded();
			if (Options.ShowIntro || PreSignInIntroViewModel.ShouldPresent(onboardingProgress, real.Core.Auth.IsSignedIn))
			{
				TrackNotchFirstShown("pre_sign_in_intro");
				ShowIntro();
				return;
			}
			TrackNotchFirstShown((!onboardingProgress.HasCompletedOnboarding || !AllPermissionsGranted) ? "onboarding" : "post_onboarding");
			if (Options.ShowTutorial)
			{
				StartTutorial();
			}
			else
			{
				SyncOnboardingPin();
			}
		}
		else if (Options.ShowIntro || !Services.Settings.HasCompletedIntro)
		{
			TrackNotchFirstShown("pre_sign_in_intro");
			ShowIntro();
		}
		else
		{
			TrackNotchFirstShown((!Services.Settings.HasCompletedOnboarding || !AllPermissionsGranted) ? "onboarding" : "post_onboarding");
			if (Options.ShowTutorial)
			{
				StartTutorial();
			}
			else if (!Services.Settings.HasCompletedOnboarding)
			{
				Services.Presenter.Present(new NotchPresentation.OnboardingPinned(0));
			}
		}
	}

	private void TrackNotchFirstShown(string entryContext)
	{
		if (!notchFirstShownTracked)
		{
			notchFirstShownTracked = true;
			ClickyAnalytics.TrackNotchFirstShown(entryContext);
		}
	}

	public void StartTutorial()
	{
		TutorialWindow tutorialWindow = tutorial;
		if (tutorialWindow != null && tutorialWindow.IsRunning)
		{
			tutorialWindow.BringForward();
			return;
		}
		EndNewAgentsUiDemoRun();
		Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.AgentPeek));
		CorePresenter?.CollapseHoverAfterOutsideClick();
		if (tutorial == null)
		{
			tutorial = CreateTutorial();
		}
		tutorial.Show();
	}

	private TutorialWindow CreateTutorial()
	{
		if (Interview == null)
		{
			InterviewController interviewController = (Interview = new InterviewController(Services, Real));
		}
		Interview.PlanLanded += (bool _) =>
		{
			DispatcherQueue.TryEnqueue(PrefetchDrawnOnboardingFinaleIfReady);
		};
		TutorialWindow tutorialWindow = new TutorialWindow(Services, this, ExcludeFromCapture)
		{
			Vm = Real?.Tutorial,
			Interview = Interview,
			StepChanged = OnTourStepChanged,
			StopVoiceAndMarks = () =>
			{
				Services.Companion.Cancel();
				Real?.Highlight.Clear();
				Real?.Canvas.Clear();
			},
			DrawingShown = () => Real?.Canvas.IsShowingDrawing ?? false,
			CanReveal = CanRunFinaleReveal,
			RunReveal = RunFinaleRevealAsync,
			Music = SetTourMusic,
			CanDrawFinale = CanRunDrawnFinale,
			RunDrawnFinale = RunDrawnFinaleAsync,
			Canvas = Real?.Canvas,
			MicrophoneName = () => Real?.Core.Settings.Read((AppSettings x) => x.MicrophoneDeviceName),
			MicrophonePicked = (string? id, string label) =>
			{
				RealStack real2 = Real;
				if (real2 != null)
				{
					real2.Core.Settings.Update((AppSettings x) =>
					{
						x.MicrophoneDeviceId = id;
						x.MicrophoneDeviceName = ((id == null) ? null : label);
					});
					Log.Info("tutorial", $"microphone: {label} ({id ?? "system default"})");
				}
			}
		};
		tutorialWindow.Ended += () =>
		{
			Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.OnboardingTutorialResume));
			Services.Presenter.Present(new NotchPresentation.Idle());
			if (!TourHoldsHome)
			{
				FadeOutOnboardingMusic(3.0);
			}
		};
		RealStack real = Real;
		if (real != null && !tutorialVmWired)
		{
			tutorialVmWired = true;
			real.Companion.TurnFinished += (object? _, CompanionTurnFinish finish) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					tutorial?.NoteCompanionTurnFinished(finish);
				});
			};
			real.Tutorial.StepCompletedChime += (object? _, EventArgs _) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					Sounds.Play("clicky-text-receive", 0.3);
				});
			};
			real.Tutorial.SuccessLine += (object? _, string line) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					_ = SayAtCursorAsync(line, streamed: true, 2.5);
				});
			};
			real.Tutorial.Ended += (object? _, (string Reason, string CursorLine) e) =>
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					if (finaleSuppressesEndLine)
					{
						finaleSuppressesEndLine = false;
					}
					else
					{
						if (e.Reason == "finished")
						{
							Sounds.Play("agent-done", 0.4);
						}
						string line = e.CursorLine.Replace("ctrl + alt", Services.Settings.PushToTalkDisplay.ToLowerInvariant());
						bool flag = newAgentsUiDemoRun;
						EndNewAgentsUiDemoRun();
						if (flag)
						{
							_ = SayAtCursorAsync(line, streamed: true, 5.0);
						}
						else
						{
							_ = PaywallThenAsync(() =>
							{
								_ = SayAtCursorAsync(line, streamed: true, 5.0);
							});
						}
					}
				});
			};
		}
		return tutorialWindow;
	}

	private void NarrateVerbatim(IReadOnlyList<string> lines)
	{
		RealStack real = Real;
		if (real == null)
		{
			return;
		}
		Task.Run(async () =>
		{
			try
			{
				if (await real.Companion.Mouth.EnsureOpenAsync())
				{
					for (int i = 0; i < lines.Count; i++)
					{
						real.Companion.Mouth.SpeakLine(lines[i], -2 - i);
					}
				}
			}
			catch (Exception ex)
			{
				Log.Warn("tutorial", "reveal narration: " + ex.Message);
			}
		});
	}

	public void ShowIntro()
	{
		if (intro == null)
		{
			intro = CreateIntro();
		}
		intro.Show();
	}

	private IntroWindow CreateIntro()
	{
		IntroWindow i = new IntroWindow(Services, this, ExcludeFromCapture)
		{
			Vm = IntroVm
		};
		i.FlightRequested += (IntroWindow.Point2 p) =>
		{
			Fly(p.X, p.Y);
		};
		i.ReducedMotionHandOff += () =>
		{
			Sounds.Play("clicky-surprised", 0.95);
			i.HandOffComplete();
			ActivateIntroHomeWelcome();
		};
		return i;
	}

	private void Fly(double x, double y)
	{
		if (flight == null)
		{
			flight = new HatchFlightOverlay(ExcludeFromCapture);
		}
		Color color = DS.CursorColor(Services.Settings.CursorColorHex);
		flight.NotchShouldExpand += OnExpand;
		flight.Landed += OnLanded;
		flight.PeekFinishing += OnPeekFinishing;
		flight.Fly(x, y, color);
		void OnExpand()
		{
			flight.NotchShouldExpand -= OnExpand;
			Services.Presenter.ShowLiveEvent(new NotchLiveEvent.IntroHatchPeek());
		}
		void OnLanded()
		{
			flight.Landed -= OnLanded;
			Sounds.Play("clicky-surprised", 0.95);
			DispatcherQueueTimer dispatcherQueueTimer = DispatcherQueue.CreateTimer().Rooted();
			dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(0.75);
			dispatcherQueueTimer.IsRepeating = false;
			dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
			{
				intro?.HandOffComplete();
			};
			dispatcherQueueTimer.Start();
		}
		void OnPeekFinishing()
		{
			flight.PeekFinishing -= OnPeekFinishing;
			Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.IntroHatchPeek));
			ActivateIntroHomeWelcome();
		}
	}

	private void ActivateIntroHomeWelcome()
	{
		CorePresenter?.SetIntroHomeWelcomeAutoShownPin(pinned: true);
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = CardVm;
		if (notchOnboardingCardViewModel != null)
		{
			notchOnboardingCardViewModel.IsIntroHomeWelcomeActive = true;
			SyncOnboardingPin();
		}
		else
		{
			if (!fakeIntroWelcomeActive)
			{
				ClickyAnalytics.TrackPreSignInIntroNotchWelcomeShown();
			}
			fakeIntroWelcomeActive = true;
			CorePresenter?.SetIntroHomeWelcomeActive(active: true);
			Services.Presenter.Present(new NotchPresentation.OnboardingPinned(0));
		}
		Log.Info("intro", "notch welcome pinned (auto-shown until one hover in and out)");
	}

	public void OnboardingCardAction(int step)
	{
		NotchOnboardingCardViewModel notchOnboardingCardViewModel = CardVm;
		if (notchOnboardingCardViewModel != null)
		{
			notchOnboardingCardViewModel.PrimaryActionAsync();
			return;
		}
		switch (step)
		{
		case 0:
		{
			if (fakeIntroWelcomeActive)
			{
				fakeIntroWelcomeActive = false;
				CorePresenter?.SetIntroHomeWelcomeActive(active: false);
				ClickyAnalytics.TrackPreSignInIntroNotchFinalSetupTapped();
				if (!fakeIntroDismissedTracked)
				{
					ClickyAnalytics.TrackPreSignInIntroDismissed();
				}
				fakeIntroDismissedTracked = true;
			}
			int num = NextPermissionStep(1);
			if (num == 3)
			{
				OnboardingCardAction(num);
			}
			else
			{
				Services.Presenter.Present(new NotchPresentation.OnboardingPinned(num));
			}
			break;
		}
		case 3:
			ClickyAnalytics.TrackOnboardingStarted();
			Services.Settings.HasCompletedOnboarding = true;
			Services.Presenter.ShowLiveEvent(new NotchLiveEvent.OnboardingTutorialInvite());
			ClickyAnalytics.TrackOnboardingTutorialInvitePresented();
			break;
		}
	}

	private int NextPermissionStep(int from)
	{
		if (from <= 1 && Services.Permissions.GetStatus(PermissionKind.Microphone) != PermissionStatus.Granted)
		{
			return 1;
		}
		if (from <= 2 && Services.Permissions.GetStatus(PermissionKind.ScreenCapture) != PermissionStatus.Granted)
		{
			return 2;
		}
		return 3;
	}

	private void AutoAdvancePermissions()
	{
		if (Real != null || !(Services.Presenter.Presentation is NotchPresentation.OnboardingPinned onboardingPinned))
		{
			return;
		}
		int st = onboardingPinned.Step;
		PermissionKind? permissionKind;
		if (st == 1)
		{
			permissionKind = PermissionKind.Microphone;
		}
		else
		{
			permissionKind = ((st == 2) ? new PermissionKind?(PermissionKind.ScreenCapture) : ((PermissionKind?)null));
		}
		if (!permissionKind.HasValue || Services.Permissions.GetStatus(permissionKind.Value) != PermissionStatus.Granted)
		{
			return;
		}
		DispatcherQueueTimer dispatcherQueueTimer = DispatcherQueue.CreateTimer().Rooted();
		dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(1.2);
		dispatcherQueueTimer.IsRepeating = false;
		dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			if (Services.Presenter.Presentation is NotchPresentation.OnboardingPinned { Step: var step } && step == st)
			{
				Services.Presenter.Present(new NotchPresentation.OnboardingPinned(NextPermissionStep(st + 1)));
			}
		};
		dispatcherQueueTimer.Start();
	}

	public IntroWindow DemoIntro(IntroWindow.Step step)
	{
		if (intro == null)
		{
			intro = CreateIntro();
		}
		intro.Show(step);
		return intro;
	}

	public TutorialWindow DemoTutorial(TutorialWindow.Step step)
	{
		if (tutorial == null)
		{
			tutorial = CreateTutorial();
		}
		tutorial.Show(step);
		return tutorial;
	}

	public SettingsWindow DemoSettings(SettingsWindow.Page page)
	{
		if (settings == null)
		{
			settings = new SettingsWindow(Services, this, ExcludeFromCapture);
		}
		settings.Show(page);
		return settings;
	}

	public UIElement? DemoIntroRoot()
	{
		return intro?.Window.Root;
	}

	public UIElement? DemoTutorialRoot()
	{
		return tutorial?.Window.Root;
	}

	public TutorialWindow? DemoTutorialWindow()
	{
		return tutorial;
	}

	public UIElement? DemoSettingsRoot()
	{
		return settings?.Window.Root;
	}

	public void HideAuxWindows()
	{
		intro?.Hide();
		tutorial?.Hide();
		settings?.Window.HideWindow();
		CorePresenter?.DismissNotchAgentPeek();
	}
}
