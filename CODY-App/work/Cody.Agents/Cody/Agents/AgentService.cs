using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents.Backend;
using HeyClicky.Agents.Clickys;
using HeyClicky.Agents.Harness;
using HeyClicky.Agents.Jobs;
using HeyClicky.Agents.Routines;
using HeyClicky.Agents.Runtime;
using HeyClicky.Agents.Turns;

namespace HeyClicky.Agents;

public sealed class AgentService : IAgentService, IAsyncDisposable
{
	private sealed record TurnSpec(string Prompt, IReadOnlyList<byte[]>? Images, IReadOnlyList<string>? AttachedFiles, string LaunchContext, string LaunchSource, string UsageContext, bool IsGeneratedBrief, IReadOnlyList<(string User, string Assistant)>? PriorTurns, AgentTurnLease? PreauthorizedLease, bool AutoApproveExtraUsage, string? UserMemory);

	private sealed class RoutineHost(AgentService owner) : IRoutineHost
	{
		public bool IsSignedIn => owner.tokens.ExpiresAt.HasValue;

		public bool ClickyExists(string slug)
		{
			ClickyInfo clickyInfo = owner.clickys.Get(slug);
			if ((object)clickyInfo != null)
			{
				return !clickyInfo.IsArchived;
			}
			return false;
		}

		public bool IsClickyBusy(string slug)
		{
			return owner.tasks.Values.Any((AgentTask t) => t.ClickySlug == slug && Lock(t, () => t.IsActive));
		}

		public bool IsClickyAwaitingExtraUsage(string slug)
		{
			return owner.tasks.Values.Any((AgentTask t) => t.ClickySlug == slug && Lock(t, () => t.RequiresExtraUsageApproval));
		}

		public bool JobExists(string jobId)
		{
			return (object)owner.Jobs.Job(jobId) != null;
		}

		public bool IsJobBusy(string jobId)
		{
			ClickyJob clickyJob = owner.Jobs.Job(jobId);
			if ((object)clickyJob == null)
			{
				return false;
			}
			AgentTask task = owner.LiveTask(clickyJob);
			if (task != null && Lock(task, () => task.IsActive))
			{
				return true;
			}
			return clickyJob.AllThreadIds.Any(owner.session.IsThreadActive);
		}

		public bool IsJobAwaitingExtraUsage(string jobId)
		{
			ClickyJob clickyJob = owner.Jobs.Job(jobId);
			if ((object)clickyJob != null)
			{
				AgentTask task = owner.LiveTask(clickyJob);
				if (task != null)
				{
					return Lock(task, () => task.RequiresExtraUsageApproval);
				}
			}
			return false;
		}

		public async Task<string?> LaunchJobRoutineRunAsync(ClickyRoutine routine, int runNumber, string prompt, bool scheduled)
		{
			ClickyJob job = owner.Jobs.Job(routine.JobId);
			if ((object)job == null)
			{
				return null;
			}
			string threadId = job.ThreadId;
			string continuedThreadId = ((threadId != null && AgentHarnessRuntimes.ContinuesOnNewConversationHarness(threadId)) ? threadId : null);
			string text = $"This turn is run #{runNumber} of the routine \"{routine.Title}\" ({routine.CadenceLabel.ToLowerInvariant()}) that the user set up on this job, so HeyClicky is launching it automatically with the user's standing instructions.";
			if (continuedThreadId == null)
			{
				owner.RetireClickysNoteForMovedRoutineJob(job);
				bool hasPreviousNote = File.Exists(Path.Combine(job.FolderPath, ClickyWorkFolderFiles.PreviousNoteRelativePath));
				text = text + "\n" + owner.JobContinuationContext(job, hasPreviousNote);
			}
			else if (runNumber > 1)
			{
				text += " Earlier runs are in this conversation above; build on them and report what is new rather than repeating them.";
			}
			AgentTask existing = owner.tasks.Values.FirstOrDefault((AgentTask x) => Lock(x, () => x.JobId) == job.Id);
			if (existing != null)
			{
				lock (existing.Gate)
				{
					existing.IsRoutineRun = true;
				}
				await owner.StartFollowUpTurnAsync(existing, prompt, null, "routine", "companion", null, CancellationToken.None, text, continuedThreadId, continuedThreadId == null).ConfigureAwait(continueOnCapturedContext: false);
				owner.Jobs.BeginRun(job.Id, routine.Title, continuedThreadId);
				return existing.Id;
			}
			string text2 = await owner.LaunchAsync(new AgentLaunchRequest
			{
				Prompt = prompt,
				JobId = job.Id,
				TargetThreadId = continuedThreadId,
				StartsNewJobConversation = (continuedThreadId == null),
				LaunchSource = "routine",
				IsGeneratedTaskBrief = true,
				LaunchContext = text
			}).ConfigureAwait(continueOnCapturedContext: false);
			owner.Jobs.BeginRun(job.Id, routine.Title, continuedThreadId);
			if (owner.tasks.TryGetValue(text2, out AgentTask value))
			{
				lock (value.Gate)
				{
					value.IsRoutineRun = true;
				}
			}
			return text2;
		}

		public async Task<string?> LaunchRoutineRunAsync(ClickyRoutine routine, int runNumber, string prompt, string launchContext)
		{
			ClickyInfo clicky = owner.clickys.Get(routine.ClickySlug);
			if ((object)clicky == null)
			{
				return null;
			}
			AgentTask existing = owner.tasks.Values.FirstOrDefault((AgentTask t) => t.ClickySlug == clicky.Slug);
			string contextOverride = launchContext + TurnPromptBuilder.ClickyLaunchContext(clicky, foundedForThisTask: false);
			if (existing != null)
			{
				lock (existing.Gate)
				{
					existing.IsRoutineRun = true;
				}
				await owner.StartFollowUpTurnAsync(existing, prompt, null, "routine", "companion", null, CancellationToken.None, contextOverride).ConfigureAwait(continueOnCapturedContext: false);
				return existing.Id;
			}
			string text = await owner.LaunchAsync(new AgentLaunchRequest
			{
				Prompt = prompt,
				ClickySlug = clicky.Slug,
				LaunchSource = "routine",
				IsGeneratedTaskBrief = true,
				LaunchContext = launchContext
			}).ConfigureAwait(continueOnCapturedContext: false);
			if (owner.tasks.TryGetValue(text, out AgentTask value))
			{
				lock (value.Gate)
				{
					value.IsRoutineRun = true;
				}
			}
			return text;
		}

		public string? CreateJobForMovedRoutine(ClickyRoutine routine)
		{
			ClickyInfo clickyInfo = owner.clickys.Get(routine.ClickySlug);
			if ((object)clickyInfo == null)
			{
				return null;
			}
			string folderPath = owner.clickys.EnsureWorkspace(clickyInfo);
			return owner.Jobs.CreateJobForMovedRoutine(routine.Title, routine.TaskPrompt, folderPath, clickyInfo.ThreadId, routine.LastRunFinishedAt ?? routine.LastRunStartedAt).Id;
		}

		public void RetireClickysNoteForMovedRoutineJob(string jobId, bool onlyWhenLeft)
		{
			ClickyJob clickyJob = owner.Jobs.Job(jobId);
			if ((object)clickyJob != null && (!onlyWhenLeft || File.Exists(LiveNotePathForJob(clickyJob))))
			{
				owner.RetireClickysNoteForMovedRoutineJob(clickyJob);
			}
		}
	}

	public const string BrowserMcpServerKey = "clicky_browser";

	private readonly ConcurrentDictionary<string, DateTimeOffset> clickyAppFinishedAt = new ConcurrentDictionary<string, DateTimeOffset>();

	private static readonly Regex RoutineHeader = new Regex("^\\[Routine \"(.+?)\"(?: —)? run #(\\d+), ([^,\\]]+)");

	private const string LegacyClickyMigrationKey = "clicky.clickyApps.legacyClickysAsJobs.v1";

	private readonly ConcurrentDictionary<string, string> computerUseSummaries = new ConcurrentDictionary<string, string>();

	private readonly ConcurrentDictionary<string, bool> computerUseAnnounced = new ConcurrentDictionary<string, bool>();

	private readonly ConcurrentDictionary<string, AgentTurnLease> reopenedLeases = new ConcurrentDictionary<string, AgentTurnLease>();

	private const string LeaseMarkerStart = "<clicky_agent_turn_lease_metadata>";

	private static readonly TimeSpan EarlyStopRefundWindow = TimeSpan.FromSeconds(10L);

	private static readonly TimeSpan ComposioRefreshAfter = TimeSpan.FromMinutes(10L);

	private readonly ClickyEndpoints endpoints;

	private readonly Func<CancellationToken, Task<string?>> supabaseAccessToken;

	private readonly ClientIdentity identity;

	private readonly AgentRuntimeOptions options;

	private readonly AgentWorkerApi api;

	private readonly AgentSessionTokenProvider tokens;

	private readonly CodexHomeManager home;

	private readonly ClickyStore clickys;

	private readonly UserMemoryCache userMemory;

	private readonly CodexSession session = new CodexSession();

	private readonly RoutineScheduler routines;

	private readonly SemaphoreSlim runtimeGate = new SemaphoreSlim(1, 1);

	private readonly SemaphoreSlim slots;

	private readonly ConcurrentDictionary<string, AgentTask> tasks = new ConcurrentDictionary<string, AgentTask>();

	private readonly CancellationTokenSource lifetime = new CancellationTokenSource();

	private readonly Timer maintenanceTimer;

	private ComposioMcpConfiguration? composio;

	private bool composioUnreachable;

	private DateTimeOffset composioFetchedAt;

	private IReadOnlyList<CustomConnectorRegistration> customConnectors = Array.Empty<CustomConnectorRegistration>();

	private bool configDirty = true;

	private AgentHarnessMcpServer? codexBrowserMcp;

	private int tasksChangedPending;

	private bool disposed;

	private long spawnToInitializedMs = -1L;

	private long runtimeReadyMs = -1L;

	private long launchToTurnStartedMs = -1L;

	private long launchToFirstTokenMs = -1L;

	private long launchToFinishedMs = -1L;

	private int composioGeneration;

	private const int MaxPersonaNameBackfillPerLaunch = 15;

	private int personaNameBackfillStarted;

	public const string PaywallSummary = "Oops, you're out of tokens! Beef up HeyClicky to continue.";

	private volatile bool runtimeParkedIdle;

	private readonly object dataSourcesGate = new object();

	private Dictionary<string, List<string>>? dataSources;

	private bool obsidianChanged;

	private ClickyJobStepWatcher? stepWatcher;

	public static readonly TimeSpan JobResumeWindow = TimeSpan.FromHours(24);

	public const string FollowUpLanguageLine = "Answer in the language of this newest message.";

	public const string ResumedRunContext = "This is a new message to this job, in the conversation where you did the earlier work: build on it, and change what they ask now. Answer in the language of this newest message.";

	private readonly ConcurrentDictionary<string, ClickyAnswer> resultCards = new ConcurrentDictionary<string, ClickyAnswer>();

	public const int ReportReplyLimit = 6000;

	public ClickyAppStore ClickyApps { get; private set; }

	public Func<string, string?>? TakeUnansweredComputerUseStep { get; set; }

	public IReadOnlyList<AgentTaskSnapshot> Tasks => (from s in tasks.Values.Select((AgentTask t) =>
		{
			lock (t.Gate)
			{
				return t.Snapshot();
			}
		})
		orderby s.StartedAt descending
		select s).ToList();

	public bool IsRuntimeReady
	{
		get
		{
			if (session.IsConnected)
			{
				return session.Process?.IsRunning ?? false;
			}
			return false;
		}
	}

	public string DefaultModel => options.Model;

	public string DefaultReasoningEffort => options.ReasoningEffort;

	public Func<string?>? CurrentUserId { get; set; }

	public bool AutoApproveExtraUsage
	{
		get
		{
			return options.AutoApproveExtraUsage;
		}
		set
		{
			options.AutoApproveExtraUsage = value;
		}
	}

	public bool AllowsDeveloperModelSelection => tokens.AllowsDeveloperModelSelection;

	public Func<string, (string Model, string Effort)?>? DeveloperModelSelection { get; set; }

	public static string DefaultProjectsRoot => new AgentRuntimeOptions().ProjectsRoot;

	public IReadOnlyList<ClickyInfo> Clickys => clickys.Clickys;

	public RoutineScheduler Routines => routines;

	public RoutinesTool RoutinesTool { get; }

	public string ProjectsRoot => options.ProjectsRoot;

	public string CodexHome => options.CodexHome;

	public AgentRuntimeTimings Timings => new AgentRuntimeTimings(spawnToInitializedMs, runtimeReadyMs, launchToTurnStartedMs, launchToFirstTokenMs, launchToFinishedMs);

	public Func<CancellationToken, Task<AgentHarnessMcpServer?>>? BrowserMcpServerProvider { get; set; }

	public Func<bool>? IsClickyDriveAvailable { get; set; }

	public IClickyLiveNoteTurns? LiveNotes { get; set; }

	public Func<Uri, string, string?>? CodexStoredConnectorToken { get; set; }

	private string WorkerBase => endpoints.WorkerBaseUrl.AbsoluteUri.TrimEnd('/');

	public IReadOnlyList<ClickyInfo> ArchivedClickys => clickys.ArchivedClickys;

	public Func<bool>? CustomConnectorTokensExpiring { get; set; }

	public Func<CancellationToken, Task<IReadOnlyList<CustomConnectorRegistration>?>>? RefreshCustomConnectorTokensAsync { get; set; }

	private string DataSourcesPath => Path.Combine(options.StateDirectory, "data-sources.json");

	public ClickyJobStore Jobs { get; }

	public ClickyLearnedHowTos LearnedHowTos { get; }

	public ClickyRestartInterruptions RestartInterruptions { get; }

	public ClickyLiveSteps LiveSteps { get; } = new ClickyLiveSteps();

	public ClickyJobStepWatcher StepWatcher => stepWatcher ?? (stepWatcher = CreateStepWatcher());

	public Func<string, IReadOnlyList<AgentTranscriptTurn>?>? CachedTranscript { get; set; }

	public event Action<string, string>? BrowserTurnEnded;

	public event Action? BrowserAccessShouldStop;

	public event Action<string>? TaskNeedsChromeConnection;

	public event EventHandler? TasksChanged;

	public event EventHandler<AgentTaskEvent>? TaskEvent;

	public event EventHandler? RoutinesChanged;

	public event EventHandler<AgentPaywallEventArgs>? PaywallReached;

	public event Action<bool>? AutoApproveExtraUsageChanged;

	public event EventHandler? ThreadHistoryChanged;

	public event Action<string>? ClickyFounded;

	public event Action<string, string, string, double, IReadOnlyDictionary<string, double>>? HarnessTurnEnded;

	public event Action<string, string, string, string>? InternalError;

	public event Action<string, bool, string?>? McpOAuthLoginCompleted;

	public event Action<string, string, string?>? McpServerStartupStatus;

	public event Action<string, string>? DataSourceRecorded;

	public event Action<string, string, string, string>? TaskFilePatchStreaming;

	public event Action<string, IReadOnlyList<string>>? TaskFileChangeCompleted;

	public event Action<string, string?, IReadOnlyDictionary<string, object?>>? JobAction;

	public event Action<string>? ResultCardShown;

	public AgentBrowserTurn? BrowserTurn(string threadId, string turnId)
	{
		AgentTask task = ActiveTask(threadId);
		if (task == null)
		{
			return null;
		}
		lock (task.Gate)
		{
			if (task.TurnId != turnId || !task.IsActive)
			{
				return null;
			}
			string title = task.Title;
			string latestCommentary = (string.IsNullOrWhiteSpace(task.LatestCommentary) ? null : task.LatestCommentary);
			return new AgentBrowserTurn(task.Title, title, latestCommentary, task.ThinkingHeading, () =>
			{
				lock (task.Gate)
				{
					return task.TurnId == turnId && task.IsActive && ActiveTask(threadId) == task;
				}
			});
		}
	}

	private AgentTask? ActiveTask(string threadId)
	{
		return tasks.Values.FirstOrDefault((AgentTask t) => Lock(t, () => t.ThreadId == threadId && t.IsActive));
	}

	public void MarkNeedsChromeConnection(string threadId)
	{
		AgentTask agentTask = ActiveTask(threadId);
		if (agentTask == null)
		{
			return;
		}
		lock (agentTask.Gate)
		{
			if (agentTask.NeedsChromeConnection)
			{
				return;
			}
			agentTask.NeedsChromeConnection = true;
		}
		TaskNeedsChromeConnection?.Invoke(threadId);
		RaiseTasksChanged();
	}

	public string? TaskIdForThread(string threadId)
	{
		return (from t in tasks.Values
			where Lock(t, () => t.ThreadId == threadId)
			orderby t.StartedAt descending
			select t).FirstOrDefault()?.Id;
	}

	public bool IsThreadRunning(string threadId)
	{
		return ActiveTask(threadId) != null;
	}

	public IReadOnlyList<string> ThreadsNeedingChrome()
	{
		return (from t in tasks.Values
			where Lock(t, () => t.NeedsChromeConnection && t.ThreadId != null)
			orderby t.StartedAt
			select Lock(t, () => t.ThreadId)).ToList();
	}

	public void ClearNeedsChromeConnection(string threadId)
	{
		foreach (AgentTask value in tasks.Values)
		{
			lock (value.Gate)
			{
				if (value.ThreadId == threadId)
				{
					value.NeedsChromeConnection = false;
				}
			}
		}
		RaiseTasksChanged();
	}

	public bool NeedsChromeConnection(string threadId)
	{
		return tasks.Values.Any((AgentTask t) => Lock(t, () => t.ThreadId == threadId && t.NeedsChromeConnection));
	}

	public bool IsTaskWaitingOnUserAnswer(string taskId)
	{
		if (!tasks.TryGetValue(taskId, out AgentTask task))
		{
			return false;
		}
		return Lock(task, () => task.PendingComputerUseRequest != null || task.RequiresExtraUsageApproval || task.NeedsChromeConnection);
	}

	private void NotifyBrowserTurnEnded(AgentTask task, TurnOutcome outcome)
	{
		if (outcome == TurnOutcome.Disconnected)
		{
			BrowserAccessShouldStop?.Invoke();
			return;
		}
		string threadId;
		string turnId;
		lock (task.Gate)
		{
			threadId = task.ThreadId;
			turnId = task.TurnId;
		}
		if (threadId != null && turnId != null)
		{
			BrowserTurnEnded?.Invoke(threadId, turnId);
		}
	}

	private void CreateClickyApps()
	{
		ClickyApps = new ClickyAppStore(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(options.StateDirectory.TrimEnd(new char[2] { '\\', '/' }))) ?? options.StateDirectory, "ClickyApps"));
	}

	private AgentTask? ClickyAppLiveTask(string slug)
	{
		List<AgentTask> source = (from t in tasks.Values
			where !t.IsDemo
			orderby t.StartedAt descending
			select t).ToList();
		string boundThreadId = clickys.Get(slug)?.ThreadId;
		if (boundThreadId != null)
		{
			AgentTask agentTask = source.FirstOrDefault((AgentTask t) => t.ThreadId == boundThreadId);
			if (agentTask != null)
			{
				return agentTask;
			}
		}
		return source.FirstOrDefault((AgentTask t) => t.ClickySlug == slug);
	}

	public string? ClickyAppLiveThreadId(string slug)
	{
		AgentTask task = ClickyAppLiveTask(slug);
		object obj = ((task != null) ? Lock(task, () => task.ThreadId) : null);
		if (obj == null)
		{
			ClickyInfo? clickyInfo = clickys.Get(slug);
			if ((object)clickyInfo == null)
			{
				return null;
			}
			obj = clickyInfo.ThreadId;
		}
		return (string?)obj;
	}

	public ClickyAppLiveStatus LiveStatusForClicky(string slug)
	{
		AgentTask agentTask = ClickyAppLiveTask(slug);
		if (agentTask == null)
		{
			return ClickyAppLiveStatus.Idle;
		}
		lock (agentTask.Gate)
		{
			if (agentTask.PendingComputerUseRequest != null)
			{
				return new ClickyAppLiveStatus(ClickyAppLiveStatus.Phases.NeedsYou, "I need a yes to use your PC", Array.Empty<string>(), agentTask.StartedAt, null);
			}
			if (agentTask.RequiresExtraUsageApproval || agentTask.Status == AgentTaskStatus.WaitingForUser)
			{
				return new ClickyAppLiveStatus(ClickyAppLiveStatus.Phases.NeedsYou, "I need your OK to keep going", Array.Empty<string>(), agentTask.StartedAt, null);
			}
			switch (agentTask.Status)
			{
			case AgentTaskStatus.Starting:
			case AgentTaskStatus.Running:
			{
				List<string> source = (from a in agentTask.Activity
					where a.Kind == AgentActivityKind.Commentary
					select ClickyWorkReplyParts.FirstSentence(a.Text, 140) into l
					where l.Length > 0
					select l).ToList();
				string text4 = agentTask.ThinkingHeading?.Trim();
				string line3 = source.LastOrDefault() ?? (string.IsNullOrEmpty(text4) ? "Working on it" : text4);
				return new ClickyAppLiveStatus(ClickyAppLiveStatus.Phases.Working, line3, source.TakeLast(5).ToList(), agentTask.StartedAt, null);
			}
			case AgentTaskStatus.Finished:
			{
				string text = agentTask.Summary?.Trim();
				string text3;
				if (text == null || text.Length <= 0)
				{
					string text2 = agentTask.DoneTitle?.Trim();
					text3 = ((text2 != null && text2.Length > 0) ? text2 : "Done");
				}
				else
				{
					text3 = text;
				}
				string line2 = text3;
				return new ClickyAppLiveStatus(ClickyAppLiveStatus.Phases.Finished, line2, Array.Empty<string>(), agentTask.StartedAt, clickyAppFinishedAt.GetValueOrDefault(agentTask.Id));
			}
			default:
			{
				string line = ((agentTask.Status == AgentTaskStatus.Stopped) ? "Stopped before I finished" : "Something went wrong");
				return new ClickyAppLiveStatus(ClickyAppLiveStatus.Phases.Failed, line, Array.Empty<string>(), agentTask.StartedAt, clickyAppFinishedAt.GetValueOrDefault(agentTask.Id));
			}
			}
		}
	}

	private void NoteClickyAppWorkFinished(AgentTask task)
	{
		clickyAppFinishedAt[task.Id] = DateTimeOffset.Now;
		bool isDemo;
		string text;
		lock (task.Gate)
		{
			isDemo = task.IsDemo;
			object obj = task.ClickySlug;
			if (obj == null)
			{
				string thread = task.ThreadId;
				obj = ((thread == null) ? null : clickys.Clickys.FirstOrDefault((ClickyInfo c) => c.ThreadId == thread)?.Slug);
			}
			text = (string)obj;
		}
		if (!(!ClickyAppsPreferences.IsEnabled | isDemo) && text != null)
		{
			ClickyWorkPiece clickyWorkPiece = ClickyAppWorkPiece(task, text);
			if ((object)clickyWorkPiece != null)
			{
				ClickyApps.Merge(new _003C_003Ez__ReadOnlySingleElementList<ClickyWorkPiece>(clickyWorkPiece), text);
			}
		}
	}

	private ClickyWorkPiece? ClickyAppWorkPiece(AgentTask task, string slug)
	{
		lock (task.Gate)
		{
			(string, string, string, IReadOnlyList<string>) tuple = ClickyWorkReplyParts.Parse(task.FinalResponseMarkdown ?? string.Join("\n\n", task.CompletedReplies));
			string item = tuple.Item1;
			IReadOnlyList<string> readOnlyList = ((task.Artifacts.Count == 0) ? tuple.Item4 : task.Artifacts);
			if (item.Length == 0 && readOnlyList.Count == 0)
			{
				return null;
			}
			string text = task.ThreadId ?? ("task-" + task.Id);
			string text2 = $"{task.Id}:{task.UserPrompts.Count}";
			string text3 = task.TurnId ?? text2;
			string text4 = task.UserPrompts.LastOrDefault() ?? "";
			string text5 = task.Summary?.Trim();
			string summary = ((text5 != null && text5.Length > 0) ? text5 : (tuple.Item3 ?? ClickyWorkReplyParts.FirstSentence(item)));
			ClickyWorkPiece clickyWorkPiece = new ClickyWorkPiece
			{
				Id = text + "#" + text3,
				Slug = slug,
				ThreadId = task.ThreadId,
				ClientTurnKey = text2,
				Ask = DisplayAsk(text4)
			};
			string text6 = task.DoneTitle?.Trim();
			clickyWorkPiece.Title = ((text6 != null && text6.Length > 0) ? text6 : (tuple.Item2 ?? ""));
			clickyWorkPiece.Summary = summary;
			clickyWorkPiece.Reply = ((item.Length > 20000) ? item.Substring(0, 20000) : item);
			clickyWorkPiece.ArtifactPaths = readOnlyList.ToList();
			clickyWorkPiece.FinishedAt = clickyAppFinishedAt.GetValueOrDefault(task.Id, DateTimeOffset.Now);
			clickyWorkPiece.IsRoutineRun = task.IsRoutineRun || RoutineHeader.IsMatch(text4.TrimStart());
			return clickyWorkPiece;
		}
	}

	public static IReadOnlyList<ClickyWorkPiece> ClickyAppWorkPieces(IReadOnlyList<AgentTranscriptTurn> turns, string threadId, string slug, Func<string, string>? displayAsk = null)
	{
		List<ClickyWorkPiece> list = new List<ClickyWorkPiece>();
		for (int i = 0; i < turns.Count; i++)
		{
			AgentTranscriptTurn agentTranscriptTurn = turns[i];
			if (!string.Equals(agentTranscriptTurn.Status, "completed", StringComparison.OrdinalIgnoreCase) || agentTranscriptTurn.ErrorMessage != null)
			{
				continue;
			}
			(string, string, string, IReadOnlyList<string>) tuple = ClickyWorkReplyParts.Parse(string.Join("\n\n", agentTranscriptTurn.AssistantMessages));
			IReadOnlyList<string> readOnlyList = ((agentTranscriptTurn.Artifacts.Count == 0) ? tuple.Item4 : agentTranscriptTurn.Artifacts);
			if (tuple.Item1.Length != 0 || readOnlyList.Count != 0)
			{
				string text = agentTranscriptTurn.UserMessages.FirstOrDefault() ?? "";
				string text2 = agentTranscriptTurn.TurnId ?? $"{i}-{(agentTranscriptTurn.StartedAt ?? DateTimeOffset.UnixEpoch).ToUnixTimeSeconds()}";
				ClickyWorkPiece clickyWorkPiece = new ClickyWorkPiece
				{
					Id = threadId + "#" + text2,
					Slug = slug,
					ThreadId = threadId,
					Ask = (displayAsk ?? ((Func<string, string>)((string a) => RoutinePreviewLine(a) ?? a.Trim())))(text),
					Title = (tuple.Item2 ?? ""),
					Summary = (tuple.Item3 ?? ClickyWorkReplyParts.FirstSentence(tuple.Item1))
				};
				string reply;
				if (tuple.Item1.Length <= 20000)
				{
					(reply, _, _, _) = tuple;
				}
				else
				{
					reply = tuple.Item1.Substring(0, 20000);
				}
				clickyWorkPiece.Reply = reply;
				clickyWorkPiece.ArtifactPaths = readOnlyList.ToList();
				clickyWorkPiece.FinishedAt = agentTranscriptTurn.FinishedAt ?? agentTranscriptTurn.StartedAt ?? DateTimeOffset.MinValue;
				clickyWorkPiece.IsRoutineRun = RoutineHeader.IsMatch(text.TrimStart());
				list.Add(clickyWorkPiece);
			}
		}
		return list;
	}

	public async Task GatherClickyAppWorkAsync(string slug, CancellationToken ct = default(CancellationToken))
	{
		ClickyApps.LoadIfNeeded(slug);
		List<ClickyWorkPiece> pieces = new List<ClickyWorkPiece>();
		HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
		string text = clickys.Get(slug)?.ThreadId;
		if (text != null)
		{
			hashSet.Add(text);
		}
		foreach (AgentTask value in tasks.Values)
		{
			if (value.ClickySlug == slug)
			{
				string threadId = value.ThreadId;
				if (threadId != null)
				{
					hashSet.Add(threadId);
				}
			}
		}
		foreach (string threadId2 in hashSet)
		{
			try
			{
				pieces.AddRange(ClickyAppWorkPieces(await ReadThreadAsync(threadId2, ct).ConfigureAwait(continueOnCapturedContext: false), threadId2, slug, DisplayAsk));
			}
			catch (Exception ex) when (!(ex is OperationCanceledException))
			{
				Log.Warn("Agents", "clicky app work for " + slug + ": " + ex.Message);
			}
		}
		AgentTask live = ClickyAppLiveTask(slug);
		if (live != null && Lock(live, () => live.Status == AgentTaskStatus.Finished))
		{
			ClickyWorkPiece clickyWorkPiece = ClickyAppWorkPiece(live, slug);
			if ((object)clickyWorkPiece != null)
			{
				pieces.Add(clickyWorkPiece);
			}
		}
		ClickyApps.Merge(pieces, slug);
	}

	private static string? RoutinePreviewLine(string rawAsk)
	{
		Match match = RoutineHeader.Match(rawAsk.TrimStart());
		if (match == null || !match.Success)
		{
			return null;
		}
		return match.Groups[1].Value + " · run " + match.Groups[2].Value;
	}

	private string DisplayAsk(string rawAsk)
	{
		string text = rawAsk.Trim();
		if (text.StartsWith("<clicky_agent_turn_lease_metadata>", StringComparison.Ordinal))
		{
			int num = text.IndexOf("</clicky_agent_turn_lease_metadata>", StringComparison.Ordinal);
			if (num >= 0)
			{
				string text2 = text;
				int num2 = num + "</clicky_agent_turn_lease_metadata>".Length;
				text = text2.Substring(num2, text2.Length - num2).Trim();
			}
		}
		return RoutinePreviewLine(text) ?? clickys.DisplayFor(text) ?? text;
	}

	public IReadOnlyList<string>? TakeLegacyClickyMigration()
	{
		if (AgentDefaults.Bool("clicky.clickyApps.legacyClickysAsJobs.v1"))
		{
			return null;
		}
		AgentDefaults.Set("clicky.clickyApps.legacyClickysAsJobs.v1", value: true);
		List<string> list = clickys.Clickys.Select((ClickyInfo c) => c.Slug).ToList();
		Log.Info("Agents", $"[migration] old Clickys marked read ({list.Count}), pins cleared");
		return list;
	}

	public string? PendingComputerUseRequest(string taskId)
	{
		if (!tasks.TryGetValue(taskId, out AgentTask task))
		{
			return null;
		}
		return Lock(task, () => task.PendingComputerUseRequest);
	}

	public void SetPendingComputerUseRequest(string taskId, string? request)
	{
		if (tasks.TryGetValue(taskId, out AgentTask value))
		{
			bool flag;
			lock (value.Gate)
			{
				flag = value.PendingComputerUseRequest != request;
				value.PendingComputerUseRequest = request;
			}
			if (request == null)
			{
				computerUseSummaries.TryRemove(taskId, out string _);
			}
			if (flag)
			{
				SyncPendingRequest(value);
				RaiseTasksChanged();
			}
		}
	}

	public string? PendingComputerUseSummary(string taskId)
	{
		return computerUseSummaries.GetValueOrDefault(taskId);
	}

	public void SetPendingComputerUseSummary(string taskId, string? summary)
	{
		if (summary == null)
		{
			computerUseSummaries.TryRemove(taskId, out string _);
		}
		else
		{
			computerUseSummaries[taskId] = summary;
		}
	}

	public bool DidAnnounceComputerUseRequest(string taskId)
	{
		return computerUseAnnounced.GetValueOrDefault(taskId);
	}

	public void SetDidAnnounceComputerUseRequest(string taskId, bool value)
	{
		computerUseAnnounced[taskId] = value;
	}

	public bool IsThreadActive(string threadId)
	{
		return session.IsThreadActive(threadId);
	}

	public string? TurnLeaseId(string taskId)
	{
		if (!tasks.TryGetValue(taskId, out AgentTask task))
		{
			return null;
		}
		return Lock(task, () => task.Lease?.LeaseId);
	}

	public async Task<string?> ContinueLeaseAfterComputerUseConsentAsync(string leaseId, CancellationToken ct = default(CancellationToken))
	{
		double[] array = new double[4] { 0.0, 0.8, 1.6, 3.0 };
		foreach (double num in array)
		{
			if (num > 0.0)
			{
				await Task.Delay(TimeSpan.FromSeconds(num), ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			(bool, AgentTurnLease, string)? tuple;
			try
			{
				string value = await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false);
				if (string.IsNullOrEmpty(value))
				{
					Log.Info("Agents", "[lease/computer-use-consent] no access token");
					continue;
				}
				tuple = await api.ContinueAfterComputerUseConsentAsync(value, leaseId, ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex) when (!(ex is OperationCanceledException))
			{
				Log.Info("Agents", "[lease/computer-use-consent] lease=" + leaseId.Substring(0, Math.Min(8, leaseId.Length)) + " uncertain: " + ex.Message);
				continue;
			}
			if (tuple.HasValue)
			{
				(bool, AgentTurnLease, string) valueOrDefault = tuple.GetValueOrDefault();
				if (valueOrDefault.Item1)
				{
					AgentTurnLease item = valueOrDefault.Item2;
					if ((object)item != null)
					{
						reopenedLeases[item.LeaseId] = item;
						return item.LeaseId;
					}
				}
			}
			if (tuple.HasValue)
			{
				(bool, AgentTurnLease, string) valueOrDefault2 = tuple.GetValueOrDefault();
				if (!valueOrDefault2.Item1 && valueOrDefault2.Item3 != "no_computer_use_request")
				{
					return null;
				}
			}
			Log.Info("Agents", "[lease/computer-use-consent] lease=" + leaseId.Substring(0, Math.Min(8, leaseId.Length)) + " not reopened yet");
		}
		Log.Info("Agents", "[lease/computer-use-consent] lease=" + leaseId.Substring(0, Math.Min(8, leaseId.Length)) + " gave up; sending the answer as a new turn");
		return null;
	}

	public void CompleteLease(string leaseId, string? threadId, string status = "completed")
	{
		Task.Run(async () =>
		{
			_ = 1;
			try
			{
				string text = await supabaseAccessToken(CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
				if (text != null)
				{
					await api.CompleteLeaseAsync(text, leaseId, status, threadId, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
				}
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "lease " + leaseId.Substring(0, Math.Min(8, leaseId.Length)) + " complete failed: " + ex.Message);
			}
		});
	}

	public async Task SubmitThreadFollowUpAsync(string threadId, string text, string? preauthorizedLeaseId, CancellationToken ct = default(CancellationToken))
	{
		AgentTask task = (from t in tasks.Values
			where Lock(t, () => t.ThreadId) == threadId
			orderby t.StartedAt descending
			select t).FirstOrDefault();
		if (task == null)
		{
			Log.Warn("Agents", "follow-up for " + threadId + ": no task on that thread");
			return;
		}
		AgentTurnLease preauthorizedLease = ((preauthorizedLeaseId != null && reopenedLeases.TryRemove(preauthorizedLeaseId, out AgentTurnLease value)) ? value : null);
		if (Lock(task, () => task.IsActive) || session.IsThreadActive(threadId))
		{
			await SteerAsync(task.Id, text, ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		else
		{
			await StartFollowUpTurnAsync(task, text, null, "text", "companion", preauthorizedLease, ct).ConfigureAwait(continueOnCapturedContext: false);
		}
	}

	public bool CanRetryAfterFailure(string taskId)
	{
		if (tasks.TryGetValue(taskId, out AgentTask task))
		{
			return Lock(task, () => task.Status == AgentTaskStatus.Failed && (task.ThreadId != null || (task.UserPrompts.LastOrDefault()?.Trim().Length ?? 0) > 0));
		}
		return false;
	}

	public bool CanRetryAfterInterruption(string taskId)
	{
		if (tasks.TryGetValue(taskId, out AgentTask task))
		{
			return Lock(task, () => task.Status == AgentTaskStatus.Stopped && !task.RequiresExtraUsageApproval && (task.ThreadId != null || (task.UserPrompts.LastOrDefault()?.Trim().Length ?? 0) > 0));
		}
		return false;
	}

	public bool RetryFailedTask(string taskId)
	{
		if (!CanRetryAfterFailure(taskId) && !CanRetryAfterInterruption(taskId))
		{
			return false;
		}
		AgentTask task = GetTask(taskId);
		string text = Lock(task, () => task.UserPrompts.LastOrDefault()?.Trim() ?? "");
		string retry = ((text.Length == 0) ? "Retry the task you were working on and finish it." : text);
		Task.Run(async () =>
		{
			try
			{
				await StartFollowUpTurnAsync(task, retry, null, "retry", "companion", null, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "retry " + taskId + ": " + ex.Message);
			}
		});
		return true;
	}

	public AgentService(ClickyEndpoints endpoints, Func<CancellationToken, Task<string?>> supabaseAccessToken, HttpClient http, ClientIdentity identity, AgentRuntimeOptions? options = null)
	{
		this.endpoints = endpoints;
		this.supabaseAccessToken = supabaseAccessToken;
		this.identity = identity;
		this.options = options ?? new AgentRuntimeOptions();
		AgentDefaults.Configure(this.options.StateDirectory);
		Jobs = new ClickyJobStore();
		LearnedHowTos = new ClickyLearnedHowTos();
		RestartInterruptions = new ClickyRestartInterruptions();
		TasksChanged += (object? _, EventArgs _) =>
		{
			NoteRunningTurnsForRestart();
		};
		CreateClickyApps();
		api = new AgentWorkerApi(EnsureTrailingSlash(endpoints.WorkerBaseUrl), http);
		tokens = new AgentSessionTokenProvider(api, supabaseAccessToken, this.options.SessionTokenRefreshMargin);
		home = new CodexHomeManager(this.options);
		clickys = new ClickyStore(this.options.StateDirectory, this.options.ProjectsRoot);
		userMemory = new UserMemoryCache(this.options.StateDirectory);
		slots = new SemaphoreSlim(Math.Max(1, this.options.MaxConcurrentTasks));
		routines = new RoutineScheduler(this.options.StateDirectory, new RoutineHost(this));
		routines.Changed += (object? _, EventArgs _) =>
		{
			RoutinesChanged?.Invoke(this, EventArgs.Empty);
		};
		RoutinesTool = new RoutinesTool(routines, Jobs, (string threadId) => clickys.ForThread(threadId)?.Slug, (string slug) => clickys.Get(slug)?.Name, () => ProjectsRoot);
		session.OnTaskEvent = (AgentTask task, AgentTaskEventKind kind, string? text) =>
		{
			Raise(task, kind, text);
		};
		session.OnTurnEnded = OnTurnEnded;
		session.OnDisconnected = () =>
		{
			Log.Warn("Agents", "app-server disconnected; it will restart on the next launch");
		};
		WireLiveSteps();
		WireIntegrationEvents();
		ConfigureAgentHarness();
		Jobs.JobIdsWithRoutines = routines.JobIdsWithRoutines;
		maintenanceTimer = new Timer((object? _) =>
		{
			_ = MaintainAsync();
		}, null, TimeSpan.FromMinutes(5L), TimeSpan.FromMinutes(5L));
	}

	public AgentService(ClickyEndpoints endpoints, Func<CancellationToken, Task<string?>> supabaseAccessToken, Func<HttpClient> httpFactory, ClientIdentity identity, AgentRuntimeOptions? options = null)
		: this(endpoints, supabaseAccessToken, httpFactory(), identity, options)
	{
	}

	private static Uri EnsureTrailingSlash(Uri u)
	{
		if (!u.AbsoluteUri.EndsWith('/'))
		{
			return new Uri(u.AbsoluteUri + "/");
		}
		return u;
	}

	public async Task EnsureRuntimeReadyAsync(CancellationToken ct = default(CancellationToken))
	{
		int num;
		if (IsRuntimeReady && !tokens.NeedsRefresh && !configDirty && DateTimeOffset.Now - composioFetchedAt < ComposioRefreshAfter)
		{
			Func<bool>? customConnectorTokensExpiring = CustomConnectorTokensExpiring;
			num = ((customConnectorTokensExpiring == null || !customConnectorTokensExpiring()) ? 1 : 0);
		}
		else
		{
			num = 0;
		}
		bool flag = (byte)num != 0;
		if (flag)
		{
			string valueOrDefault = session.Process.SpawnEnvironment.GetValueOrDefault("OPENAI_API_KEY");
			flag = valueOrDefault == await tokens.GetAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		if (flag)
		{
			return;
		}
		await runtimeGate.WaitAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		try
		{
			runtimeParkedIdle = false;
			await PrepareRuntimeLockedAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		finally
		{
			runtimeGate.Release();
		}
	}

	public Task<string> LaunchAsync(string prompt, IReadOnlyList<byte[]>? imagesJpeg = null, CancellationToken ct = default(CancellationToken))
	{
		return LaunchAsync(new AgentLaunchRequest
		{
			Prompt = prompt,
			ImagesJpeg = imagesJpeg
		}, ct);
	}

	public async Task SteerAsync(string taskId, string text, CancellationToken ct = default(CancellationToken))
	{
		AgentTask task = GetTask(taskId);
		string threadId;
		AgentTaskStatus status;
		lock (task.Gate)
		{
			threadId = task.ThreadId;
			status = task.Status;
		}
		if (status == AgentTaskStatus.Starting)
		{
			Stopwatch sw = Stopwatch.StartNew();
			while (sw.Elapsed < TimeSpan.FromSeconds(60L))
			{
				lock (task.Gate)
				{
					threadId = task.ThreadId;
					status = task.Status;
				}
				if (status != AgentTaskStatus.Starting || (threadId != null && session.IsThreadActive(threadId)))
				{
					break;
				}
				await Task.Delay(200, ct).ConfigureAwait(continueOnCapturedContext: false);
			}
		}
		if (threadId != null && session.IsHarnessTurnRunning(threadId))
		{
			lock (task.Gate)
			{
				task.UserPrompts.Add(text);
			}
			bool flag;
			try
			{
				flag = await session.SteerHarnessTurnAsync(threadId, text, ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception)
			{
				lock (task.Gate)
				{
					task.UserPrompts.RemoveAt(task.UserPrompts.Count - 1);
				}
				throw;
			}
			if (flag)
			{
				lock (task.Gate)
				{
					task.ProgressSummary = "Steering the agent…";
				}
				Raise(task, AgentTaskEventKind.ProgressChanged, "Steering the agent…");
				Raise(task, AgentTaskEventKind.SteerAccepted, text);
				LogAgentMessage(task, threadId, "user", text, isFollowUp: true);
				Log.Info("Agents", "steered harness task " + taskId);
				return;
			}
			lock (task.Gate)
			{
				task.UserPrompts.RemoveAt(task.UserPrompts.Count - 1);
			}
		}
		if (threadId != null && session.IsThreadActive(threadId))
		{
			AgentTurnLease lease;
			lock (task.Gate)
			{
				lease = task.Lease;
				task.UserPrompts.Add(text);
			}
			JsonArray input = new JsonArray
			{
				new JsonObject
				{
					["type"] = "text",
					["text"] = WithLeaseMarker(text, lease, task, threadId)
				}
			};
			if (await session.SteerAsync(threadId, input, LeaseMetadata(lease, task, threadId), ct).ConfigureAwait(continueOnCapturedContext: false))
			{
				lock (task.Gate)
				{
					task.ProgressSummary = "Steering the agent…";
				}
				Raise(task, AgentTaskEventKind.ProgressChanged, "Steering the agent…");
				Raise(task, AgentTaskEventKind.SteerAccepted, text);
				LogAgentMessage(task, threadId, "user", text, isFollowUp: true);
				Log.Info("Agents", "steered task " + taskId);
				return;
			}
			lock (task.Gate)
			{
				task.UserPrompts.RemoveAt(task.UserPrompts.Count - 1);
			}
		}
		await StartFollowUpTurnAsync(task, text, null, "text", "companion", null, ct).ConfigureAwait(continueOnCapturedContext: false);
	}

	public async Task StopAsync(string taskId)
	{
		AgentTask task = GetTask(taskId);
		AgentTurnLease lease;
		DateTimeOffset? leaseRecordedAt;
		lock (task.Gate)
		{
			lease = task.Lease;
			leaseRecordedAt = task.LeaseRecordedAt;
		}
		bool interrupted=session.Interrupt(task, TurnOutcome.Interrupted, "Stopped.");
		CancellationTokenSource turnCts;
		lock (task.Gate)
		{
			turnCts = task.TurnCts;
		}
		turnCts?.Cancel();
		bool flag2 = false;
		lock (task.Gate)
		{
			if (task.IsActive || task.Status == AgentTaskStatus.WaitingForUser)
			{
				task.Status = AgentTaskStatus.Stopped;
				task.ProgressSummary = "Stopped.";
				task.RequiresExtraUsageApproval = false;
				flag2 = true;
			}
		}
		if (flag2&&!interrupted)
		{
			Raise(task, AgentTaskEventKind.Stopped, "Stopped.");
			CompleteLeaseInBackground(task, "interrupted");
			RaiseTasksChanged();
		}
		if ((object)lease != null && leaseRecordedAt.HasValue)
		{
			DateTimeOffset valueOrDefault = leaseRecordedAt.GetValueOrDefault();
			if (DateTimeOffset.Now - valueOrDefault <= EarlyStopRefundWindow)
			{
				try
				{
					string text = await supabaseAccessToken(lifetime.Token).ConfigureAwait(continueOnCapturedContext: false);
					bool flag = text != null;
					if (flag)
					{
						flag = await api.RefundEarlyStopAsync(text, lease.LeaseId, lifetime.Token).ConfigureAwait(continueOnCapturedContext: false);
					}
					if (flag)
					{
						lock (task.Gate)
						{
							task.DidRefundEarlyStop = true;
						}
						Raise(task, AgentTaskEventKind.EarlyStopRefunded, "Stopped. This didn't count toward your agent messages because you stopped it before it really got to work.");
					}
				}
				catch (Exception ex)
				{
					Log.Warn("Agents", "early-stop refund failed: " + ex.Message);
				}
			}
		}
	}

	public Task<string> LaunchAsync(AgentLaunchRequest request, CancellationToken ct = default(CancellationToken))
	{
		ObjectDisposedException.ThrowIf(disposed, this);
		string clickySlug = request.ClickySlug;
		ClickyInfo clicky = ((clickySlug != null) ? clickys.Get(clickySlug) : null);
		if (request.ClickySlug != null && (object)clicky == null)
		{
			throw new ArgumentException("Unknown Clicky '" + request.ClickySlug + "'.");
		}
		if ((object)clicky == null && request.JobId == null)
		{
			string targetThreadId = request.TargetThreadId;
			if (targetThreadId != null)
			{
				ClickyInfo clickyInfo = clickys.ForThread(targetThreadId);
				clicky = (((object)clickyInfo != null && !clickyInfo.IsArchived) ? clickyInfo : null);
			}
		}
		object obj;
		if ((object)clicky == null)
		{
			string jobId = request.JobId;
			if (jobId == null)
			{
				string targetThreadId2 = request.TargetThreadId;
				obj = ((targetThreadId2 != null) ? Jobs.JobForThread(targetThreadId2) : null);
			}
			else
			{
				obj = Jobs.Job(jobId) ?? throw new ArgumentException("Unknown job '" + jobId + "'.");
			}
		}
		else
		{
			obj = null;
		}
		ClickyJob job = (ClickyJob)obj;
		if ((object)job != null)
		{
			AgentTask existingJobTask = tasks.Values.FirstOrDefault((AgentTask t) => Lock(t, () => t.JobId) == job.Id);
			if (existingJobTask != null)
			{
				lock (existingJobTask.Gate)
				{
					existingJobTask.ProactiveSuggestionId = request.ProactiveSuggestionId;
					existingJobTask.IsDemo = request.UsageContext == "onboarding";
				}
				Task.Run(async () =>
				{
					_ = 1;
					try
					{
						if (Lock(existingJobTask, () => existingJobTask.IsActive))
						{
							await SteerAsync(existingJobTask.Id, request.Prompt, ct).ConfigureAwait(continueOnCapturedContext: false);
						}
						else
						{
							AgentService agentService = this;
							AgentTask task2 = existingJobTask;
							string prompt = request.Prompt;
							IReadOnlyList<byte[]>? imagesJpeg = request.ImagesJpeg;
							string launchSource2 = request.LaunchSource;
							string usageContext = request.UsageContext;
							CancellationToken ct2 = ct;
							string launchContext = request.LaunchContext;
							await agentService.StartFollowUpTurnAsync(task2, prompt, imagesJpeg, launchSource2, usageContext, null, ct2, (launchContext != null && launchContext.Length > 0) ? launchContext.Trim() : null, request.TargetThreadId, request.StartsNewJobConversation).ConfigureAwait(continueOnCapturedContext: false);
						}
					}
					catch (Exception ex)
					{
						Log.Error("Agents", "follow-up to job " + job.Id + " failed", ex);
					}
				}, CancellationToken.None);
				return Task.FromResult(existingJobTask.Id);
			}
		}
		if ((object)clicky != null)
		{
			AgentTask existing = tasks.Values.FirstOrDefault((AgentTask t) => t.ClickySlug == clicky.Slug);
			if (existing != null)
			{
				lock (existing.Gate)
				{
					existing.ProactiveSuggestionId = request.ProactiveSuggestionId;
					existing.IsDemo = request.UsageContext == "onboarding";
				}
				Task.Run(async () =>
				{
					_ = 1;
					try
					{
						string launchContext = request.LaunchContext;
						if (launchContext == null || launchContext.Length <= 0 || Lock(existing, () => existing.IsActive))
						{
							await SteerAsync(existing.Id, request.Prompt, ct).ConfigureAwait(continueOnCapturedContext: false);
						}
						else
						{
							await StartFollowUpTurnAsync(existing, request.Prompt, request.ImagesJpeg, request.LaunchSource, request.UsageContext, null, ct, TurnPromptBuilder.ClickyLaunchContext(clicky, foundedForThisTask: false, launchContext.Trim() + " ")).ConfigureAwait(continueOnCapturedContext: false);
						}
					}
					catch (Exception ex)
					{
						Log.Error("Agents", "follow-up to " + clicky.Slug + " failed", ex);
					}
				}, CancellationToken.None);
				return Task.FromResult(existing.Id);
			}
		}
		string displayPrompt = request.DisplayPrompt;
		if (displayPrompt != null && displayPrompt.Length > 0)
		{
			clickys.RecordDisplayPrompt(request.Prompt, displayPrompt);
		}
		bool isNewJob = false;
		bool flag = false;
		if ((object)clicky == null && (object)job == null)
		{
			string text = request.Prompt.Trim();
			ClickyJobStore jobs = Jobs;
			string text2 = request.NewClickyName?.Trim();
			job = jobs.CreateJob((text2 != null && text2.Length > 0) ? text2 : text, text, options.ProjectsRoot);
			string targetThreadId3 = request.TargetThreadId;
			if (targetThreadId3 != null)
			{
				Jobs.RecordThreadId(targetThreadId3, job.Id);
				string launchSource = request.LaunchSource;
				bool flag2 = ((launchSource == "text" || launchSource == "voice") ? true : false);
				flag = flag2 && !AgentHarnessRuntimes.ContinuesOnNewConversationHarness(targetThreadId3) && !session.IsThreadActive(targetThreadId3);
			}
			isNewJob = true;
		}
		AgentTask task = new AgentTask
		{
			LaunchSource = request.LaunchSource,
			LaunchTimestamp = Stopwatch.GetTimestamp(),
			IsNewJobRun = flag
		};
		string text3 = clicky?.ThreadId ?? (((object)job != null && !request.StartsNewJobConversation && !flag) ? (request.TargetThreadId ?? job.ThreadId) : null);
		lock (task.Gate)
		{
			task.UserPrompts.Add(request.DisplayPrompt ?? request.Prompt);
			task.IsRoutineRun = request.LaunchSource == "routine";
			task.IsDemo = request.UsageContext == "onboarding";
			task.ProactiveSuggestionId = request.ProactiveSuggestionId;
			if (text3 == null)
			{
				task.PendingInitialMessageLog = request.DisplayPrompt ?? request.Prompt;
			}
			if ((object)clicky != null)
			{
				task.ClickySlug = clicky.Slug;
				task.ClickyName = clicky.Name;
				task.Title = clicky.Name;
				task.ThreadId = clicky.ThreadId;
			}
			else if ((object)job != null)
			{
				task.JobId = job.Id;
				task.Title = job.Title;
				task.ThreadId = text3;
				task.WorkspacePath = job.FolderPath;
			}
			task.TurnCts = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
		}
		tasks[task.Id] = task;
		if (text3 != null)
		{
			string threadId = text3;
			LogAgentMessage(task, threadId, "user", request.DisplayPrompt ?? request.Prompt, isFollowUp: true);
		}
		RaiseTasksChanged();
		Raise(task, AgentTaskEventKind.StatusChanged, "Starting");
		Task.Run(() => RunLaunchAsync(task, request, clicky, job, isNewJob), CancellationToken.None);
		return Task.FromResult(task.Id);
	}

	public async Task<string?> TextStartCueAsync(string prompt, bool isFreshThread, CancellationToken ct = default(CancellationToken))
	{
		_ = 1;
		try
		{
			string text = await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false);
			if (text == null)
			{
				return null;
			}
			return await api.TextStartCueAsync(text, prompt, isFreshThread, ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex) when (!(ex is OperationCanceledException))
		{
			Log.Warn("Agents", "text start cue: " + ex.Message);
			return null;
		}
	}

	public AgentTaskDetail? GetTaskDetail(string taskId)
	{
		if (!tasks.TryGetValue(taskId, out AgentTask t))
		{
			return null;
		}
		AgentTaskDetail agentTaskDetail = Lock(t, () => t.Detail());
		if ((object)agentTaskDetail != null && agentTaskDetail.JobId == null && agentTaskDetail.ClickySlug == null)
		{
			AgentTaskSnapshot snapshot = agentTaskDetail.Snapshot;
			if ((object)snapshot != null)
			{
				string threadId = snapshot.ThreadId;
				if (threadId != null)
				{
					ClickyJob clickyJob = Jobs.JobForThread(threadId);
					if ((object)clickyJob != null)
					{
						return agentTaskDetail with
						{
							JobId = clickyJob.Id
						};
					}
				}
			}
		}
		return agentTaskDetail;
	}

	public void DismissTask(string taskId)
	{
		if (tasks.TryGetValue(taskId, out AgentTask t) && !Lock(t, () => t.IsActive) && tasks.TryRemove(taskId, out AgentTask _))
		{
			RaiseTasksChanged();
		}
	}

	public async Task ApproveExtraUsageAsync(string taskId, bool asManyAsNeeded, CancellationToken ct = default(CancellationToken), bool remembersAlways = true)
	{
		AgentTask task = GetTask(taskId);
		AgentTurnLease lease;
		lock (task.Gate)
		{
			lease = task.Lease;
		}
		if ((object)lease == null)
		{
			throw new InvalidOperationException("This task has no credit lease to continue.");
		}
		string text = await RequireSupabaseTokenAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		AgentTurnLease agentTurnLease;
		try
		{
			agentTurnLease = await api.ContinueLeaseAsync(text, lease.LeaseId, asManyAsNeeded, ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (AgentBackendException ex) when (ex.IsPaywall)
		{
			RaisePaywall(ex, presents: true);
			CompanionError companionError = new CompanionError("agent_paywall", "You're out of agent messages.", ex.BodyJson);
			lock (task.Gate)
			{
				task.Error = companionError;
			}
			Raise(task, AgentTaskEventKind.NeedsExtraUsageApproval, companionError.Message);
			throw new AgentPaywallException(companionError);
		}
		if ((object)agentTurnLease == null || agentTurnLease.RequiresExtraEffort)
		{
			lock (task.Gate)
			{
				if ((object)agentTurnLease != null)
				{
					task.Lease = agentTurnLease;
				}
			}
			Raise(task, AgentTaskEventKind.NeedsExtraUsageApproval, "Still needs approval.");
			return;
		}
		Raise(task, AgentTaskEventKind.ExtraUsageApproved, null);
		if ((asManyAsNeeded & remembersAlways) && !options.AutoApproveExtraUsage)
		{
			options.AutoApproveExtraUsage = true;
			AutoApproveExtraUsageChanged?.Invoke(obj: true);
		}
		string contextOverride = (asManyAsNeeded ? "The user approved the extra usage to run this HeyClicky agent task to completion. Continue the same task from where it stopped." : "The user approved continuing this HeyClicky agent task once. Continue the same task from where it stopped.");
		await StartFollowUpTurnAsync(task, "Keep going.", null, "extra_effort", "companion", agentTurnLease, ct, contextOverride).ConfigureAwait(continueOnCapturedContext: false);
	}

	public Task PrewarmAsync(CancellationToken ct = default(CancellationToken))
	{
		if (options.EnableRoutines)
		{
			routines.Start();
		}
		RestorePendingAgentRequestsFromLastRun();
		StepWatcher.Reconcile();
		PrewarmAgentHarnessIfSelected();
		return Task.Run(async () =>
		{
			try
			{
				await EnsureRuntimeReadyAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "prewarm failed: " + ex.Message);
			}
			if (AgentHarnessRuntimes.Choice(null).HasValue)
			{
				try
				{
					await AgentHarnessRunnerProcess.IsAvailableForNewConversationAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
				}
				catch (Exception ex2)
				{
					Log.Warn("Harness", "runner prewarm failed: " + ex2.Message);
				}
			}
		}, ct);
	}

	public async Task SignOutAsync()
	{
		routines.Stop();
		foreach (AgentTask item in tasks.Values.ToList())
		{
			session.Interrupt(item, TurnOutcome.Interrupted, "Signed out.");
		}
		await runtimeGate.WaitAsync().ConfigureAwait(continueOnCapturedContext: false);
		try
		{
			await StopProcessAsync().ConfigureAwait(continueOnCapturedContext: false);
		}
		finally
		{
			runtimeGate.Release();
		}
		tokens.Invalidate();
		clickys.ClearHiddenThreads();
		composio = null;
		composioFetchedAt = default;
		tasks.Clear();
		RemoveJobsForSignOut();
		RaiseTasksChanged();
	}

	public void NotifyResumedFromSleep()
	{
		routines.HandleFullWake("resume");
	}

	public void NotifySystemSleeping()
	{
		routines.NoteSystemSleeping();
	}

	public void NotifyDisplayPower(bool isOn)
	{
		routines.NoteDisplayPower(isOn);
	}

	public void SetCustomConnectors(IReadOnlyList<CustomConnectorRegistration> connectors)
	{
		customConnectors = connectors;
		InvalidateConnectedApps();
	}

	public void InvalidateConnectedApps()
	{
		composioFetchedAt = default;
		configDirty = true;
		Interlocked.Increment(ref composioGeneration);
	}

	private async Task<T> WithSessionTokenAsync<T>(Func<string, Task<T>> call, CancellationToken ct)
	{
		T result = default;
		int num;
		Func<string, Task<T>> func;
		try
		{
			func = call;
			result = await func(await tokens.GetAsync(ct).ConfigureAwait(continueOnCapturedContext: false)).ConfigureAwait(continueOnCapturedContext: false);
			return result;
		}
		catch (Exception ex) when (AgentWorkerApi.IsUnauthorized(ex))
		{
			num = 1;
		}
		if (num != 1)
		{
			return result;
		}
		func = call;
		return await func(await tokens.GetAsync(ct, forceRefresh: true).ConfigureAwait(continueOnCapturedContext: false)).ConfigureAwait(continueOnCapturedContext: false);
	}

	public Task<AgentIntegrationCatalog> ListIntegrationsAsync(CancellationToken ct = default(CancellationToken))
	{
		return WithSessionTokenAsync((string token) => api.ListIntegrationsAsync(token, ct), ct);
	}

	public Task<string> ConnectIntegrationAsync(string toolkit, CancellationToken ct = default(CancellationToken))
	{
		return WithSessionTokenAsync((string token) => api.ConnectIntegrationAsync(token, toolkit, ct), ct);
	}

	public async Task DisconnectIntegrationAsync(string toolkit, string? connectedAccountId = null, CancellationToken ct = default(CancellationToken))
	{
		await WithSessionTokenAsync(async (string token) =>
		{
			await api.DisconnectIntegrationAsync(token, toolkit, connectedAccountId, ct).ConfigureAwait(continueOnCapturedContext: false);
			return true;
		}, ct).ConfigureAwait(continueOnCapturedContext: false);
		InvalidateConnectedApps();
	}

	public async Task LabelIntegrationAccountAsync(string toolkit, string connectedAccountId, string label, CancellationToken ct = default(CancellationToken))
	{
		await WithSessionTokenAsync(async (string token) =>
		{
			await api.LabelIntegrationAccountAsync(token, toolkit, connectedAccountId, label, ct).ConfigureAwait(continueOnCapturedContext: false);
			return true;
		}, ct).ConfigureAwait(continueOnCapturedContext: false);
		InvalidateConnectedApps();
	}

	public async Task<double?> LeaseBilledCostAsync(string leaseId, CancellationToken ct = default(CancellationToken))
	{
		string text = await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false);
		if (text == null)
		{
			return null;
		}
		return (await api.LeaseStatusAsync(text, leaseId, ct).ConfigureAwait(continueOnCapturedContext: false))?.CostUsd;
	}

	public void SetProjectsRoot(string path)
	{
		if (!string.Equals(options.ProjectsRoot, path, StringComparison.OrdinalIgnoreCase))
		{
			Directory.CreateDirectory(path);
			options.ProjectsRoot = path;
			clickys.ProjectsRoot = path;
			configDirty = true;
			Log.Info("Agents", "agent folder: " + path);
		}
	}

	public ClickyInfo? FindClicky(string slug)
	{
		return clickys.Get(slug);
	}

	public Task<string> GetAgentSessionTokenAsync(bool forceRefresh = false, CancellationToken ct = default(CancellationToken))
	{
		return tokens.GetAsync(ct, forceRefresh);
	}

	public bool IsClickyBusy(string slug)
	{
		return tasks.Values.Any((AgentTask t) => t.ClickySlug == slug && Lock(t, () => t.IsActive));
	}

	public string? WorkspacePath(string clickySlug)
	{
		ClickyInfo clickyInfo = clickys.Get(clickySlug);
		if ((object)clickyInfo == null)
		{
			return null;
		}
		return clickys.WorkspacePath(clickyInfo.Slug);
	}

	public ClickyInfo CreateClicky(string name, string roleText, string oneLiner)
	{
		ClickyInfo clickyInfo = clickys.Found(name, roleText, oneLiner);
		clickys.EnsureWorkspace(clickyInfo);
		RaiseTasksChanged();
		return clickyInfo;
	}

	public bool KnowsClicky(string slug)
	{
		return (object)clickys.Get(slug) != null;
	}

	public async Task<(IReadOnlyList<AgentThreadSummary> Threads, string? NextCursor)> ListThreadsAsync(int limit = 50, string? cursor = null, string? cwd = null, CancellationToken ct = default(CancellationToken))
	{
		JsonObject jsonObject = await WithReadyRetryAsync(() => session.ListThreadsAsync(limit, cursor, cwd, ct), ct).ConfigureAwait(continueOnCapturedContext: false);
		JsonArray source = ((jsonObject["data"] ?? jsonObject["threads"] ?? jsonObject["items"]) as JsonArray) ?? new JsonArray();
		List<AgentThreadSummary> list = new List<AgentThreadSummary>();
		foreach (JsonObject item in source.OfType<JsonObject>())
		{
			string text = item["id"]?.ToString() ?? item["threadId"]?.ToString();
			if (text != null && item["parentThreadId"] == null && (item["source"] as JsonObject)?["subagent"] == null && !clickys.IsThreadHidden(text))
			{
				string text2 = PreviewText(item["preview"]?.ToString() ?? item["firstUserMessage"]?.ToString() ?? item["title"]?.ToString() ?? "");
				text2 = clickys.DisplayFor(text2) ?? text2;
				ClickyInfo clickyInfo = clickys.ForThread(text);
				list.Add(new AgentThreadSummary(text, clickys.TitleForThread(text) ?? clickyInfo?.Name ?? item["name"]?.ToString(), text2, Timestamp(item["createdAt"]), Timestamp(item["updatedAt"]) ?? Timestamp(item["createdAt"]), (item["status"] as JsonObject)?["type"]?.ToString() ?? (item["status"] as JsonValue)?.ToString() ?? "idle", item["cwd"]?.ToString(), clickyInfo?.Slug));
			}
		}
		if (cursor == null)
		{
			StartPersonaNameBackfillOnce(list);
		}
		return (Threads: list, NextCursor: jsonObject["nextCursor"]?.ToString());
	}

	private void StartPersonaNameBackfillOnce(IReadOnlyList<AgentThreadSummary> threads)
	{
		if (Interlocked.Exchange(ref personaNameBackfillStarted, 1) == 1)
		{
			return;
		}
		List<AgentThreadSummary> unnamed = threads.Where((AgentThreadSummary t) => clickys.TitleForThread(t.ThreadId) == null && (object)clickys.ForThread(t.ThreadId) == null && (string.IsNullOrWhiteSpace(t.Name) || t.Name.Trim() == "Untitled agent thread") && !string.IsNullOrWhiteSpace(t.Preview)).Take(15).ToList();
		if (unnamed.Count == 0)
		{
			return;
		}
		Task.Run(async () =>
		{
			int named = 0;
			foreach (AgentThreadSummary thread in unnamed)
			{
				try
				{
					string basis = thread.Preview;
					try
					{
						string text = (await ReadThreadAsync(thread.ThreadId, lifetime.Token).ConfigureAwait(continueOnCapturedContext: false)).FirstOrDefault()?.UserMessages.FirstOrDefault();
						if (text != null && text.Length > 0)
						{
							basis = text;
						}
					}
					catch (Exception ex)
					{
						Log.Warn("Agents", "persona backfill: thread/read " + thread.ThreadId + ": " + ex.Message);
					}
					basis = basis.Trim();
					if (basis.Length >= 12)
					{
						if (basis.Length > 600)
						{
							basis = basis.Substring(0, 600);
						}
						string text2 = await supabaseAccessToken(lifetime.Token).ConfigureAwait(continueOnCapturedContext: false);
						if (text2 == null)
						{
							break;
						}
						string text3 = await api.ThreadTitleAsync(text2, basis, lifetime.Token, TimeSpan.FromSeconds(20L)).ConfigureAwait(continueOnCapturedContext: false);
						if (!string.IsNullOrWhiteSpace(text3))
						{
							clickys.SetThreadTitle(thread.ThreadId, text3.Trim());
							named++;
						}
					}
				}
				catch (Exception ex2)
				{
					Log.Warn("Agents", "persona backfill stopped: " + ex2.Message);
					break;
				}
			}
			if (named == 0)
			{
				return;
			}
			Log.Info("Agents", $"persona backfill named {named} thread(s)");
			try
			{
				ThreadHistoryChanged?.Invoke(this, EventArgs.Empty);
			}
			catch (Exception ex3)
			{
				Log.Warn("Agents", "ThreadHistoryChanged handler: " + ex3.Message);
			}
		});
	}

	public async Task<IReadOnlyList<AgentTranscriptTurn>> ReadThreadAsync(string threadId, CancellationToken ct = default(CancellationToken))
	{
		if (AgentHarnessPreferences.IsHarnessThread(threadId))
		{
			return Array.Empty<AgentTranscriptTurn>();
		}
		JsonObject jsonObject = await WithReadyRetryAsync(() => session.ReadThreadAsync(threadId, ct), ct).ConfigureAwait(continueOnCapturedContext: false);
		JsonArray jsonArray = (((jsonObject["thread"] as JsonObject)?["turns"] ?? jsonObject["turns"]) as JsonArray) ?? new JsonArray();
		RecordDataSourcesFromThread(threadId, jsonArray);
		List<AgentTranscriptTurn> list = new List<AgentTranscriptTurn>();
		foreach (JsonObject item in jsonArray.OfType<JsonObject>())
		{
			List<string> list2 = new List<string>();
			List<string> list3 = new List<string>();
			List<string> list4 = new List<string>();
			List<string> list5 = new List<string>();
			List<string> list6 = new List<string>();
			DateTimeOffset? dateTimeOffset = null;
			DateTimeOffset? dateTimeOffset2 = null;
			foreach (JsonObject item2 in ((item["items"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
			{
				DateTimeOffset? dateTimeOffset3 = TranscriptDate(item2, "timestamp", "createdAt", "created_at", "startedAt", "started_at", "completedAt", "completed_at");
				DateTimeOffset valueOrDefault;
				if (dateTimeOffset3.HasValue)
				{
					valueOrDefault = dateTimeOffset3.GetValueOrDefault();
					if (dateTimeOffset.HasValue)
					{
						DateTimeOffset value = valueOrDefault;
						dateTimeOffset3 = dateTimeOffset;
						if (!(value < dateTimeOffset3))
						{
							goto IL_0274;
						}
					}
					dateTimeOffset = valueOrDefault;
					goto IL_0274;
				}
				goto IL_02aa;
				IL_02aa:
				switch (item2["type"]?.ToString())
				{
				case "userMessage":
				case "user_message":
				{
					string text2 = CodexSession.ItemText(item2);
					if (text2 != null)
					{
						string text3 = DisplayUserText(text2);
						list2.Add(clickys.DisplayFor(text3) ?? text3);
					}
					break;
				}
				case "agentMessage":
				case "agent_message":
				{
					string text4 = CodexSession.ItemText(item2);
					if (text4 == null)
					{
						break;
					}
					if (item2["phase"]?.ToString() == "commentary")
					{
						list3.Add(text4);
						break;
					}
					StructuredFinalReply structuredFinalReply = StructuredFinalReply.Parse(text4);
					if (structuredFinalReply.Text.Length > 0)
					{
						list4.Add(structuredFinalReply.Text);
					}
					list5.AddRange(structuredFinalReply.NextActions.Except(list5));
					list6.AddRange(structuredFinalReply.Artifacts.Except(list6));
					break;
				}
				case "commandExecution":
					list3.Add("$ " + CodexSession.ShellCommandDisplay(item2["command"]));
					break;
				default:
				{
					string text = CodexSession.PublicToolActivityText(item2);
					if (text != null)
					{
						list3.Add(text);
					}
					break;
				}
				}
				continue;
				IL_0274:
				if (dateTimeOffset2.HasValue)
				{
					DateTimeOffset value = valueOrDefault;
					dateTimeOffset3 = dateTimeOffset2;
					if (!(value > dateTimeOffset3))
					{
						goto IL_02aa;
					}
				}
				dateTimeOffset2 = valueOrDefault;
				goto IL_02aa;
			}
			list.Add(new AgentTranscriptTurn(item["id"]?.ToString(), list2, list3, list4, list5, list6, (item["status"] as JsonObject)?["type"]?.ToString() ?? (item["status"] as JsonValue)?.ToString() ?? "completed", (item["error"] as JsonObject)?["message"]?.ToString(), TranscriptDate(item, "startedAt", "started_at", "createdAt", "created_at", "timestamp") ?? dateTimeOffset, TranscriptDate(item, "completedAt", "completed_at", "finishedAt", "finished_at", "updatedAt", "updated_at") ?? dateTimeOffset2));
		}
		return list;
	}

	private static DateTimeOffset? TranscriptDate(JsonObject payload, params string[] keys)
	{
		foreach (string propertyName in keys)
		{
			if (payload[propertyName] is JsonValue)
			{
				DateTimeOffset? dateTimeOffset = Timestamp(payload[propertyName]);
				if (dateTimeOffset.HasValue)
				{
					return dateTimeOffset.GetValueOrDefault();
				}
			}
		}
		return null;
	}

	public Task ArchiveThreadAsync(string threadId, CancellationToken ct = default(CancellationToken))
	{
		if (session.IsThreadActive(threadId))
		{
			throw new InvalidOperationException("Stop the agent before archiving its conversation.");
		}
		HideThreadFromHistory(threadId);
		ClickyInfo clickyInfo = clickys.ForThread(threadId);
		if ((object)clickyInfo != null && clickyInfo.ThreadId == threadId)
		{
			clickys.Archive(clickyInfo.Slug);
		}
		foreach (AgentTask item in tasks.Values.Where((AgentTask t) => t.ThreadId == threadId).ToList())
		{
			tasks.TryRemove(item.Id, out AgentTask _);
		}
		RaiseTasksChanged();
		if (AgentHarnessPreferences.IsHarnessThread(threadId))
		{
			return Task.CompletedTask;
		}
		Task.Run(async () =>
		{
			try
			{
				await WithReadyRetryAsync(() => session.ArchiveThreadAsync(threadId, CancellationToken.None), CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "thread/archive " + threadId + " failed (kept hidden): " + ex.Message);
			}
		});
		return Task.CompletedTask;
	}

	public bool HideThreadFromHistory(string threadId)
	{
		if (!string.IsNullOrWhiteSpace(threadId))
		{
			return clickys.HideThread(threadId);
		}
		return false;
	}

	public bool IsThreadHidden(string threadId)
	{
		return clickys.IsThreadHidden(threadId);
	}

	public void ArchiveClicky(string slug)
	{
		if (tasks.Values.Any((AgentTask t) => t.ClickySlug == slug && Lock(t, () => t.IsActive)))
		{
			throw new InvalidOperationException("Stop the agent before archiving it.");
		}
		clickys.Archive(slug);
		foreach (AgentTask item in tasks.Values.Where((AgentTask t) => t.ClickySlug == slug).ToList())
		{
			tasks.TryRemove(item.Id, out AgentTask _);
		}
		RaiseTasksChanged();
	}

	public string OpenThread(string threadId)
	{
		AgentTask agentTask = tasks.Values.FirstOrDefault((AgentTask t) => t.ThreadId == threadId);
		if (agentTask != null)
		{
			return agentTask.Id;
		}
		ClickyInfo clickyInfo = clickys.ForThread(threadId);
		ClickyJob clickyJob = (((object)clickyInfo == null) ? Jobs.JobForThread(threadId) : null);
		AgentTask agentTask2 = new AgentTask
		{
			ThreadId = threadId,
			Status = AgentTaskStatus.Finished,
			ProgressSummary = ""
		};
		agentTask2.Title = clickys.TitleForThread(threadId) ?? clickyInfo?.Name ?? clickyJob?.Title ?? agentTask2.Title;
		agentTask2.ClickySlug = clickyInfo?.Slug;
		agentTask2.ClickyName = clickyInfo?.Name;
		agentTask2.JobId = clickyJob?.Id;
		agentTask2.WorkspacePath = (((object)clickyInfo != null) ? clickys.WorkspacePath(clickyInfo.Slug) : clickyJob?.FolderPath);
		tasks[agentTask2.Id] = agentTask2;
		RaiseTasksChanged();
		return agentTask2.Id;
	}

	private async Task PrepareRuntimeLockedAsync(CancellationToken ct)
	{
		Stopwatch sw = Stopwatch.StartNew();
		string key = await tokens.GetAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		string token = key;
		await RefreshConnectorTokensBeforePrepareAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		for (int attempt = 0; attempt < 2; attempt++)
		{
			if (!(DateTimeOffset.Now - composioFetchedAt >= ComposioRefreshAfter))
			{
				break;
			}
			int generation = Volatile.Read(in composioGeneration);
			var (composioFetchKind, composioMcpConfiguration, ex) = await api.ComposioSessionAsync(token, ct).ConfigureAwait(continueOnCapturedContext: false);
			Log.Info("Agents", $"composio session: {composioFetchKind}{(((object)composioMcpConfiguration == null) ? "" : (" toolkits=[" + string.Join(",", composioMcpConfiguration.Toolkits) + "]"))}");
			configDirty = true;
			if (composioFetchKind == AgentWorkerApi.ComposioFetchKind.Unreachable)
			{
				composioUnreachable = (object)composio == null;
				Log.Warn("Agents", "composio unreachable: " + ex?.Message);
				break;
			}
			composio = composioMcpConfiguration;
			composioUnreachable = false;
			composioFetchedAt = ((generation == Volatile.Read(in composioGeneration)) ? DateTimeOffset.Now : default(DateTimeOffset));
		}
		AgentHarnessMcpServer browser = null;
		Func<CancellationToken, Task<AgentHarnessMcpServer>> browserMcpServerProvider = BrowserMcpServerProvider;
		if (browserMcpServerProvider != null)
		{
			try
			{
				browser = await browserMcpServerProvider(ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex2)
			{
				Log.Warn("Agents", "browser endpoint for Codex: " + ex2.Message);
			}
		}
		bool flag = browser?.Url != codexBrowserMcp?.Url || browser?.BearerToken != codexBrowserMcp?.BearerToken;
		if (flag)
		{
			codexBrowserMcp = browser;
			configDirty = true;
		}
		if (configDirty)
		{
			CodexHomeManager codexHomeManager = home;
			string absoluteUri = endpoints.WorkerBaseUrl.AbsoluteUri;
			ClientIdentity clientIdentity = identity;
			ComposioMcpConfiguration? composioMcpConfiguration2 = composio;
			bool areConnectedAppsTemporarilyUnreachable = composioUnreachable;
			IReadOnlyList<CustomConnectorRegistration> readOnlyList = customConnectors;
			AgentHarnessMcpServer agentHarnessMcpServer = codexBrowserMcp;
			codexHomeManager.PrepareRuntimeConfiguration(absoluteUri, clientIdentity, composioMcpConfiguration2, areConnectedAppsTemporarilyUnreachable, readOnlyList, ((object)agentHarnessMcpServer != null) ? new CodexLoopbackMcpEndpoint(agentHarnessMcpServer.Name, agentHarnessMcpServer.Url, "CLICKY_BROWSER_MCP_TOKEN") : null);
			session.McpServersToAwaitBeforeTurn = (((object)composio == null) ? new HashSet<string>() : new HashSet<string> { "composio" });
		}
		CodexAppServerProcess process = session.Process;
		bool flag2 = process != null && process.IsRunning && session.IsConnected;
		bool flag3 = flag2 && process.SpawnEnvironment.GetValueOrDefault("OPENAI_API_KEY") != token;
		if (flag2 && (flag3 || (configDirty && ((customConnectors.Count > 0 || obsidianChanged) | flag))))
		{
			if (session.ActiveTurnCount == 0)
			{
				Log.Info("Agents", flag3 ? "session token rotated; restarting idle app-server" : "MCP table changed; restarting idle app-server");
				await StopProcessAsync().ConfigureAwait(continueOnCapturedContext: false);
				flag2 = false;
			}
			else
			{
				Log.Info("Agents", $"keeping app-server with {session.ActiveTurnCount} active turn(s); will rotate when idle");
			}
		}
		configDirty = false;
		if (!flag2)
		{
			obsidianChanged = false;
		}
		if (flag2)
		{
			return;
		}
		await StopProcessAsync().ConfigureAwait(continueOnCapturedContext: false);
		Dictionary<string, string> env = new Dictionary<string, string>
		{
			["OPENAI_API_KEY"] = token,
			["CLICKY_WORKER_BASE_URL"] = endpoints.WorkerBaseUrl.AbsoluteUri.TrimEnd('/')
		};
		if (!string.IsNullOrWhiteSpace(options.ObsidianVaultPath))
		{
			env["OBSIDIAN_VAULT_PATH"] = options.ObsidianVaultPath;
		}
		foreach (CustomConnectorRegistration customConnector in customConnectors)
		{
			foreach (KeyValuePair<string, string> item in customConnector.Environment)
			{
				item.Deconstruct(out key, out var value);
				string key2 = key;
				string value2 = value;
				env[key2] = value2;
			}
		}
		string text = codexBrowserMcp?.BearerToken;
		if (text != null)
		{
			env["CLICKY_BROWSER_MCP_TOKEN"] = text;
		}
		Stopwatch spawnWatch = Stopwatch.StartNew();
		CodexAppServerProcess codexAppServerProcess;
		try
		{
			codexAppServerProcess = await Task.Run(() => CodexAppServerProcess.Start(options.CodexExecutablePath, options.CodexHome, env), ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (FileNotFoundException ex3) when (!AgentHarnessPreferences.UsesCodexAppServer)
		{
			Log.Warn("Harness", "[harness] the Codex app-server isn't available (" + ex3.Message + "); new jobs run on " + AgentHarnessPreferences.Harness.DisplayName());
			return;
		}
		codexAppServerProcess.ExitedUnexpectedly += (int code) =>
		{
			Log.Error("Agents", $"app-server exited with status {code}");
		};
		await session.ConnectAsync(codexAppServerProcess, token, ct).ConfigureAwait(continueOnCapturedContext: false);
		spawnToInitializedMs = spawnWatch.ElapsedMilliseconds;
		runtimeReadyMs = sw.ElapsedMilliseconds;
		Log.Info("Agents", $"runtime ready: spawn->initialized {spawnToInitializedMs} ms, total {runtimeReadyMs} ms");
	}

	private Task<T> WithReadyRetryAsync<T>(Func<Task<T>> operation, CancellationToken ct)
	{
		return CodexReadyRetry.RunAsync(() => EnsureRuntimeReadyAsync(ct), operation, () => session.ActiveTurnCount > 0, async () =>
		{
			await runtimeGate.WaitAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
			try
			{
				await StopProcessAsync().ConfigureAwait(continueOnCapturedContext: false);
			}
			finally
			{
				runtimeGate.Release();
			}
		}, ct);
	}

	private async Task StopProcessAsync()
	{
		CodexAppServerProcess process = session.Process;
		session.Disconnect();
		if (process != null)
		{
			await Task.Run((Action)process.Dispose).ConfigureAwait(continueOnCapturedContext: false);
		}
	}

	private async Task MaintainAsync()
	{
		if (disposed || !tokens.ExpiresAt.HasValue || runtimeParkedIdle)
		{
			return;
		}
		try
		{
			bool flag = tokens.NeedsRefresh || (IsRuntimeReady && (CustomConnectorTokensExpiring?.Invoke() ?? false));
			if (!flag)
			{
				bool flag2 = session.ActiveTurnCount == 0 && IsRuntimeReady;
				if (flag2)
				{
					string valueOrDefault = session.Process.SpawnEnvironment.GetValueOrDefault("OPENAI_API_KEY");
					flag2 = valueOrDefault != await tokens.GetAsync(lifetime.Token).ConfigureAwait(continueOnCapturedContext: false);
				}
				flag = flag2;
			}
			if (flag)
			{
				await EnsureRuntimeReadyAsync(lifetime.Token).ConfigureAwait(continueOnCapturedContext: false);
			}
		}
		catch (Exception ex)
		{
			Log.Warn("Agents", "maintenance refresh failed: " + ex.Message);
		}
	}

	private async Task RunLaunchAsync(AgentTask task, AgentLaunchRequest request, ClickyInfo? clicky, ClickyJob? job, bool isNewJob)
	{
		CancellationToken ct = task.TurnCts.Token;
		try
		{
			Task ready = EnsureRuntimeReadyAsync(ct);
			Task<string?> memory = FetchMemoryAsync(ct);
			AgentTask task2;
			string jobContext;
			IReadOnlyList<byte[]> imagesJpeg;
			IReadOnlyList<string> attachedFilePaths;
			string usageContext;
			string launchSource;
			string launchContext;
			bool autoApproveExtraUsage;
			IReadOnlyList<(string User, string Assistant)> priorCompanionTurns;
			bool isGeneratedTaskBrief;
			if ((object)job != null)
			{
				jobContext = request.LaunchContext?.Trim() ?? "";
				string threadId;
				lock (task.Gate)
				{
					threadId = task.ThreadId;
				}
				if (!isNewJob)
				{
					(string, string) tuple = PlanJobTurn(job, task, request.Prompt.Trim(), request.LaunchSource, hasPreauthorizedLease: false, threadId, request.StartsNewJobConversation);
					lock (task.Gate)
					{
						task.ThreadId = tuple.Item1;
					}
					jobContext += tuple.Item2;
				}
				else
				{
					if (Lock(task, () => task.IsNewJobRun))
					{
						lock (task.Gate)
						{
							task.PendingUserStep = null;
						}
						bool hasPreviousNote = ClickyWorkFolderFiles.RetireNote(job.FolderPath);
						jobContext = jobContext + "\n" + JobContinuationContext(job, hasPreviousNote);
						Jobs.BeginRun(job.Id, request.Prompt.Trim());
					}
					jobContext = jobContext + "\n" + ClickyJobBrief.WorkFolderContext;
					Jobs.MarkWorking(job.Id);
				}
				Directory.CreateDirectory(Path.Combine(job.FolderPath, "output"));
				Directory.CreateDirectory(Path.Combine(job.FolderPath, "tmp"));
				await ready.ConfigureAwait(continueOnCapturedContext: false);
				task2 = task;
				string prompt = request.Prompt;
				imagesJpeg = request.ImagesJpeg;
				attachedFilePaths = request.AttachedFilePaths;
				launchContext = jobContext.TrimStart('\n');
				launchSource = request.LaunchSource;
				usageContext = request.UsageContext;
				isGeneratedTaskBrief = request.IsGeneratedTaskBrief;
				priorCompanionTurns = request.PriorCompanionTurns;
				autoApproveExtraUsage = request.AutoApproveExtraUsage;
				await RunTurnAsync(task2, new TurnSpec(prompt, imagesJpeg, attachedFilePaths, launchContext, launchSource, usageContext, isGeneratedTaskBrief, priorCompanionTurns, null, autoApproveExtraUsage, await memory.ConfigureAwait(continueOnCapturedContext: false)), ct).ConfigureAwait(continueOnCapturedContext: false);
				return;
			}
			bool founded = false;
			if ((object)clicky == null)
			{
				string text = request.NewClickyName?.Trim();
				string text2 = ((text == null || text.Length <= 0) ? (await TitleAsync(request.Prompt, ct).ConfigureAwait(continueOnCapturedContext: false)) : text);
				string name = text2;
				string oneLiner = request.NewClickyOneLiner ?? OneLinerFrom(request.Prompt);
				clicky = clickys.Found(name, request.NewClickyRole, oneLiner);
				try
				{
					ClickyFounded?.Invoke(clicky.Slug);
				}
				catch (Exception ex)
				{
					Log.Warn("Agents", "ClickyFounded handler: " + ex.Message);
				}
				founded = true;
				lock (task.Gate)
				{
					task.ClickySlug = clicky.Slug;
					task.ClickyName = clicky.Name;
					task.Title = clicky.Name;
					task.ThreadId = clicky.ThreadId;
				}
				Raise(task, AgentTaskEventKind.TitleChanged, clicky.Name);
				RaiseTasksChanged();
			}
			string workspacePath = clickys.EnsureWorkspace(clicky);
			lock (task.Gate)
			{
				task.WorkspacePath = workspacePath;
			}
			await ready.ConfigureAwait(continueOnCapturedContext: false);
			string launchContext2 = request.LaunchContext;
			string text3 = ((launchContext2 != null) ? (launchContext2.Trim() + " ") : null);
			string text4 = LeaveOldHarnessThread(task, request.LaunchSource, preauthorized: false);
			if (text4 != null)
			{
				text3 = text3 + ClickyFreshConversationContext(text4) + "\n";
			}
			string text5 = TurnPromptBuilder.ClickyLaunchContext(clicky, founded, text3, text4 != null);
			task2 = task;
			jobContext = request.Prompt;
			imagesJpeg = request.ImagesJpeg;
			attachedFilePaths = request.AttachedFilePaths;
			usageContext = text5;
			launchSource = request.LaunchSource;
			launchContext = request.UsageContext;
			autoApproveExtraUsage = request.IsGeneratedTaskBrief;
			priorCompanionTurns = request.PriorCompanionTurns;
			isGeneratedTaskBrief = request.AutoApproveExtraUsage;
			await RunTurnAsync(task2, new TurnSpec(jobContext, imagesJpeg, attachedFilePaths, usageContext, launchSource, launchContext, autoApproveExtraUsage, priorCompanionTurns, null, isGeneratedTaskBrief, await memory.ConfigureAwait(continueOnCapturedContext: false)), ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex2)
		{
			FailLaunch(task, ex2);
		}
	}

	private Task StartFollowUpTurnAsync(AgentTask task, string text, IReadOnlyList<byte[]>? images, string source, string usageContext, AgentTurnLease? preauthorizedLease, CancellationToken ct, string? contextOverride = null, string? requestedThreadId = null, bool startsNewJobConversation = false)
	{
		ClickyInfo clicky;
		ClickyJob job;
		lock (task.Gate)
		{
			if (task.IsActive)
			{
				throw new InvalidOperationException("This job is still working on its current task.");
			}
			string clickySlug = task.ClickySlug;
			clicky = ((clickySlug != null) ? clickys.Get(clickySlug) : null);
			string jobId = task.JobId;
			job = ((jobId != null) ? Jobs.Job(jobId) : null);
		}
		string text2 = Lock(task, () => task.ThreadId);
		if (text2 != null)
		{
			ClickyPendingAgentRequestStore.Remove(text2);
			resultCards.TryRemove(text2, out ClickyAnswer _);
		}
		string jobContext = "";
		string threadId = null;
		if ((object)job != null)
		{
			(threadId, jobContext) = PlanJobTurn(job, task, text.Trim(), source, (object)preauthorizedLease != null, requestedThreadId ?? Lock(task, () => task.ThreadId), startsNewJobConversation);
		}
		lock (task.Gate)
		{
			task.ResetForNewTurn(text);
			task.LaunchSource = source;
			task.LaunchTimestamp = Stopwatch.GetTimestamp();
			task.TurnCts = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
			if ((object)job != null)
			{
				task.ThreadId = threadId;
				task.WorkspacePath = job.FolderPath;
			}
		}
		string leftThread = (((object)clicky != null) ? LeaveOldHarnessThread(task, source, (object)preauthorizedLease != null) : null);
		RaiseTasksChanged();
		Raise(task, AgentTaskEventKind.StatusChanged, "Starting");
		if (source != "extra_effort")
		{
			string threadId2;
			lock (task.Gate)
			{
				threadId2 = task.ThreadId;
			}
			if (threadId2 == null)
			{
				lock (task.Gate)
				{
					task.PendingInitialMessageLog = text;
				}
			}
			else
			{
				LogAgentMessage(task, threadId2, "user", text, isFollowUp: true);
			}
		}
		CancellationToken turnCt = task.TurnCts.Token;
		Task.Run(async () =>
		{
			_ = 2;
			try
			{
				Task<string?> memory = FetchMemoryAsync(turnCt);
				await EnsureRuntimeReadyAsync(turnCt).ConfigureAwait(continueOnCapturedContext: false);
				string text3 = contextOverride ?? (((object)clicky != null) ? TurnPromptBuilder.ClickyLaunchContext(clicky, foundedForThisTask: false, (leftThread == null) ? null : (ClickyFreshConversationContext(leftThread) + "\n"), leftThread != null) : (((object)job != null) ? "" : "The user sent a follow-up to this HeyClicky agent conversation."));
				text3 = (text3 + jobContext).TrimStart('\n');
				if ((object)clicky != null)
				{
					lock (task.Gate)
					{
						AgentTask agentTask = task;
						if (agentTask.WorkspacePath == null)
						{
							agentTask.WorkspacePath = clickys.EnsureWorkspace(clicky);
						}
					}
				}
				AgentTask task2 = task;
				string prompt = text;
				IReadOnlyList<byte[]> images2 = images;
				string launchContext = text3;
				string launchSource = source;
				string usageContext2 = usageContext;
				bool isGeneratedBrief = source == "extra_effort";
				AgentTurnLease preauthorizedLease2 = preauthorizedLease;
				string text4 = await memory.ConfigureAwait(continueOnCapturedContext: false);
				await RunTurnAsync(task2, new TurnSpec(prompt, images2, null, launchContext, launchSource, usageContext2, isGeneratedBrief, null, preauthorizedLease2, AutoApproveExtraUsage: false, text4), turnCt).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex)
			{
				FailLaunch(task, ex);
			}
		}, CancellationToken.None);
		return Task.CompletedTask;
	}

	private async Task RunTurnAsync(AgentTask task, TurnSpec spec, CancellationToken ct)
	{
		if (!slots.Wait(0))
		{
			SetProgress(task, "Waiting for another agent to finish…");
			await slots.WaitAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		lock (task.Gate)
		{
			task.HoldsSlot = true;
		}
		try
		{
			string clientTurnId = Guid.NewGuid().ToString("D").ToUpperInvariant();
			AgentTurnLease lease = spec.PreauthorizedLease;
			string threadId;
			lock (task.Gate)
			{
				threadId = task.ThreadId;
			}
			if ((object)lease == null)
			{
				string text = await RequireSupabaseTokenAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
				try
				{
					lease = await api.RecordAgentLaunchAsync(text, threadId, clientTurnId, task.NumericId, threadId != null, spec.LaunchSource, spec.AutoApproveExtraUsage || options.AutoApproveExtraUsage, spec.UsageContext, ct).ConfigureAwait(continueOnCapturedContext: false);
				}
				catch (AgentBackendException ex) when (ex.IsPaywall)
				{
					bool flag;
					lock (task.Gate)
					{
						flag = task.IsRoutineRun || spec.LaunchSource == "routine";
					}
					RaisePaywall(ex, !flag);
					throw new AgentPaywallException(new CompanionError("agent_paywall", "Oops, you're out of tokens! Beef up HeyClicky to continue.", ex.BodyJson));
				}
				lock (task.Gate)
				{
					task.LeaseRecordedAt = DateTimeOffset.Now;
				}
			}
			lock (task.Gate)
			{
				task.Lease = lease;
			}
			ct.ThrowIfCancellationRequested();
			string workspace;
			lock (task.Gate)
			{
				workspace = task.WorkspacePath;
			}
			string cwd = workspace ?? options.ProjectsRoot;
			bool isNewThread = threadId == null;
			(AgentHarness, AgentHarnessPlace)? tuple = ((threadId != null) ? AgentHarnessRuntimes.Choice(threadId) : (await HarnessForNewConversationAsync(ct).ConfigureAwait(continueOnCapturedContext: false)));
			(AgentHarness Harness, AgentHarnessPlace Place)? harness = tuple;
			if (harness.HasValue)
			{
				(AgentHarness, AgentHarnessPlace) valueOrDefault = harness.GetValueOrDefault();
				if (threadId == null)
				{
					threadId = AgentHarnessPreferences.ThreadIdPrefix(valueOrDefault.Item1, valueOrDefault.Item2) + Guid.NewGuid().ToString("D").ToLowerInvariant();
					lock (task.Gate)
					{
						task.ThreadId = threadId;
					}
					BindNewThread(task, threadId);
					string deliveredModelInstructions = home.DeliveredModelInstructions;
					if (deliveredModelInstructions != null)
					{
						clickys.MarkThreadStartedWithInstructions(threadId, deliveredModelInstructions);
					}
					clickys.SetThreadTitle(threadId, task.Title);
					RaiseTasksChanged();
				}
			}
			if (!harness.HasValue && threadId != null && !session.IsThreadLoaded(threadId))
			{
				SetProgress(task, "Opening conversation and tools…");
				try
				{
					await session.ResumeThreadAsync(threadId, cwd, ct).ConfigureAwait(continueOnCapturedContext: false);
				}
				catch (CodexRpcException ex2) when (ex2.IsMissingRollout)
				{
					Log.Warn("Agents", "thread " + threadId + " has no rollout; starting a fresh thread");
					string clickySlug = task.ClickySlug;
					if (clickySlug != null)
					{
						clickys.UnbindThread(clickySlug);
					}
					threadId = null;
					isNewThread = true;
				}
			}
			if (threadId == null)
			{
				SetProgress(task, "Opening conversation and tools…");
				threadId = (await session.StartThreadAsync(cwd, options.Model, ct).ConfigureAwait(continueOnCapturedContext: false))["id"].ToString();
				lock (task.Gate)
				{
					task.ThreadId = threadId;
				}
				BindNewThread(task, threadId);
				string deliveredModelInstructions2 = home.DeliveredModelInstructions;
				if (deliveredModelInstructions2 != null)
				{
					clickys.MarkThreadStartedWithInstructions(threadId, deliveredModelInstructions2);
				}
				clickys.SetThreadTitle(threadId, task.Title);
				RaiseTasksChanged();
			}
			FlushPendingInitialMessageLog(task, threadId);
			List<string> imagePaths = new List<string>();
			IReadOnlyList<byte[]> images = spec.Images;
			if (images != null && images.Count > 0)
			{
				string dir = home.TaskAssetsDirectory(task.NumericId);
				for (int n = 0; n < spec.Images.Count; n++)
				{
					string path = Path.Combine(dir, $"screenshot-{DateTime.Now:HHmmss}-{n + 1}.jpg");
					await File.WriteAllBytesAsync(path, spec.Images[n], ct).ConfigureAwait(continueOnCapturedContext: false);
					imagePaths.Add(path);
				}
			}
			string jobId;
			lock (task.Gate)
			{
				jobId = task.JobId;
			}
			bool flag2 = ClickyJobsPreferences.IsEnabled && jobId != null;
			if (flag2)
			{
				string text2 = LiveStepsKey(task);
				if (text2 != null)
				{
					LiveSteps.Clear(text2);
				}
			}
			string text3 = (flag2 ? LearnedHowTos.PromptSection(spec.Prompt) : "");
			bool flag3 = StandingContextLedger.NeedsCarrying(StandingContextLedger.Section.LearnedHowTos, text3, isNewThread ? null : threadId);
			string launchContext = spec.LaunchContext;
			string prompt = spec.Prompt;
			IReadOnlyList<string>? userAttachedFilePaths = spec.AttachedFiles ?? Array.Empty<string>();
			string? userMemoryMarkdown = spec.UserMemory;
			string clickySlug2 = task.ClickySlug;
			IReadOnlyList<string> routineLines;
			if (clickySlug2 == null)
			{
				if (jobId != null)
				{
					string jobId2 = jobId;
					routineLines = routines.PromptLinesForJob(jobId2);
				}
				else
				{
					IReadOnlyList<string> readOnlyList = Array.Empty<string>();
					routineLines = readOnlyList;
				}
			}
			else
			{
				routineLines = routines.PromptLines(clickySlug2);
			}
			string text4 = TurnPromptBuilder.Build(new TurnPromptBuilder.Input(launchContext, prompt, imagePaths, userAttachedFilePaths, workspace, userMemoryMarkdown, routineLines, spec.IsGeneratedBrief, spec.LaunchSource, isNewThread ? null : clickys.InstructionsToCarry(threadId, home.DeliveredModelInstructions), spec.PriorTurns)
			{
				IsJob = flag2,
				UserProfileFilePath = (flag2 ? ClickyHelperFiles.WriteUserProfile(spec.UserMemory) : null),
				LearnedHowTosSection = (flag3 ? text3 : ""),
				LiveNoteSection = (flag2 ? "\nIMPORTANT — THIS JOB'S PLAN\nYour plan tool (update_plan) is the job's progress bar: the user watches it while you work. First thing, in the same response as your first searches, call it with 3 to 5 steps of a few words each (under 40 characters: the card has one short line for each). The steps are the stages of the work in the order they will happen, each one a stage the user would recognize (\"Find where each is sold\", \"Check stock in San Francisco\", \"Compare the prices\", \"Build the PDF\"), never your own housekeeping (reading notes, files or memory about them, setting up, saving). Things you look into side by side go in one step together, so every step finishes before the next one starts. Keep exactly one step in progress; when it is done, mark it completed and the next one in progress. Never send an update on its own: put it in the same response as your next search, read or command. A long step (building a file, checking its pages) stays in progress while you're on it. Don't tick the last step: HeyClicky ticks it when your answer arrives. On a later message, plan just that message's work. There is no note to write: the answer goes in your final message." : ClickyLiveNoteSection(task, spec.Prompt, spec.LaunchSource, spec.IsGeneratedBrief, threadId, threadIsActive: false)),
				IsClickyDriveAvailable = (IsClickyDriveAvailable?.Invoke() ?? false)
			});
			if (flag3)
			{
				StandingContextLedger.RecordCarried(new Dictionary<StandingContextLedger.Section, string> { [StandingContextLedger.Section.LearnedHowTos] = text3 }, threadId);
			}
			(string, string)? tuple2;
			if (tokens.AllowsDeveloperModelSelection)
			{
				string clickySlug3 = task.ClickySlug;
				if (clickySlug3 != null)
				{
					tuple2 = DeveloperModelSelection?.Invoke(clickySlug3);
					goto IL_0c63;
				}
			}
			tuple2 = null;
			goto IL_0c63;
			IL_0c63:
			(string, string)? tuple3 = tuple2;
			lock (task.Gate)
			{
				task.DeveloperModel = tuple3;
			}
			if (tuple3.HasValue)
			{
				(string, string) valueOrDefault2 = tuple3.GetValueOrDefault();
				Log.Info("Agents", $"task {task.Id}: developer model {valueOrDefault2.Item1} / {valueOrDefault2.Item2}");
			}
			JsonArray jsonArray = new JsonArray
			{
				new JsonObject
				{
					["type"] = "text",
					["text"] = WithLeaseMarker(text4, lease, task, threadId)
				}
			};
			foreach (string item in imagePaths)
			{
				jsonArray.Add(new JsonObject
				{
					["type"] = "localImage",
					["path"] = item
				});
			}
			TaskCompletionSource<string> completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
			lock (task.Gate)
			{
				task.TurnCompletion = completion;
				task.Status = AgentTaskStatus.Running;
				task.ProgressSummary = "Sending your message…";
			}
			Raise(task, AgentTaskEventKind.StatusChanged, "Running");
			RaiseTasksChanged();
			if (!harness.HasValue)
			{
				await session.StartTurnAsync(task, threadId, jsonArray, isNewThread ? null : cwd, tuple3?.Item1 ?? options.Model, tuple3?.Item2 ?? options.ReasoningEffort, LeaseMetadata(lease, task, threadId), ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			else
			{
				(AgentHarness, AgentHarnessPlace) valueOrDefault3 = harness.GetValueOrDefault();
				CodexSession codexSession = session;
				string appThreadId = threadId;
				bool isNewAppThread = isNewThread;
				JsonObject? jsonObject = LeaseMetadata(lease, task, threadId);
				codexSession.StartHarnessTurn(valueOrDefault3, task, appThreadId, isNewAppThread, text4, imagePaths, cwd, (jsonObject != null) ? jsonObject.ToDictionary((KeyValuePair<string, JsonNode> kv) => kv.Key, (KeyValuePair<string, JsonNode> kv) => kv.Value?.ToString() ?? "") : null, HarnessTurnContextAsync, ct);
			}
			lock (task.Gate)
			{
				task.TurnStartedTimestamp = Stopwatch.GetTimestamp();
				launchToTurnStartedMs = (long)Stopwatch.GetElapsedTime(task.LaunchTimestamp).TotalMilliseconds;
			}
			Log.Info("Agents", $"task {task.Id} turn started on thread {threadId} ({launchToTurnStartedMs} ms after launch)");
			using CancellationTokenSource leasePoll = (((object)lease == null) ? null : CancellationTokenSource.CreateLinkedTokenSource(ct));
			if (leasePoll != null)
			{
				PollLeaseAsync(task, lease, leasePoll.Token);
			}
			await completion.Task.ConfigureAwait(continueOnCapturedContext: false);
			leasePoll?.Cancel();
		}
		finally
		{
			bool holdsSlot;
			lock (task.Gate)
			{
				holdsSlot = task.HoldsSlot;
				task.HoldsSlot = false;
			}
			if (holdsSlot)
			{
				slots.Release();
			}
		}
	}

	private void BindNewThread(AgentTask task, string threadId)
	{
		string clickySlug;
		string jobId;
		lock (task.Gate)
		{
			clickySlug = task.ClickySlug;
			jobId = task.JobId;
		}
		if (clickySlug != null)
		{
			clickys.BindThread(clickySlug, threadId);
		}
		else if (jobId != null)
		{
			Jobs.RecordThreadId(threadId, jobId);
		}
	}

	private async Task PollLeaseAsync(AgentTask task, AgentTurnLease lease, CancellationToken ct)
	{
		while (!ct.IsCancellationRequested)
		{
			try
			{
				await Task.Delay(3000, ct).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (OperationCanceledException)
			{
				break;
			}
			try
			{
				string text = await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false);
				if (text == null)
				{
					continue;
				}
				AgentTurnLease agentTurnLease = await api.LeaseStatusAsync(text, lease.LeaseId, ct).ConfigureAwait(continueOnCapturedContext: false);
				if ((object)agentTurnLease == null)
				{
					continue;
				}
				lock (task.Gate)
				{
					task.Lease = agentTurnLease;
				}
				if (!agentTurnLease.RequiresExtraEffort)
				{
					continue;
				}
				lock (task.Gate)
				{
					task.RequiresExtraUsageApproval = true;
				}
				session.Interrupt(task, TurnOutcome.ExtraEffortRequired, "This task requires extra effort");
				break;
			}
			catch (OperationCanceledException)
			{
				break;
			}
			catch (Exception ex3)
			{
				Log.Warn("Agents", "lease status poll: " + ex3.Message);
			}
		}
	}

	private void OnTurnEnded(AgentTask task, TurnOutcome outcome, string? message)
	{
		NotifyBrowserTurnEnded(task, outcome);
		string text;
		AgentTaskEventKind kind;
		string text2;
		string text3;
		string clickySlug;
		string jobId;
		string text5;
		lock (task.Gate)
		{
			text = task.FinishStreamingCommentary(task.CurrentNarrationItemId);
			switch (outcome)
			{
			case TurnOutcome.Completed:
			{
				StructuredFinalReply structuredFinalReply = StructuredFinalReply.Parse(task.ResponseAccumulator.ToString().Trim());
				task.FinalResponseMarkdown = ((structuredFinalReply.Text.Length > 0) ? structuredFinalReply.Text : null);
				task.Summary = structuredFinalReply.SummaryOrFallback;
				task.NextActions = structuredFinalReply.NextActions;
				task.DoneTitle = structuredFinalReply.DoneTitle;
				task.Artifacts = structuredFinalReply.Artifacts;
				task.Answer = structuredFinalReply.Answer;
				task.PendingUserStep = structuredFinalReply.UserStep;
				task.LearnedHowTos = structuredFinalReply.LearnedHowTos ?? Array.Empty<string>();
				string text4 = TakeUnansweredComputerUseStep?.Invoke(task.Id);
				task.PendingComputerUseRequest = structuredFinalReply.ComputerUseRequest ?? text4 ?? task.PendingComputerUseRequest;
				task.Status = AgentTaskStatus.Finished;
				task.ProgressSummary = "Done";
				kind = AgentTaskEventKind.Finished;
				text2 = task.Summary;
				text3 = ((task.PendingComputerUseRequest == null) ? "completed" : "");
				break;
			}
			case TurnOutcome.ExtraEffortRequired:
				task.Status = AgentTaskStatus.WaitingForUser;
				task.RequiresExtraUsageApproval = true;
				task.ProgressSummary = "Needs your OK to keep going";
				kind = AgentTaskEventKind.NeedsExtraUsageApproval;
				text2 = "This task needs more effort than one agent message covers.";
				text3 = "";
				break;
			case TurnOutcome.Interrupted:
				task.Status = AgentTaskStatus.Stopped;
				task.ProgressSummary = message ?? "Stopped.";
				kind = AgentTaskEventKind.Stopped;
				text2 = message;
				text3 = "interrupted";
				break;
			default:
			{
				task.Status = AgentTaskStatus.Failed;
				task.FailureMessage = message ?? "Agent thread failed.";
				AgentTask agentTask = task;
				if ((object)agentTask.Error == null)
				{
					CompanionError companionError = (agentTask.Error = new CompanionError((outcome == TurnOutcome.Disconnected) ? "agent_disconnected" : "agent_failed", task.FailureMessage));
				}
				task.ProgressSummary = task.FailureMessage;
				kind = AgentTaskEventKind.Failed;
				text2 = task.FailureMessage;
				text3 = "failed";
				break;
			}
			}
			if (task.TurnStartedTimestamp != 0L)
			{
				launchToFinishedMs = (long)Stopwatch.GetElapsedTime(task.LaunchTimestamp).TotalMilliseconds;
				if (task.FirstTokenTimestamp != 0L)
				{
					launchToFirstTokenMs = (long)((double)(task.FirstTokenTimestamp - task.LaunchTimestamp) * 1000.0 / (double)Stopwatch.Frequency);
				}
			}
			clickySlug = task.ClickySlug;
			jobId = task.JobId;
			text5 = task.Summary ?? task.FailureMessage;
		}
		Log.Info("Agents", $"task {task.Id} turn ended: {outcome}{((message == null) ? "" : (" (" + message + ")"))}");
		if (outcome == TurnOutcome.Failed && ComposioTurnErrors.IsListingFailure(message ?? text5))
		{
			Log.Info("Agents", "the turn couldn't list the Composio tools: the next turn fetches a fresh Composio session");
			InvalidateConnectedApps();
		}
		if (text != null)
		{
			Raise(task, AgentTaskEventKind.Commentary, text);
		}
		if (clickySlug != null || jobId != null)
		{
			RoutineScheduler routineScheduler = routines;
			string clickySlug2 = clickySlug;
			string jobId2 = jobId;
			string id = task.Id;
			string summary = text5;
			bool failed = outcome != TurnOutcome.Completed;
			bool interrupted = ((outcome == TurnOutcome.Interrupted || outcome == TurnOutcome.Disconnected) ? true : false);
			routineScheduler.NoteTaskEnded(clickySlug2, jobId2, id, summary, failed, interrupted, outcome == TurnOutcome.ExtraEffortRequired);
		}
		switch (outcome)
		{
		case TurnOutcome.Completed:
			NoteJobTaskEnded(task, ClickyJobOutcome.Done, text5);
			break;
		case TurnOutcome.Interrupted:
			NoteJobTaskEnded(task, ClickyJobOutcome.Stopped, message);
			break;
		case TurnOutcome.Failed:
		case TurnOutcome.Disconnected:
			NoteJobTaskEnded(task, ClickyJobOutcome.Failed, text5);
			break;
		}
		if (outcome != TurnOutcome.ExtraEffortRequired && Lock(task, () => task.JobId != null))
		{
			string text6 = LiveStepsKey(task);
			if (text6 != null)
			{
				LiveSteps.Clear(text6);
			}
		}
		if (outcome == TurnOutcome.Completed)
		{
			NoteClickyAppWorkFinished(task);
		}
		SyncPendingRequest(task);
		Raise(task, kind, text2);
		if (outcome == TurnOutcome.Completed)
		{
			string threadId;
			lock (task.Gate)
			{
				threadId = task.ThreadId;
			}
			LogAgentMessage(task, threadId, "assistant", text5, isFollowUp: false);
		}
		if (text3.Length > 0)
		{
			CompleteLeaseInBackground(task, text3);
		}
		task.TurnCompletion?.TrySetResult(outcome.ToString());
		RaiseTasksChanged();
	}

	private void FailLaunch(AgentTask task, Exception ex)
	{
		bool flag = ex is OperationCanceledException;
		CompanionError companionError;
		if (ex is AgentPaywallException ex2)
		{
			companionError = ex2.Error;
		}
		else if (ex is OperationCanceledException)
		{
			companionError = new CompanionError("agent_cancelled", "Agent cancelled.");
		}
		else if (ex is CodexStartupTimeoutException ex3)
		{
			companionError = new CompanionError("agent_startup_timeout", ex3.Message);
		}
		else if (ex is FileNotFoundException ex4)
		{
			companionError = new CompanionError("agent_runtime_missing", ex4.Message);
		}
		else if (ex is AgentBackendException ex5)
		{
			companionError = new CompanionError("agent_backend_error", ex5.Message, ex5.BodyJson);
		}
		else
		{
			companionError = ((!(ex is HttpRequestException)) ? new CompanionError("agent_launch_failed", ex.Message) : new CompanionError("agent_offline", ex.Message));
		}
		CompanionError companionError2 = companionError;
		if (ex is AgentPaywallException ex6)
		{
			InterruptForPaywall(task, ex6.Error);
			return;
		}
		if (!flag)
		{
			Log.Error("Agents", "task " + task.Id + " launch failed", ex);
		}
		FlushPendingInitialMessageLog(task, Lock(task, () => task.ThreadId));
		string clickySlug;
		string jobId;
		lock (task.Gate)
		{
			if (!task.IsActive)
			{
				return;
			}
			task.Status = (flag ? AgentTaskStatus.Stopped : AgentTaskStatus.Failed);
			task.FailureMessage = (flag ? null : companionError2.Message);
			task.Error = (flag ? null : companionError2);
			task.ProgressSummary = (flag ? "Stopped." : companionError2.Message);
			clickySlug = task.ClickySlug;
			jobId = task.JobId;
		}
		NoteJobTaskEnded(task, flag ? ClickyJobOutcome.Stopped : ClickyJobOutcome.Failed, companionError2.Message);
		Raise(task, flag ? AgentTaskEventKind.Stopped : AgentTaskEventKind.Failed, companionError2.Message);
		CompleteLeaseInBackground(task, flag ? "interrupted" : "failed");
		if (clickySlug != null || jobId != null)
		{
			RoutineScheduler routineScheduler = routines;
			string clickySlug2 = clickySlug;
			string jobId2 = jobId;
			string id = task.Id;
			string message = companionError2.Message;
			bool interrupted = flag;
			bool transientConnectivityFailure = ((ex is HttpRequestException || (ex is TaskCanceledException && ex.InnerException is TimeoutException)) ? true : false);
			routineScheduler.NoteTaskEnded(clickySlug2, jobId2, id, message, failed: true, interrupted, awaitingExtraUsage: false, transientConnectivityFailure);
		}
		task.TurnCompletion?.TrySetResult("failed");
		RaiseTasksChanged();
	}

	private void InterruptForPaywall(AgentTask task, CompanionError error)
	{
		Log.Info("Agents", "task " + task.Id + " hit the paywall before Codex submit");
		FlushPendingInitialMessageLog(task, Lock(task, () => task.ThreadId));
		string clickySlug;
		string jobId;
		lock (task.Gate)
		{
			if (!task.IsActive)
			{
				return;
			}
			task.Status = AgentTaskStatus.Stopped;
			task.FailureMessage = "Oops, you're out of tokens! Beef up HeyClicky to continue.";
			task.Error = error;
			task.ProgressSummary = "Oops, you're out of tokens! Beef up HeyClicky to continue.";
			clickySlug = task.ClickySlug;
			jobId = task.JobId;
		}
		NoteJobTaskEnded(task, ClickyJobOutcome.Stopped, "Oops, you're out of tokens! Beef up HeyClicky to continue.");
		Raise(task, AgentTaskEventKind.Stopped, "Oops, you're out of tokens! Beef up HeyClicky to continue.");
		CompleteLeaseInBackground(task, "interrupted");
		if (clickySlug != null || jobId != null)
		{
			string text = PaywallReason(error);
			bool flag = ((text == null || text == "quota_exceeded") ? true : false);
			bool hitAgentMessageLimit = flag;
			routines.NoteTaskEnded(clickySlug, jobId, task.Id, "Oops, you're out of tokens! Beef up HeyClicky to continue.", failed: true, interrupted: true, PaywallReason(error) != "payment_problem", transientConnectivityFailure: false, hitAgentMessageLimit);
		}
		task.TurnCompletion?.TrySetResult("failed");
		RaiseTasksChanged();
	}

	private static string? PaywallReason(CompanionError error)
	{
		JsonElement? paywall = error.Paywall;
		if (paywall.HasValue)
		{
			JsonElement valueOrDefault = paywall.GetValueOrDefault();
			if (valueOrDefault.ValueKind == JsonValueKind.Object && valueOrDefault.TryGetProperty("reason", out var value) && value.ValueKind == JsonValueKind.String)
			{
				return value.GetString();
			}
		}
		return null;
	}

	private void RaisePaywall(AgentBackendException ex, bool presents)
	{
		try
		{
			PaywallReached?.Invoke(this, new AgentPaywallEventArgs(ex.StatusCode, ex.Body, presents));
		}
		catch (Exception ex2)
		{
			Log.Error("Agents", "PaywallReached handler threw", ex2);
		}
	}

	private void LogAgentMessage(AgentTask task, string? threadId, string role, string? content, bool isFollowUp)
	{
		string trimmed = content?.Trim();
		if (string.IsNullOrEmpty(trimmed))
		{
			return;
		}
		bool isDemo;
		long? suggestionId;
		lock (task.Gate)
		{
			isDemo = task.IsDemo;
			suggestionId = task.ProactiveSuggestionId;
		}
		Task.Run(async () =>
		{
			_ = 1;
			try
			{
				string text = await supabaseAccessToken(CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
				if (text != null)
				{
					await api.LogAgentMessageAsync(text, threadId, role, trimmed, isFollowUp, isDemo, suggestionId, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
					Log.Info("Agents", $"agent message logged: {role}{(isFollowUp ? " (follow-up)" : "")} thread={threadId ?? "none"}");
				}
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "agent message log (" + role + ") failed: " + ex.Message);
			}
		});
	}

	private void FlushPendingInitialMessageLog(AgentTask task, string? threadId)
	{
		string pendingInitialMessageLog;
		lock (task.Gate)
		{
			pendingInitialMessageLog = task.PendingInitialMessageLog;
			task.PendingInitialMessageLog = null;
		}
		if (pendingInitialMessageLog != null)
		{
			LogAgentMessage(task, threadId, "user", pendingInitialMessageLog, isFollowUp: false);
		}
	}

	private void CompleteLeaseInBackground(AgentTask task, string status)
	{
		AgentTurnLease lease;
		string threadId;
		lock (task.Gate)
		{
			lease = task.Lease;
			threadId = task.ThreadId;
		}
		if ((object)lease == null)
		{
			return;
		}
		Task.Run(async () =>
		{
			_ = 1;
			try
			{
				string text = await supabaseAccessToken(CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
				if (text != null)
				{
					await api.CompleteLeaseAsync(text, lease.LeaseId, status, threadId, CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
				}
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "lease complete failed: " + ex.Message);
			}
		});
	}

	private async Task<string> TitleAsync(string prompt, CancellationToken ct)
	{
		_ = 1;
		try
		{
			string text = await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false);
			bool flag = text != null;
			string t = default;
			if (flag)
			{
				t = await api.ThreadTitleAsync(text, (prompt.Length > 2000) ? prompt.Substring(0, 2000) : prompt, ct).ConfigureAwait(continueOnCapturedContext: false);
				flag = t != null;
			}
			if (flag)
			{
				return t;
			}
		}
		catch (Exception ex) when (!(ex is OperationCanceledException) || !ct.IsCancellationRequested)
		{
			Log.Warn("Agents", "thread title failed: " + ex.Message);
		}
		string text2 = new string(prompt.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Where(char.IsLetterOrDigit).ToArray() ?? Array.Empty<char>());
		string result;
		if (text2.Length != 0)
		{
			ReadOnlySpan<char> readOnlySpan = new ReadOnlySpan<char>(char.ToUpperInvariant(text2[0]));
			string text3 = text2;
			result = string.Concat(readOnlySpan, text3.Substring(1, text3.Length - 1).ToLowerInvariant(), " Buddy");
		}
		else
		{
			result = "Clicky Buddy";
		}
		return result;
	}

	private async Task<string?> FetchMemoryAsync(CancellationToken ct)
	{
		string userId = CurrentUserId?.Invoke();
		try
		{
			string text = await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false);
			if (text == null)
			{
				return userMemory.Resolve(userId, UserMemoryFetchStatus.Failed, null);
			}
			var (status, markdown) = await api.UserMemoryAsync(text, ct).ConfigureAwait(continueOnCapturedContext: false);
			return userMemory.Resolve(userId, status, markdown);
		}
		catch (Exception) when (!ct.IsCancellationRequested)
		{
			return userMemory.Resolve(userId, UserMemoryFetchStatus.Failed, null);
		}
		catch (Exception)
		{
			return null;
		}
	}

	private async Task<string> RequireSupabaseTokenAsync(CancellationToken ct)
	{
		return (await supabaseAccessToken(ct).ConfigureAwait(continueOnCapturedContext: false)) ?? throw new InvalidOperationException("Sign in to HeyClicky to use agents.");
	}

	private static string OneLinerFrom(string prompt)
	{
		string text = string.Join(' ', prompt.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
		int num = text.IndexOfAny(new char[3] { '.', '?', '!' });
		if (num > 0)
		{
			text = text.Substring(0, num);
		}
		if (text.Length <= 120)
		{
			return text;
		}
		return text.Substring(0, 120);
	}

	private static string WithLeaseMarker(string message, AgentTurnLease? lease, AgentTask task, string threadId)
	{
		JsonObject jsonObject = LeaseMetadata(lease, task, threadId);
		if (jsonObject == null)
		{
			return message;
		}
		SortedDictionary<string, string> sortedDictionary = new SortedDictionary<string, string>(StringComparer.Ordinal);
		foreach (var (key, jsonNode2) in jsonObject)
		{
			sortedDictionary[key] = jsonNode2.ToString();
		}
		return "<clicky_agent_turn_lease_metadata>" + JsonSerializer.Serialize(sortedDictionary) + "</clicky_agent_turn_lease_metadata>\n" + message;
	}

	private static JsonObject? LeaseMetadata(AgentTurnLease? lease, AgentTask task, string threadId)
	{
		(string, string)? developerModel;
		lock (task.Gate)
		{
			developerModel = task.DeveloperModel;
		}
		if ((object)lease == null && !developerModel.HasValue)
		{
			return null;
		}
		JsonObject jsonObject = new JsonObject();
		if (developerModel.HasValue)
		{
			(string, string) valueOrDefault = developerModel.GetValueOrDefault();
			jsonObject["clicky_developer_model"] = valueOrDefault.Item1;
			jsonObject["clicky_developer_reasoning_effort"] = valueOrDefault.Item2;
		}
		if ((object)lease == null)
		{
			return jsonObject;
		}
		jsonObject["clicky_agent_turn_lease_id"] = lease.LeaseId;
		jsonObject["clicky_agent_turn_id"] = lease.TurnId;
		jsonObject["clicky_agent_thread_id"] = threadId;
		jsonObject["clicky_agent_task_id"] = task.NumericId.ToString("D").ToUpperInvariant();
		return jsonObject;
	}

	private static string PreviewText(string raw)
	{
		string text = raw.Trim();
		int num = text.IndexOf("User transcript:", StringComparison.OrdinalIgnoreCase);
		if (num >= 0)
		{
			string text2 = text;
			int num2 = num + "User transcript:".Length;
			string text3 = (from l in text2.Substring(num2, text2.Length - num2).Split('\n')
				select l.Trim()).FirstOrDefault((string l) => l.Length > 0);
			if (text3 != null)
			{
				return text3;
			}
		}
		if (text.Length != 0)
		{
			return text.Replace('\n', ' ');
		}
		return "Untitled agent thread";
	}

	private static string DisplayUserText(string raw)
	{
		int num = raw.LastIndexOf("User transcript:", StringComparison.Ordinal);
		string text;
		if (num < 0)
		{
			text = raw;
		}
		else
		{
			string text2 = raw;
			int num2 = num + "User transcript:".Length;
			text = text2.Substring(num2, text2.Length - num2);
		}
		string text3 = text;
		int num3 = text3.IndexOf("</clicky_agent_turn_lease_metadata>", StringComparison.Ordinal);
		if (num3 >= 0)
		{
			string text2 = text3;
			int num2 = num3 + "</clicky_agent_turn_lease_metadata>".Length;
			text3 = text2.Substring(num2, text2.Length - num2);
		}
		text3 = text3.Trim();
		if (num >= 0 && !text3.Contains("\nAttached files:\n", StringComparison.Ordinal))
		{
			List<string> list = (from p in (from l in raw.Substring(0, num).Split('\n')
					select l.Trim() into l
					where l.StartsWith("- File #", StringComparison.Ordinal) && l.IndexOf(": ", StringComparison.Ordinal) > 0
					select l).Select((string l) =>
				{
					int num4 = l.IndexOf(": ", StringComparison.Ordinal) + 2;
					return l.Substring(num4, l.Length - num4).Trim();
				})
				where p.Length > 0
				select p).ToList();
			if (list.Count > 0)
			{
				text3 = (text3 + "\n\nAttached files:\n" + string.Join("\n", list.Select((string f) => "- " + f))).TrimStart();
			}
		}
		return text3;
	}

	private static DateTimeOffset? Timestamp(JsonNode? node)
	{
		if (!(node is JsonValue jsonValue))
		{
			return null;
		}
		if (jsonValue.TryGetValue<double>(out var value))
		{
			return (value > 100000000000.0) ? DateTimeOffset.FromUnixTimeMilliseconds((long)value) : DateTimeOffset.FromUnixTimeSeconds((long)value);
		}
		if (!DateTimeOffset.TryParse(jsonValue.ToString(), out var result))
		{
			return null;
		}
		return result;
	}

	private AgentTask GetTask(string taskId)
	{
		if (!tasks.TryGetValue(taskId, out AgentTask value))
		{
			throw new KeyNotFoundException("No agent task " + taskId + ".");
		}
		return value;
	}

	private static T Lock<T>(AgentTask t, Func<T> f)
	{
		lock (t.Gate)
		{
			return f();
		}
	}

	private void SetProgress(AgentTask task, string summary)
	{
		lock (task.Gate)
		{
			task.ProgressSummary = summary;
		}
		Raise(task, AgentTaskEventKind.ProgressChanged, summary);
	}

	private void Raise(AgentTask task, AgentTaskEventKind kind, string? text)
	{
		if (kind == AgentTaskEventKind.ThinkingHeading && text != null && text.Length > 0)
		{
			string text2 = LiveStepsKey(task);
			if (text2 != null)
			{
				LiveSteps.NoteThinking(text, text2);
			}
		}
		try
		{
			TaskEvent?.Invoke(this, new AgentTaskEvent(task.Id, kind, text));
		}
		catch (Exception ex)
		{
			Log.Error("Agents", "TaskEvent handler threw", ex);
		}
		bool flag;
		switch (kind)
		{
		case AgentTaskEventKind.ProgressChanged:
		case AgentTaskEventKind.Commentary:
		case AgentTaskEventKind.TitleChanged:
		case AgentTaskEventKind.PlanUpdated:
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			RaiseTasksChanged();
		}
	}

	private void RaiseTasksChanged()
	{
		if (Interlocked.Exchange(ref tasksChangedPending, 1) == 1)
		{
			return;
		}
		Task.Delay(50).ContinueWith((Task _) =>
		{
			Volatile.Write(ref tasksChangedPending, 0);
			try
			{
				TasksChanged?.Invoke(this, EventArgs.Empty);
			}
			catch (Exception ex)
			{
				Log.Error("Agents", "TasksChanged handler threw", ex);
			}
		}, TaskScheduler.Default);
	}

	public async ValueTask DisposeAsync()
	{
		if (disposed)
		{
			return;
		}
		disposed = true;
		maintenanceTimer.Dispose();
		routines.Dispose();
		foreach (AgentTask item in tasks.Values.ToList())
		{
			session.Interrupt(item, TurnOutcome.Interrupted, "HeyClicky stopped before the agent task finished.");
		}
		lifetime.Cancel();
		await StopProcessAsync().ConfigureAwait(continueOnCapturedContext: false);
		lifetime.Dispose();
	}

	private string? LiveNotePath(AgentTask task)
	{
		string clickySlug;
		string workspacePath;
		bool isDemo;
		bool flag;
		lock (task.Gate)
		{
			clickySlug = task.ClickySlug;
			workspacePath = task.WorkspacePath;
			isDemo = task.IsDemo;
			flag = task.JobId != null;
		}
		IClickyLiveNoteTurns liveNotes = LiveNotes;
		if (((liveNotes == null) | isDemo | flag) || clickySlug == null)
		{
			return null;
		}
		return liveNotes.NotePath(clickySlug, workspacePath ?? "");
	}

	private string ClickyLiveNoteSection(AgentTask task, string prompt, string launchSource, bool isGeneratedBrief, string? threadId, bool threadIsActive)
	{
		IClickyLiveNoteTurns liveNotes = LiveNotes;
		if (liveNotes != null)
		{
			string text = LiveNotePath(task);
			if (text != null)
			{
				bool isRoutineRun;
				string title;
				lock (task.Gate)
				{
					isRoutineRun = task.IsRoutineRun;
					title = task.Title;
				}
				string userMessage = ((!isRoutineRun && !isGeneratedBrief && !threadIsActive && !(launchSource == "routine")) ? prompt : null);
				string routineRun = (isRoutineRun ? title : null);
				(AgentHarness, AgentHarnessPlace)? tuple = AgentHarnessRuntimes.Choice(threadId);
				int num;
				if (tuple.HasValue)
				{
					(AgentHarness, AgentHarnessPlace) valueOrDefault = tuple.GetValueOrDefault();
					num = ((!AgentHarnessPreferences.UsesNoteTools(valueOrDefault.Item1, valueOrDefault.Item2)) ? 1 : 2);
				}
				else
				{
					num = 0;
				}
				ClickyLiveNoteWriter writer = (ClickyLiveNoteWriter)num;
				try
				{
					return liveNotes.PromptSection(text, userMessage, routineRun, writer);
				}
				catch (Exception ex)
				{
					Log.Warn("Agents", "live note section: " + ex.Message);
					return "";
				}
			}
		}
		return "";
	}

	private void NoteLiveNoteTaskEnded(AgentTask task)
	{
		IClickyLiveNoteTurns liveNotes = LiveNotes;
		if (liveNotes == null)
		{
			return;
		}
		string text = LiveNotePath(task);
		if (text == null)
		{
			return;
		}
		try
		{
			liveNotes.TurnEnded(text);
		}
		catch (Exception ex)
		{
			Log.Warn("Agents", "live note turn end: " + ex.Message);
		}
	}

	private void NoteLiveNoteFileActivity(AgentTask task, string path, string? streamedKind, string? streamedDiff)
	{
		IClickyLiveNoteTurns liveNotes = LiveNotes;
		if (liveNotes == null)
		{
			return;
		}
		string text = LiveNotePath(task);
		if (text == null)
		{
			return;
		}
		try
		{
			liveNotes.FileActivity(text, path, streamedKind, streamedDiff);
		}
		catch (Exception ex)
		{
			Log.Warn("Agents", "live note file: " + ex.Message);
		}
	}

	public void PrewarmAgentHarnessIfSelected()
	{
		if (AgentHarnessPreferences.Harness != AgentHarness.H1 || AgentHarnessPreferences.Place != AgentHarnessPlace.Cloud || !AgentHarnessPreferences.UsesDeviceHelper)
		{
			return;
		}
		Task.Run(async () =>
		{
			_ = 1;
			try
			{
				string sessionToken = await tokens.GetAsync(lifetime.Token).ConfigureAwait(continueOnCapturedContext: false);
				await AgentHarnessRunnerRuntime.PrewarmAsync(AgentHarness.H1, AgentHarnessPlace.Cloud, WorkerBase, sessionToken).ConfigureAwait(continueOnCapturedContext: false);
			}
			catch (Exception ex)
			{
				Log.Warn("Harness", "prewarm: " + ex.Message);
			}
		});
	}

	private void ConfigureAgentHarness()
	{
		AgentHarnessRunnerProcess.StateDirectory = Path.Combine(options.StateDirectory, "AgentHarness");
		AgentHarnessRunnerProcess.BundledRunnerDirectory = options.HarnessRuntimeDirectory;
		AgentHarnessRunnerProcess.InternalError += (string subsystem, string stage, string detail, string key) =>
		{
			RaiseInternalError(subsystem, stage, detail, key);
		};
		session.OnHarnessTurnEnded = (AgentHarness harness, AgentHarnessPlace place, string status, double seconds, IReadOnlyDictionary<string, double> stats) =>
		{
			try
			{
				HarnessTurnEnded?.Invoke(harness.RawValue(), place.RawValue(), status, seconds, stats);
			}
			catch (Exception ex)
			{
				Log.Warn("Harness", "HarnessTurnEnded handler threw: " + ex.Message);
			}
		};
		session.OnHarnessInternalError = (string stage, string detail, string key) =>
		{
			RaiseInternalError("agent_harness", stage, detail, key);
		};
	}

	private void RaiseInternalError(string subsystem, string stage, string detail, string key)
	{
		try
		{
			InternalError?.Invoke(subsystem, stage, detail, key);
		}
		catch (Exception ex)
		{
			Log.Warn("Harness", "InternalError handler threw: " + ex.Message);
		}
	}

	private async Task<(AgentHarness Harness, AgentHarnessPlace Place)?> HarnessForNewConversationAsync(CancellationToken ct)
	{
		(AgentHarness Harness, AgentHarnessPlace Place)? choice = AgentHarnessRuntimes.Choice(null);
		bool flag = choice.HasValue && IsRuntimeReady;
		if (flag)
		{
			flag = !(await AgentHarnessRunnerProcess.IsAvailableForNewConversationAsync(ct).ConfigureAwait(continueOnCapturedContext: false));
		}
		if (flag)
		{
			return null;
		}
		return choice;
	}

	private async Task<AgentHarnessTurnContext> HarnessTurnContextAsync(string appThreadId, AgentTask task, string workingDirectory, CancellationToken ct)
	{
		await EnsureRuntimeReadyAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		string sessionToken = await tokens.GetAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		List<AgentHarnessMcpServer> servers = new List<AgentHarnessMcpServer>();
		string text = composio?.Url;
		if (text != null && text.Length > 0)
		{
			servers.Add(new AgentHarnessMcpServer("composio", text, sessionToken));
		}
		servers.AddRange(HarnessCustomConnectorServers());
		Func<CancellationToken, Task<AgentHarnessMcpServer>> browserMcpServerProvider = BrowserMcpServerProvider;
		if (browserMcpServerProvider != null)
		{
			try
			{
				AgentHarnessMcpServer agentHarnessMcpServer = await browserMcpServerProvider(ct).ConfigureAwait(continueOnCapturedContext: false);
				if ((object)agentHarnessMcpServer != null)
				{
					servers.Add(agentHarnessMcpServer with
					{
						SendsTurnIdentity = true
					});
				}
			}
			catch (Exception ex)
			{
				Log.Warn("Harness", "browser endpoint: " + ex.Message);
			}
		}
		bool flag;
		lock (task.Gate)
		{
			flag = task.JobId != null;
		}
		string text2 = (flag ? null : LiveNotePath(task));
		(AgentHarness, AgentHarnessPlace)? tuple = AgentHarnessRuntimes.Choice(appThreadId);
		AgentHarnessTurnContext agentHarnessTurnContext = new AgentHarnessTurnContext
		{
			Instructions = (home.DeliveredModelInstructions ?? ""),
			McpServers = servers,
			SkillDirectories = HarnessSkillDirectories(),
			WorkerBaseUrl = WorkerBase,
			SessionToken = sessionToken,
			NotePath = text2,
			IsKeptThing = (text2 != null && !flag)
		};
		int writesNoteWithTools;
		if (text2 != null && tuple.HasValue)
		{
			(AgentHarness, AgentHarnessPlace) valueOrDefault = tuple.GetValueOrDefault();
			writesNoteWithTools = (AgentHarnessPreferences.UsesNoteTools(valueOrDefault.Item1, valueOrDefault.Item2) ? 1 : 0);
		}
		else
		{
			writesNoteWithTools = 0;
		}
		agentHarnessTurnContext.WritesNoteWithTools = (byte)writesNoteWithTools != 0;
		agentHarnessTurnContext.UsesPlanTool = flag;
		return agentHarnessTurnContext;
	}

	private IReadOnlyList<AgentHarnessMcpServer> HarnessCustomConnectorServers()
	{
		List<AgentHarnessMcpServer> list = new List<AgentHarnessMcpServer>();
		Uri result = default;
		foreach (CustomConnectorRegistration customConnector in customConnectors)
		{
			CustomConnectorTransport.Remote remote = customConnector.Transport as CustomConnectorTransport.Remote;
			bool flag = (object)remote == null || !Uri.TryCreate(remote.Url.Trim(), UriKind.Absolute, out result);
			string key;
			if (!flag)
			{
				key = result.Scheme;
				bool flag2 = ((key == "https" || key == "http") ? true : false);
				flag = !flag2;
			}
			if (flag)
			{
				continue;
			}
			string bearerTokenEnvironmentVariable = remote.BearerTokenEnvironmentVariable;
			string bearerToken = ((bearerTokenEnvironmentVariable != null && customConnector.Environment.TryGetValue(bearerTokenEnvironmentVariable, out string value) && value.Length > 0) ? value : null) ?? CodexStoredConnectorToken?.Invoke(result, customConnector.ServerKey);
			Dictionary<string, string> dictionary = new Dictionary<string, string>();
			foreach (KeyValuePair<string, string> headerEnvironmentVariable in remote.HeaderEnvironmentVariables)
			{
				headerEnvironmentVariable.Deconstruct(out key, out var value2);
				string key2 = key;
				string key3 = value2;
				if (customConnector.Environment.TryGetValue(key3, out string value3))
				{
					dictionary[key2] = value3;
				}
			}
			list.Add(new AgentHarnessMcpServer(customConnector.ServerKey, result.AbsoluteUri, bearerToken)
			{
				Headers = dictionary
			});
		}
		return list;
	}

	private IReadOnlyList<string> HarnessSkillDirectories()
	{
		List<string> list = new List<string>();
		string[] array = new string[2] { "skills", "power-up-skills" };
		foreach (string path in array)
		{
			string path2 = Path.Combine(options.CodexHome, path);
			if (!Directory.Exists(path2))
			{
				continue;
			}
			foreach (string item in Directory.GetDirectories(path2).OrderBy((string d) => Path.GetFileName(d), StringComparer.Ordinal))
			{
				if (!Path.GetFileName(item).StartsWith('.') && File.Exists(Path.Combine(item, "SKILL.md")))
				{
					list.Add(item);
				}
			}
		}
		return list;
	}

	public ClickyInfo? RenameClicky(string slug, string name)
	{
		ClickyInfo clickyInfo = clickys.Rename(slug, name);
		if ((object)clickyInfo == null)
		{
			return null;
		}
		foreach (AgentTask item in tasks.Values.Where((AgentTask t) => t.ClickySlug == slug))
		{
			lock (item.Gate)
			{
				item.ClickyName = clickyInfo.Name;
			}
		}
		RaiseTasksChanged();
		return clickyInfo;
	}

	public ClickyInfo? UnarchiveClicky(string slug)
	{
		ClickyInfo clickyInfo = clickys.Unarchive(slug);
		if ((object)clickyInfo != null)
		{
			clickys.EnsureWorkspace(clickyInfo);
		}
		RaiseTasksChanged();
		return clickyInfo;
	}

	public bool IsThreadOwnedByClicky(string threadId)
	{
		return clickys.OwnsThread(threadId);
	}

	public bool MoveThreadIntoClicky(string threadId, string slug, string? notesMarkdown)
	{
		ClickyInfo clickyInfo = clickys.Get(slug);
		if ((object)clickyInfo == null || clickyInfo.IsArchived || clickys.OwnsThread(threadId))
		{
			return false;
		}
		clickys.EnsureWorkspace(clickyInfo);
		bool flag = clickyInfo.ThreadId == null;
		if (flag)
		{
			clickys.BindThread(slug, threadId);
		}
		else
		{
			clickys.FileThread(threadId, slug);
		}
		if (!string.IsNullOrWhiteSpace(notesMarkdown))
		{
			clickys.AppendNotes(clickyInfo, notesMarkdown);
		}
		RebindTasksForThread(threadId, clickys.Get(slug));
		Log.Info("Agents", $"moved thread {threadId.Substring(0, Math.Min(8, threadId.Length))} into {slug} (became chat: {flag})");
		RaiseTasksChanged();
		return flag;
	}

	public ClickyInfo? FoundClickyFromThread(string threadId, string name, string roleText, string oneLiner, string? notesMarkdown)
	{
		if (clickys.OwnsThread(threadId))
		{
			return null;
		}
		ClickyInfo clickyInfo = CreateClicky(name, string.IsNullOrWhiteSpace(roleText) ? "Agent" : roleText, oneLiner);
		clickys.BindThread(clickyInfo.Slug, threadId);
		if (!string.IsNullOrWhiteSpace(notesMarkdown))
		{
			clickys.AppendNotes(clickyInfo, notesMarkdown);
		}
		ClickyInfo clickyInfo2 = clickys.Get(clickyInfo.Slug);
		RebindTasksForThread(threadId, clickyInfo2);
		Log.Info("Agents", "founded " + clickyInfo2.Slug + " from thread " + threadId.Substring(0, Math.Min(8, threadId.Length)));
		RaiseTasksChanged();
		return clickyInfo2;
	}

	public void AppendClickyNotes(string slug, string markdown)
	{
		ClickyInfo clickyInfo = clickys.Get(slug);
		if ((object)clickyInfo != null)
		{
			clickys.AppendNotes(clickyInfo, markdown);
		}
	}

	public string? ClickyNotesPath(string slug)
	{
		if ((object)clickys.Get(slug) != null)
		{
			return clickys.NotesPath(slug);
		}
		return null;
	}

	private void RebindTasksForThread(string threadId, ClickyInfo clicky)
	{
		foreach (AgentTask item in tasks.Values.Where((AgentTask t) => t.ThreadId == threadId))
		{
			lock (item.Gate)
			{
				item.ClickySlug = clicky.Slug;
				item.ClickyName = clicky.Name;
				item.WorkspacePath = clickys.WorkspacePath(clicky.Slug);
			}
		}
	}

	public async Task<bool> StopRuntimeIfIdleAsync()
	{
		if (Busy() || !IsRuntimeReady)
		{
			return false;
		}
		await runtimeGate.WaitAsync().ConfigureAwait(continueOnCapturedContext: false);
		try
		{
			if (Busy() || !IsRuntimeReady)
			{
				return false;
			}
			runtimeParkedIdle = true;
			await StopProcessAsync().ConfigureAwait(continueOnCapturedContext: false);
		}
		finally
		{
			runtimeGate.Release();
		}
		Log.Info("Agents", "runtime stopped: the HUD's last agent was dismissed and nothing is running");
		return true;
		bool Busy()
		{
			if (session.ActiveTurnCount <= 0)
			{
				return tasks.Values.Any((AgentTask t) =>
				{
					lock (t.Gate)
					{
						return t.IsActive;
					}
				});
			}
			return true;
		}
	}

	private async Task RefreshConnectorTokensBeforePrepareAsync(CancellationToken ct)
	{
		Func<CancellationToken, Task<IReadOnlyList<CustomConnectorRegistration>>> refreshCustomConnectorTokensAsync = RefreshCustomConnectorTokensAsync;
		if (refreshCustomConnectorTokensAsync == null)
		{
			return;
		}
		try
		{
			IReadOnlyList<CustomConnectorRegistration> readOnlyList = await refreshCustomConnectorTokensAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
			if (readOnlyList != null)
			{
				customConnectors = readOnlyList;
				configDirty = true;
			}
		}
		catch (Exception ex)
		{
			Log.Warn("Agents", "connector token refresh: " + ex.Message);
		}
	}

	private void WireIntegrationEvents()
	{
		session.OnMcpOAuthLoginCompleted = (string server, bool ok, string? error) =>
		{
			McpOAuthLoginCompleted?.Invoke(server, ok, error);
		};
		session.OnMcpServerStartupStatus = (string server, string status, string? error) =>
		{
			McpServerStartupStatus?.Invoke(server, status, error);
		};
		session.OnIntegrationUsed = (AgentTask task, string key) =>
		{
			string clickySlug;
			bool flag;
			lock (task.Gate)
			{
				clickySlug = task.ClickySlug;
				flag = task.IntegrationsUsedThisTurn.Add(key);
			}
			if (clickySlug != null)
			{
				RecordDataSource(clickySlug, key);
			}
			if (flag)
			{
				Raise(task, AgentTaskEventKind.IntegrationUsed, key);
			}
		};
	}

	public async Task<string?> StartMcpOAuthLoginAsync(string serverKey, IReadOnlyList<string>? scopes, int timeoutSeconds, CancellationToken ct = default(CancellationToken))
	{
		await EnsureRuntimeReadyAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		return await session.StartMcpOAuthLoginAsync(serverKey, scopes, timeoutSeconds, ct).ConfigureAwait(continueOnCapturedContext: false);
	}

	public async Task<IReadOnlyDictionary<string, string>> ListMcpServerAuthStatusesAsync(CancellationToken ct = default(CancellationToken))
	{
		await EnsureRuntimeReadyAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		return await session.ListMcpServerAuthStatusesAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
	}

	public async Task ReloadMcpServersAfterSignInAsync(CancellationToken ct = default(CancellationToken))
	{
		if (session.ActiveTurnCount == 0 || !IsRuntimeReady)
		{
			configDirty = true;
			await EnsureRuntimeReadyAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
			return;
		}
		try
		{
			await session.ReloadMcpServersAsync(ct).ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex)
		{
			Log.Warn("Agents", "config/mcpServer/reload failed: " + ex.Message);
			configDirty = true;
		}
	}

	public void SetObsidianVaultPath(string? path)
	{
		string text = (string.IsNullOrWhiteSpace(path) ? null : path.Trim());
		if (!string.Equals(options.ObsidianVaultPath, text, StringComparison.OrdinalIgnoreCase))
		{
			options.ObsidianVaultPath = text;
			obsidianChanged = true;
			InvalidateConnectedApps();
			Log.Info("Agents", (text == null) ? "obsidian vault cleared" : ("obsidian vault set (" + Path.GetFileName(text.TrimEnd('\\')) + ")"));
		}
	}

	private Dictionary<string, List<string>> LoadDataSources()
	{
		if (dataSources != null)
		{
			return dataSources;
		}
		dataSources = new Dictionary<string, List<string>>(StringComparer.Ordinal);
		try
		{
			if (File.Exists(DataSourcesPath) && JsonNode.Parse(File.ReadAllText(DataSourcesPath)) is JsonObject jsonObject)
			{
				foreach (var (key, jsonNode2) in jsonObject)
				{
					dataSources[key] = ((jsonNode2 as JsonArray) ?? new JsonArray()).Select((JsonNode k) => k?.ToString()).OfType<string>().ToList();
				}
			}
		}
		catch (Exception ex)
		{
			Log.Warn("Agents", "data-sources.json unreadable: " + ex.Message);
		}
		return dataSources;
	}

	public void RecordDataSource(string slug, string providerKey)
	{
		string text = providerKey.Trim().ToLowerInvariant();
		if (text.Length == 0)
		{
			return;
		}
		lock (dataSourcesGate)
		{
			Dictionary<string, List<string>> dictionary = LoadDataSources();
			if (!dictionary.TryGetValue(slug, out var value))
			{
				value = (dictionary[slug] = new List<string>());
			}
			if (value.Contains(text))
			{
				return;
			}
			value.Add(text);
			try
			{
				Directory.CreateDirectory(options.StateDirectory);
				JsonObject jsonObject = new JsonObject();
				foreach (var (propertyName, source) in dictionary)
				{
					jsonObject[propertyName] = new JsonArray(((IEnumerable<string>)source).Select((Func<string, JsonNode>)((string x) => x)).ToArray());
				}
				File.WriteAllText(DataSourcesPath, jsonObject.ToJsonString(new JsonSerializerOptions
				{
					WriteIndented = true
				}));
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "data-sources.json write failed: " + ex.Message);
			}
		}
		Log.Info("Agents", "data source: " + slug + " used " + text);
		DataSourceRecorded?.Invoke(slug, text);
	}

	public void RemoveDataSource(string slug, string providerKey)
	{
		lock (dataSourcesGate)
		{
			Dictionary<string, List<string>> dictionary = LoadDataSources();
			if (!dictionary.TryGetValue(slug, out var value) || !value.Remove(providerKey.Trim().ToLowerInvariant()))
			{
				return;
			}
			if (value.Count == 0)
			{
				dictionary.Remove(slug);
			}
			try
			{
				JsonObject jsonObject = new JsonObject();
				foreach (var (propertyName, source) in dictionary)
				{
					jsonObject[propertyName] = new JsonArray(((IEnumerable<string>)source).Select((Func<string, JsonNode>)((string x) => x)).ToArray());
				}
				File.WriteAllText(DataSourcesPath, jsonObject.ToJsonString(new JsonSerializerOptions
				{
					WriteIndented = true
				}));
			}
			catch (Exception ex)
			{
				Log.Warn("Agents", "data-sources.json write failed: " + ex.Message);
			}
		}
	}

	public IReadOnlyList<string> DataSources(string slug)
	{
		lock (dataSourcesGate)
		{
			List<string> value;
			return LoadDataSources().TryGetValue(slug, out value) ? value.ToList() : new List<string>();
		}
	}

	private void RecordDataSourcesFromThread(string threadId, JsonArray turns)
	{
		string text = clickys.ForThread(threadId)?.Slug;
		if (text == null)
		{
			return;
		}
		foreach (JsonObject item in turns.OfType<JsonObject>())
		{
			foreach (JsonObject item2 in ((item["items"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
			{
				string text2 = IntegrationUse.ProviderKey(item2);
				if (text2 != null)
				{
					RecordDataSource(text, text2);
				}
			}
		}
	}

	private string? LiveStepsKey(AgentTask task)
	{
		lock (task.Gate)
		{
			if (task.IsDemo)
			{
				return null;
			}
			string jobId = task.JobId;
			if (jobId != null)
			{
				return "job:" + jobId;
			}
		}
		return LiveNotePath(task);
	}

	private void WireLiveSteps()
	{
		session.OnTaskFilePatchStreaming = (AgentTask task, string path, string kind, string diff) =>
		{
			NoteLiveNoteFileActivity(task, path, kind, diff);
			TaskFilePatchStreaming?.Invoke(task.Id, path, kind, diff);
		};
		session.OnTaskFileChangeCompleted = (AgentTask task, IReadOnlyList<string> paths) =>
		{
			foreach (string path in paths)
			{
				NoteLiveNoteFileActivity(task, path, null, null);
			}
			TaskFileChangeCompleted?.Invoke(task.Id, paths);
		};
		session.OnTaskToolStep = (AgentTask task, string text) =>
		{
			string text2 = LiveStepsKey(task);
			if (text2 != null)
			{
				LiveSteps.Note(text, text2);
			}
		};
		session.OnTaskPlanUpdated = (AgentTask task, IReadOnlyList<AgentPlanStep> steps) =>
		{
			string text = LiveStepsKey(task);
			if (text != null)
			{
				LiveSteps.NotePlan(ClickyArcPlan.FromPlanTool(steps), text);
			}
			Raise(task, AgentTaskEventKind.PlanUpdated, string.Join(" · ", steps.Select((AgentPlanStep s) => s.Text)));
		};
	}

	private ClickyJobStepWatcher CreateStepWatcher()
	{
		ClickyJobStepWatcher clickyJobStepWatcher = new ClickyJobStepWatcher(Jobs);
		clickyJobStepWatcher.StepDone += (string jobId, string address) =>
		{
			ContinueJobAfterUserStep(jobId, address);
		};
		return clickyJobStepWatcher;
	}

	private AgentTask? LiveTask(ClickyJob job)
	{
		AgentTask? agentTask = tasks.Values.FirstOrDefault((AgentTask t) => Lock(t, () => t.JobId) == job.Id);
		if (agentTask == null)
		{
			string threadId = job.ThreadId;
			if (threadId == null)
			{
				return null;
			}
			agentTask = tasks.Values.FirstOrDefault((AgentTask t) => Lock(t, () => t.ThreadId) == threadId);
		}
		return agentTask;
	}

	public string? LiveTaskId(string jobId)
	{
		ClickyJob clickyJob = Jobs.Job(jobId);
		if ((object)clickyJob == null)
		{
			return null;
		}
		return LiveTask(clickyJob)?.Id;
	}

	public ClickyJobRailPhase RailPhase(ClickyJob job)
	{
		if (job.IsHeldForChrome)
		{
			return ClickyJobRailPhase.NeedsYou;
		}
		AgentTask agentTask = LiveTask(job);
		if (agentTask != null)
		{
			AgentTaskStatus status;
			bool requiresExtraUsageApproval;
			bool flag;
			bool needsChromeConnection;
			lock (agentTask.Gate)
			{
				status = agentTask.Status;
				requiresExtraUsageApproval = agentTask.RequiresExtraUsageApproval;
				flag = (object)agentTask.PendingUserStep != null;
				needsChromeConnection = agentTask.NeedsChromeConnection;
			}
			if (requiresExtraUsageApproval || agentTask.PendingComputerUseRequest != null)
			{
				return ClickyJobRailPhase.NeedsYou;
			}
			if (needsChromeConnection)
			{
				return ClickyJobRailPhase.NeedsYou;
			}
			if (status == AgentTaskStatus.Finished && (flag || (object)job.WaitingStep != null))
			{
				return ClickyJobRailPhase.NeedsYou;
			}
			return status switch
			{
				AgentTaskStatus.Starting => ClickyJobRailPhase.Queued, 
				AgentTaskStatus.Running => ClickyJobRailPhase.Working, 
				AgentTaskStatus.Finished => ClickyJobRailPhase.Done, 
				AgentTaskStatus.Failed => ClickyJobRailPhase.Failed, 
				AgentTaskStatus.WaitingForUser => ClickyJobRailPhase.NeedsYou, 
				_ => ClickyJobRailPhase.Stopped, 
			};
		}
		if ((object)job.WaitingStep != null && job.Outcome == ClickyJobOutcome.Done)
		{
			return ClickyJobRailPhase.NeedsYou;
		}
		return job.Outcome switch
		{
			ClickyJobOutcome.Working => ClickyJobRailPhase.Working, 
			ClickyJobOutcome.Done => ClickyJobRailPhase.Done, 
			ClickyJobOutcome.Failed => ClickyJobRailPhase.Failed, 
			_ => ClickyJobRailPhase.Stopped, 
		};
	}

	public ClickyJobMessageRoute JobMessageRoute(ClickyJob job, string requestedThreadId, string source, bool hasPreauthorizedLease)
	{
		ClickyJobMessageRoute result = new ClickyJobMessageRoute(requestedThreadId, null);
		bool flag = !ClickyJobsPreferences.IsEnabled;
		if (!flag)
		{
			bool flag2 = ((source == "text" || source == "voice") ? true : false);
			flag = !flag2;
		}
		if (flag | hasPreauthorizedLease)
		{
			return result;
		}
		AgentTask liveRun = LiveTask(job);
		if (liveRun != null)
		{
			string text = Lock(liveRun, () => liveRun.ThreadId);
			if (text != null)
			{
				bool num = Lock(liveRun, () => liveRun.IsActive) || session.IsThreadActive(text);
				bool flag3 = Lock(liveRun, () => liveRun.RequiresExtraUsageApproval) || liveRun.PendingComputerUseRequest != null;
				if (num | flag3)
				{
					return new ClickyJobMessageRoute(text, null);
				}
			}
		}
		if (session.IsThreadActive(requestedThreadId))
		{
			return result;
		}
		string threadId = job.ThreadId;
		flag = threadId != null;
		if (flag)
		{
			ClickyJobOutcome outcome = job.Outcome;
			bool flag2 = ((outcome == ClickyJobOutcome.Done || outcome == ClickyJobOutcome.Stopped) ? true : false);
			flag = flag2;
		}
		if (flag && DateTimeOffset.Now - (job.FinishedAt ?? DateTimeOffset.MinValue) < JobResumeWindow && AgentHarnessRuntimes.ContinuesOnNewConversationHarness(threadId))
		{
			return new ClickyJobMessageRoute(threadId, null, ResumesFinishedRun: true);
		}
		return new ClickyJobMessageRoute(null, job.ThreadId ?? requestedThreadId);
	}

	private (string? ThreadId, string Context) PlanJobTurn(ClickyJob job, AgentTask task, string ask, string source, bool hasPreauthorizedLease, string? requestedThreadId, bool startsNewConversation = false)
	{
		string text = "";
		string text2 = (startsNewConversation ? null : (requestedThreadId ?? job.ThreadId));
		lock (task.Gate)
		{
			task.IsNewJobRun = false;
		}
		if (text2 != null)
		{
			ClickyJobMessageRoute clickyJobMessageRoute = JobMessageRoute(job, text2, source, hasPreauthorizedLease);
			if (clickyJobMessageRoute.NewRunFollowsThreadId != null)
			{
				lock (task.Gate)
				{
					task.PendingUserStep = null;
					task.IsNewJobRun = true;
				}
				bool hasPreviousNote = ClickyWorkFolderFiles.RetireNote(job.FolderPath);
				text = text + "\n" + JobContinuationContext(job, hasPreviousNote);
				Jobs.BeginRun(job.Id, ask);
				text2 = null;
			}
			else
			{
				if (clickyJobMessageRoute.ResumesFinishedRun)
				{
					lock (task.Gate)
					{
						task.PendingUserStep = null;
					}
					ClickyWorkFolderFiles.RetireNote(job.FolderPath);
					text += "\nThis is a new message to this job, in the conversation where you did the earlier work: build on it, and change what they ask now. Answer in the language of this newest message.";
					Jobs.BeginRun(job.Id, ask, job.ThreadId);
				}
				text2 = clickyJobMessageRoute.TargetThreadId;
			}
		}
		text = text + "\n" + ClickyJobBrief.WorkFolderContext;
		Jobs.MarkWorking(job.Id);
		return (ThreadId: text2, Context: text);
	}

	private string? LeaveOldHarnessThread(AgentTask task, string source, bool preauthorized)
	{
		if ((source == "retry") | preauthorized)
		{
			return null;
		}
		string threadId;
		lock (task.Gate)
		{
			threadId = task.ThreadId;
		}
		if (threadId == null || session.IsThreadActive(threadId) || AgentHarnessRuntimes.ContinuesOnNewConversationHarness(threadId))
		{
			return null;
		}
		lock (task.Gate)
		{
			task.ThreadId = null;
		}
		Log.Info("Harness", $"[harness] {Lock(task, () => task.ClickyName)}'s conversation {threadId} ran on another harness: a fresh conversation takes this message");
		return threadId;
	}

	public string JobContinuationContext(ClickyJob job, bool hasPreviousNote = false)
	{
		string value = JobConversationSoFar(job);
		string value2 = (hasPreviousNote ? ".clicky/previous-note.md has the page the last run left, and the folder has everything made earlier." : "The folder has everything made earlier.");
		string value3 = job.Outcome switch
		{
			ClickyJobOutcome.Failed => " The last run failed partway; carry on from what it got done.", 
			ClickyJobOutcome.Stopped => " The user stopped the last run partway through.", 
			_ => "", 
		};
		return $"This message continues work done earlier in this folder. You're picking it up fresh; here is the conversation so far, oldest first:\n<earlier_conversation>\n{value}\n</earlier_conversation>\n{value2} Open an earlier file only when this message needs it.{value3} Keep what was done; change what the user asks now. {"Answer in the language of this newest message."}";
	}

	public string JobConversationSoFar(ClickyJob job, int characterLimit = 24000)
	{
		List<string> list = CachedConversationExchanges(job.AllThreadIds);
		if (list.Count == 0)
		{
			list = (job.Runs ?? Array.Empty<ClickyJobRun>()).Select((ClickyJobRun run) => "They asked: " + run.Ask + "\nIt ended: " + (run.Summary ?? run.Outcome.ToString().ToLowerInvariant())).ToList();
			string text = job.ReplyText?.Trim();
			if (text != null && text.Length > 0)
			{
				list.Add("Your last reply, in full:\n" + text);
			}
		}
		return NewestExchanges(list, characterLimit);
	}

	private List<string> CachedConversationExchanges(IReadOnlyList<string> threadIds)
	{
		List<string> list = new List<string>();
		foreach (string threadId in threadIds)
		{
			IReadOnlyList<AgentTranscriptTurn> readOnlyList;
			try
			{
				readOnlyList = CachedTranscript?.Invoke(threadId);
			}
			catch (Exception)
			{
				readOnlyList = null;
			}
			foreach (AgentTranscriptTurn item in readOnlyList ?? Array.Empty<AgentTranscriptTurn>())
			{
				string text = string.Join("\n", from m in item.UserMessages
					select DisplayUserText(m).Trim() into m
					where m.Length > 0
					select m);
				string text2 = string.Join("\n\n", from m in item.AssistantMessages
					select m.Trim() into m
					where m.Length > 0
					select m);
				if (text.Length != 0 || text2.Length != 0)
				{
					list.Add("They asked: " + ((text.Length == 0) ? "(nothing new)" : text) + "\nYou replied:\n" + ((text2.Length == 0) ? "(no reply)" : text2));
				}
			}
		}
		return list;
	}

	public static string NewestExchanges(IReadOnlyList<string> exchanges, int characterLimit)
	{
		List<string> list = new List<string>();
		int num = 0;
		foreach (string item in exchanges.Reverse())
		{
			int num2 = characterLimit - num;
			if (num2 <= 400)
			{
				break;
			}
			string text = ((item.Length > num2) ? (item.Substring(0, num2) + "…") : item);
			list.Insert(0, text);
			num += text.Length;
		}
		if (list.Count != 0)
		{
			return string.Join("\n\n", list);
		}
		return "(nothing recorded)";
	}

	public string ClickyFreshConversationContext(string oldThreadId)
	{
		string text = NewestExchanges(CachedConversationExchanges(new _003C_003Ez__ReadOnlySingleElementList<string>(oldThreadId)), 24000);
		return "This message continues your earlier conversation with the user, which ran in another agent setup. You're picking it up fresh; here is the conversation so far, oldest first:\n<earlier_conversation>\n" + text + "\n</earlier_conversation>\nYour workspace (the working folder) has AGENTS.md with your notes and everything you made earlier; read AGENTS.md first, and open an earlier file only when this message needs it. Keep what was done; change what the user asks now. Answer in the language of this newest message.";
	}

	private static string LiveNotePathForJob(ClickyJob job)
	{
		return Path.GetFullPath(Path.Combine(job.FolderPath, "note.md"));
	}

	public bool RetireClickysNoteForMovedRoutineJob(ClickyJob job)
	{
		string text = LiveNotePathForJob(job);
		bool flag = ClickyWorkFolderFiles.RetireNote(job.FolderPath);
		try
		{
			LiveNotes?.Forget(text);
		}
		catch (Exception ex)
		{
			Log.Warn("Routines", "moved routine's note versions not forgotten: " + ex.Message);
		}
		LiveSteps.Clear(text);
		if (flag)
		{
			Log.Info("Routines", "job " + job.Id + ": its Clicky's note.md set aside to .clicky\\previous-note.md");
		}
		return flag;
	}

	private void NoteJobTaskEnded(AgentTask task, ClickyJobOutcome outcome, string? summary)
	{
		NoteLiveNoteTaskEnded(task);
		string jobId;
		bool requiresExtraUsageApproval;
		string text;
		string summary2;
		string failureMessage;
		IReadOnlyList<string> artifacts;
		ClickyJobUserStep pendingUserStep;
		IReadOnlyList<string> learnedHowTos;
		string threadId;
		lock (task.Gate)
		{
			jobId = task.JobId;
			requiresExtraUsageApproval = task.RequiresExtraUsageApproval;
			text = task.FinalResponseMarkdown?.Trim();
			summary2 = task.Summary;
			failureMessage = task.FailureMessage;
			artifacts = task.Artifacts;
			pendingUserStep = task.PendingUserStep;
			learnedHowTos = task.LearnedHowTos;
			threadId = task.ThreadId;
		}
		if (jobId == null)
		{
			return;
		}
		ClickyJob clickyJob = Jobs.Job(jobId);
		if ((object)clickyJob != null && !((outcome == ClickyJobOutcome.Failed) & requiresExtraUsageApproval))
		{
			Jobs.MarkEnded(clickyJob.Id, outcome, ((outcome == ClickyJobOutcome.Done) ? summary2 : failureMessage) ?? summary, string.IsNullOrEmpty(text) ? summary : text, artifacts);
			Jobs.SetWaitingStep(clickyJob.Id, (outcome == ClickyJobOutcome.Done) ? pendingUserStep : null);
			_ = StepWatcher;
			if (outcome == ClickyJobOutcome.Done)
			{
				LearnedHowTos.Record(learnedHowTos, clickyJob.Id);
			}
			RaiseJobAction("ended", threadId, new Dictionary<string, object>
			{
				["outcome"] = outcome.ToString().ToLowerInvariant(),
				["artifact_count"] = artifacts.Count
			});
		}
	}

	public void TrackJobAction(string action, string? threadId = null, IReadOnlyDictionary<string, object?>? properties = null)
	{
		RaiseJobAction(action, threadId, properties);
	}

	private void RaiseJobAction(string action, string? threadId, IReadOnlyDictionary<string, object?>? properties = null)
	{
		Dictionary<string, object> arg = new Dictionary<string, object>(properties ?? new Dictionary<string, object>()) { ["action"] = action };
		try
		{
			JobAction?.Invoke(action, threadId, arg);
		}
		catch (Exception ex)
		{
			Log.Warn("Jobs", "JobAction handler threw: " + ex.Message);
		}
	}

	public void DismissJob(string jobId)
	{
		ClickyJob clickyJob = Jobs.Job(jobId);
		if ((object)clickyJob != null)
		{
			Jobs.Dismiss(jobId);
			RaiseJobAction("dismissed", clickyJob.ThreadId);
		}
	}

	public void NoteJobCardClosed(string jobId)
	{
		ClickyJob clickyJob = Jobs.Job(jobId);
		if ((object)clickyJob != null && clickyJob.IsFinished && clickyJob.IsQuickActionWithoutOutput)
		{
			Jobs.MarkSeen(jobId);
		}
	}

	public void PinJob(string jobId)
	{
		ClickyJob clickyJob = Jobs.Job(jobId);
		if ((object)clickyJob != null)
		{
			Jobs.KeepOnDock(jobId);
			RaiseJobAction("pinned", clickyJob.ThreadId);
		}
	}

	public async Task StopJobAsync(string jobId)
	{
		ClickyJob job = Jobs.Job(jobId);
		if ((object)job != null)
		{
			AgentTask agentTask = LiveTask(job);
			if (agentTask != null)
			{
				await StopAsync(agentTask.Id).ConfigureAwait(continueOnCapturedContext: false);
				RaiseJobAction("stopped", job.ThreadId);
			}
		}
	}

	public void ContinueJobAfterUserStep(string jobId, string? reachedAddress = null)
	{
		ClickyJob clickyJob = Jobs.Job(jobId);
		if ((object)clickyJob == null)
		{
			return;
		}
		ClickyJobUserStep waitingStep = clickyJob.WaitingStep;
		if ((object)waitingStep != null)
		{
			string threadId = clickyJob.ThreadId;
			if (threadId != null)
			{
				string launchContext = ((reachedAddress != null) ? $"HeyClicky saw the user's browser reach {reachedAddress}, which you said means this step is done: \"{waitingStep.Step}\". Check it really went through (look at the page) before carrying on; if it didn't, say what's left." : ("The user tapped I'm done on the step you handed them: \"" + waitingStep.Step + "\". Check it went through before carrying on."));
				LaunchAsync(new AgentLaunchRequest
				{
					Prompt = "Done: " + waitingStep.Step,
					JobId = clickyJob.Id,
					TargetThreadId = threadId,
					LaunchContext = launchContext,
					LaunchSource = "text",
					IsHudFollowUp = true
				});
				RaiseJobAction("user_step_done", threadId, new Dictionary<string, object> { ["via"] = ((reachedAddress == null) ? "button" : "browser_page") });
			}
		}
	}

	public string? JobsContextNoteForBrainTurn(ISet<Guid>? liveSuggestionCardIds = null, Func<string, string?>? routineLine = null, IReadOnlyList<string>? extraLines = null)
	{
		if (!ClickyJobsPreferences.IsEnabled)
		{
			return null;
		}
		List<string> list = Jobs.RailJobs.Where((ClickyJob job) =>
		{
			if (job.IsWaitingToStart)
			{
				Guid? suggestionCardId = job.SuggestionCardId;
				if (suggestionCardId.HasValue)
				{
					Guid valueOrDefault = suggestionCardId.GetValueOrDefault();
					return liveSuggestionCardIds?.Contains(valueOrDefault) ?? false;
				}
			}
			return true;
		}).TakeLast(8).ToList()
			.Select((ClickyJob job) =>
			{
				if (job.IsWaitingToStart)
				{
					return "- \"" + job.Title + "\" — OFFERED, NOT STARTED: it waits on the dock until they click it. When they say yes to it, sessions_spawn with this exact title as the label: that starts this one, never a second job beside it.";
				}
				if (!job.IsHeldForChrome)
				{
					string value;
					switch (RailPhase(job))
					{
					case ClickyJobRailPhase.Queued:
						value = "STARTING";
						break;
					case ClickyJobRailPhase.Working:
						value = "WORKING NOW";
						break;
					case ClickyJobRailPhase.NeedsYou:
					{
						AgentTask live = LiveTask(job);
						string text = live?.PendingComputerUseRequest;
						if (text != null)
						{
							value = "WAITING ON THE USER to let you drive one step on their PC: " + Cap(text, 140) + " (their yes or no → sessions_answer_request, request computer_use, this codexThreadId)";
						}
						else if (live != null && Lock(live, () => live.RequiresExtraUsageApproval))
						{
							value = "WAITING ON THE USER for more agent messages (their yes or no → sessions_answer_request, request extra_usage, this codexThreadId)";
						}
						else if (live != null && Lock(live, () => live.NeedsChromeConnection))
						{
							value = "WAITING ON THE USER to choose about HeyClicky's Chrome extension, which it needs for a website (their answer → sessions_answer_request, request chrome_setup, this codexThreadId: approve = you install it on their screen, show_how = they install it with you showing them how, decline = it goes on without it; it carries on by itself once Chrome is connected)";
						}
						else
						{
							ClickyJobUserStep waitingStep = job.WaitingStep;
							value = "WAITING ON THE USER" + (((object)waitingStep != null) ? (" to: " + Cap(waitingStep.Step, 140) + " (when they say it's done, sessions_send it; " + ((waitingStep.DoneWhenUrlContains == null) ? "it waits for them)" : "it also continues by itself once their browser shows it's done)")) : "");
						}
						break;
					}
					case ClickyJobRailPhase.Done:
					{
						string summary = job.Summary;
						value = "done" + ((summary != null) ? (": " + Cap(summary, 140)) : "");
						break;
					}
					case ClickyJobRailPhase.Failed:
						value = "failed";
						break;
					default:
						value = "stopped";
						break;
					}
					string threadId = job.ThreadId;
					string value2 = ((threadId != null) ? ("codexThreadId: " + threadId) : "no thread yet");
					string text2 = routineLine?.Invoke(job.Id);
					string value3 = ((text2 != null && text2.Length > 0) ? (", " + text2) : "");
					return $"- \"{job.Title}\" — {value2}, {value}{value3}";
				}
				return "- \"" + job.Title + "\" — no thread yet, WAITING ON THE USER to choose about HeyClicky's Chrome extension before it starts (their answer → sessions_answer_request, request chrome_setup, no codexThreadId: approve = you install it on their screen, show_how = they install it with you showing them how, decline = it starts now without it)";
			})
			.ToList();
		list.AddRange(extraLines ?? Array.Empty<string>());
		if (list.Count == 0)
		{
			int num = 1;
			List<string> list2 = new List<string>(num);
			CollectionsMarshal.SetCount(list2, num);
			Span<string> span = CollectionsMarshal.AsSpan(list2);
			int index = 0;
			span[index] = "(no jobs right now)";
			list = list2;
		}
		return "[Your jobs] Background work in the dock that fans out of the notch at the top of the screen (each keeps its own notes, so a message to a finished one picks up where it left off). New work → sessions_spawn with its task and label: it runs as a job, and its result shows in the chat when it's done. A change or more work on a job → sessions_send with its codexThreadId; a question about what one found → clicky_memory with its codexThreadId (it reads the result and never runs the job); stop one → sessions_interrupt with its codexThreadId; a yes or no to what one waits on → sessions_answer_request with its codexThreadId. A job that repeats names its routine_id: its schedule is the routines tool's, never sessions_send." + "\n" + string.Join("\n", list);
	}

	private static string Cap(string s, int n)
	{
		if (s.Length <= n)
		{
			return s;
		}
		return s.Substring(0, n);
	}

	public string? WorkContextNoteForBrainTurn(ISet<Guid>? liveSuggestionCardIds = null)
	{
		if (!ClickyJobsPreferences.IsEnabled)
		{
			return null;
		}
		string text = JobsContextNoteForBrainTurn(liveSuggestionCardIds, routines.JobRoutineLine, EarlierClickyJobLinesForBrain());
		return string.Join("\n\n", new string[2]
		{
			text,
			RoutinesTool.ContextNote()
		}.OfType<string>());
	}

	private IReadOnlyList<string> EarlierClickyJobLinesForBrain()
	{
		return clickys.Clickys.Select((ClickyInfo clicky) =>
		{
			string threadId = clicky.ThreadId;
			if (threadId == null)
			{
				return (string)null;
			}
			AgentTask live = tasks.Values.LastOrDefault((AgentTask t) => Lock(t, () => !t.IsDemo && (t.ClickySlug == clicky.Slug || t.ThreadId == threadId)));
			string text = live?.PendingComputerUseRequest;
			string value;
			if (text != null)
			{
				value = "WAITING ON THE USER to let you drive one step on their PC: " + Cap(text, 140) + " (their yes or no → sessions_answer_request, request computer_use, this codexThreadId)";
			}
			else if (live != null && Lock(live, () => live.RequiresExtraUsageApproval))
			{
				value = "WAITING ON THE USER for more agent messages (their yes or no → sessions_answer_request, request extra_usage, this codexThreadId)";
			}
			else if (live != null && Lock(live, () => live.IsActive))
			{
				string text2 = LiveWorkDescription(live);
				value = "WORKING NOW" + ((text2 != null) ? (": " + text2) : "");
			}
			else
			{
				value = "done earlier";
			}
			ClickyRoutine clickyRoutine = routines.ForClicky(clicky.Slug).FirstOrDefault();
			string value2 = ((clickyRoutine != null) ? (", repeats (routine_id " + clickyRoutine.Id + ")") : "");
			string text3 = clicky.OneLiner.Trim();
			return "- \"" + clicky.Name + "\"" + ((text3.Length == 0) ? "" : (" (" + text3 + ")")) + $" — codexThreadId: {threadId}, {value}{value2}";
		}).OfType<string>().ToList()
			.TakeLast(8)
			.ToList();
	}

	private static string? LiveWorkDescription(AgentTask task)
	{
		lock (task.Gate)
		{
			List<string> list = new List<string>();
			string text = Clipped(task.UserPrompts.LastOrDefault() ?? "", 140);
			if (text.Length > 0)
			{
				list.Add("on \"" + text + "\"");
			}
			int num = (int)(DateTimeOffset.Now - task.StartedAt).TotalMinutes;
			list.Add((num < 1) ? "for under a minute" : $"for {num} min");
			string latestCommentary = task.LatestCommentary;
			if (latestCommentary != null && latestCommentary.Length > 0)
			{
				list.Add("latest update \"" + Clipped(latestCommentary, 160) + "\"");
			}
			else if (task.Status == AgentTaskStatus.Starting)
			{
				list.Add("waiting to start");
			}
			return string.Join(", ", list);
		}
		static string Clipped(string text3, int limit)
		{
			string text2 = text3.Replace("\r", " ").Replace("\n", " ").Trim();
			if (text2.Length <= limit)
			{
				return text2;
			}
			return text2.Substring(0, limit) + "…";
		}
	}

	private void SyncPendingRequest(AgentTask task)
	{
		ClickyPendingAgentRequest request = null;
		string threadId;
		lock (task.Gate)
		{
			threadId = task.ThreadId;
			if (threadId == null || task.IsDemo)
			{
				return;
			}
			ClickyPendingAgentRequest.RequestKind? requestKind;
			if (task.PendingComputerUseRequest != null)
			{
				requestKind = ClickyPendingAgentRequest.RequestKind.ComputerUse;
			}
			else
			{
				requestKind = (task.RequiresExtraUsageApproval ? new ClickyPendingAgentRequest.RequestKind?(ClickyPendingAgentRequest.RequestKind.ExtraUsage) : ((ClickyPendingAgentRequest.RequestKind?)null));
			}
			if (requestKind.HasValue)
			{
				ClickyPendingAgentRequest.RequestKind valueOrDefault = requestKind.GetValueOrDefault();
				request = new ClickyPendingAgentRequest
				{
					ThreadId = threadId,
					Kind = valueOrDefault,
					RequestText = (task.PendingComputerUseRequest ?? ""),
					LeaseId = task.Lease?.LeaseId,
					LeaseTurnId = task.Lease?.TurnId,
					ClickySlug = task.ClickySlug,
					JobId = task.JobId,
					Title = (task.DoneTitle ?? task.Title),
					Prompt = Cap(task.UserPrompts.LastOrDefault() ?? "", 4000),
					FinalSummary = task.Summary,
					AskedAt = DateTimeOffset.Now
				};
			}
		}
		ClickyPendingAgentRequestStore.Sync(request, threadId);
	}

	public void RestorePendingAgentRequestsFromLastRun()
	{
		IReadOnlyList<ClickyPendingAgentRequest> readOnlyList = ClickyPendingAgentRequestStore.All();
		if (readOnlyList.Count == 0)
		{
			return;
		}
		bool flag = false;
		foreach (ClickyPendingAgentRequest record in readOnlyList)
		{
			if (tasks.Values.Any((AgentTask t) => Lock(t, () => t.ThreadId) == record.ThreadId))
			{
				continue;
			}
			AgentTask agentTask = new AgentTask
			{
				ThreadId = record.ThreadId,
				StartedAt = record.AskedAt,
				Status = ((record.Kind == ClickyPendingAgentRequest.RequestKind.ComputerUse) ? AgentTaskStatus.Finished : AgentTaskStatus.WaitingForUser),
				ProgressSummary = ""
			};
			lock (agentTask.Gate)
			{
				agentTask.ClickySlug = record.ClickySlug;
				string clickySlug = record.ClickySlug;
				agentTask.ClickyName = ((clickySlug == null) ? null : clickys.Get(clickySlug)?.Name);
				agentTask.JobId = record.JobId;
				agentTask.Title = record.Title ?? agentTask.Title;
				agentTask.Summary = record.FinalSummary;
				agentTask.UserPrompts.Add(record.Prompt);
				string leaseId = record.LeaseId;
				if (leaseId != null)
				{
					agentTask.Lease = new AgentTurnLease(leaseId, record.LeaseTurnId ?? "", null, 0, 0, null, null, record.Kind == ClickyPendingAgentRequest.RequestKind.ExtraUsage, null);
				}
				if (record.Kind == ClickyPendingAgentRequest.RequestKind.ComputerUse)
				{
					agentTask.PendingComputerUseRequest = record.RequestText;
				}
				else
				{
					agentTask.RequiresExtraUsageApproval = true;
				}
				string jobId = record.JobId;
				object workspacePath;
				if (jobId != null)
				{
					workspacePath = Jobs.Job(jobId)?.FolderPath;
				}
				else
				{
					string clickySlug2 = record.ClickySlug;
					workspacePath = ((clickySlug2 != null) ? clickys.WorkspacePath(clickySlug2) : null);
				}
				agentTask.WorkspacePath = (string?)workspacePath;
			}
			tasks[agentTask.Id] = agentTask;
			flag = true;
		}
		if (flag)
		{
			Log.Info("Agents", $"[pending requests] restored {readOnlyList.Count} waiting question(s) from the last run");
			RaiseTasksChanged();
		}
	}

	public string? FullReplyText(string taskId)
	{
		if (!tasks.TryGetValue(taskId, out AgentTask value))
		{
			return null;
		}
		List<string> list;
		lock (value.Gate)
		{
			list = value.CompletedReplies.Select((string r) => StructuredFinalReply.Parse(r).Text).ToList();
			string finalResponseMarkdown = value.FinalResponseMarkdown;
			if (finalResponseMarkdown != null && finalResponseMarkdown.Trim() != list.LastOrDefault()?.Trim())
			{
				list.Add(finalResponseMarkdown);
			}
		}
		string text = string.Join("\n\n", from m in list
			select m.Trim() into m
			where m.Length > 0
			select m);
		if (text.Length == 0)
		{
			return null;
		}
		if (text.Length <= 40000)
		{
			return text;
		}
		return text.Substring(0, 39999) + "…";
	}

	public string? ResultReport(string taskId)
	{
		AgentTaskDetail taskDetail = GetTaskDetail(taskId);
		if ((object)taskDetail == null)
		{
			return null;
		}
		List<string> list = new List<string>();
		string text = taskDetail.Answer?.ReportJson;
		if (text != null)
		{
			list.Add("Its facts, to build their card from: " + text);
		}
		string text2 = FullReplyText(taskId);
		if (text2 != null)
		{
			string text3 = ((text2.Length > 6000) ? (text2.Substring(0, 6000) + "… (cut here; clicky_memory has the rest)") : text2);
			list.Add("Its full report, which they can open from the chat:\n<report>\n" + text3 + "\n</report>");
		}
		if (taskDetail.Artifacts.Count > 0)
		{
			list.Add("Files it made: " + string.Join(", ", taskDetail.Artifacts.Take(6)));
		}
		if (list.Count != 0)
		{
			return string.Join("\n", list);
		}
		return null;
	}

	public bool NoteResultCard(string threadId, ClickyAnswer card)
	{
		if (tasks.Values.FirstOrDefault((AgentTask t) => Lock(t, () => t.ThreadId) == threadId && Lock(t, () => t.Status) == AgentTaskStatus.Finished) == null)
		{
			return false;
		}
		resultCards[threadId] = card;
		ClickyJob clickyJob = Jobs.JobForThread(threadId);
		if ((object)clickyJob != null)
		{
			Jobs.SetResultCard(clickyJob.Id, card);
		}
		try
		{
			ResultCardShown?.Invoke(threadId);
		}
		catch (Exception ex)
		{
			Log.Warn("Jobs", "ResultCardShown handler threw: " + ex.Message);
		}
		return true;
	}

	public ClickyAnswer? ResultCard(string threadId)
	{
		if (!resultCards.TryGetValue(threadId, out ClickyAnswer value))
		{
			return Jobs.JobForThread(threadId)?.ResultCard;
		}
		return value;
	}

	private void NoteRunningTurnsForRestart()
	{
		List<(string, string, DateTimeOffset)> running = (from t in tasks.Values
			select Lock(t, () => (Status: t.Status, IsDemo: t.IsDemo, JobId: t.JobId, ClickySlug: t.ClickySlug, ThreadId: t.ThreadId, StartedAt: t.StartedAt)) into t
			where t.Status == AgentTaskStatus.Running && !t.IsDemo && t.JobId == null && t.ClickySlug != null
			select (t.ClickySlug, ThreadId: t.ThreadId, StartedAt: t.StartedAt)).ToList();
		RestartInterruptions.NoteRunning(running);
	}

	private void RemoveJobsForSignOut()
	{
		routines.RemoveAllJobRoutinesForSignOut();
		Jobs.RemoveAllForSignOut();
		ClickyHelperFiles.RemoveAllForSignOut();
		LearnedHowTos.RemoveAllForSignOut();
		ClickyPendingAgentRequestStore.RemoveAllForSignOut();
		RestartInterruptions.Reset();
	}

	public IReadOnlyList<string> DeleteAllLocalClickys()
	{
		if (tasks.Values.Any((AgentTask t) => Lock(t, () => t.IsActive)))
		{
			throw new InvalidOperationException("Stop the running agents first.");
		}
		IReadOnlyList<string> readOnlyList = clickys.DeleteAll();
		foreach (ClickyRoutine routine in routines.Routines)
		{
			routines.Delete(routine.Id, "debug_delete_all");
		}
		foreach (AgentTask item in tasks.Values.Where((AgentTask t) => t.ClickySlug != null).ToList())
		{
			tasks.TryRemove(item.Id, out AgentTask _);
		}
		RaiseTasksChanged();
		Log.Info("Agents", $"deleted all local Clickys ({readOnlyList.Count} workspace folder(s) to recycle)");
		return readOnlyList;
	}
}
