using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents;
using HeyClicky.Core.Browser;
using HeyClicky.Core.Telemetry;
using Microsoft.UI.Dispatching;

namespace HeyClicky.App.Browser;

public sealed class ChromeSetupFlow
{
	public enum Choice
	{
		DoItForMe,
		ShowMeHow,
		NotNow
	}

	public sealed record Target(string? JobId, string? ThreadId)
	{
		public static readonly Target None = new Target(null, null);
	}

	private bool isShowingHow;

	private bool isSettingUpForThem;

	private bool isPreview;

	private AppHost? app;

	private readonly Dictionary<string, Action<bool>> heldStarts = new Dictionary<string, Action<bool>>();

	private readonly HashSet<string> askedKeys = new HashSet<string>();

	private readonly Dictionary<string, string> messagesAfterTurn = new Dictionary<string, string>();

	private readonly ChromeFolderStrip folderStrip = new ChromeFolderStrip();

	private CancellationTokenSource? showHowRun;

	private readonly HashSet<string> skippedThreads = new HashSet<string>();

	public const string WithoutChromeMessage = "I'd rather not connect Chrome now. Carry on without it: for each step on a website I'm signed into, call mac_step and CODY does it on my screen while I watch.";

	public const string HelperContextWithoutChrome = "They chose not to connect Chrome for this job: don't ask about Chrome again. For a step on a website they're signed into, call mac_step and CODY does it on their screen while they watch.";

	public static ChromeSetupFlow Shared { get; } = new ChromeSetupFlow();

	public IChromeClickyDrive? Drive { get; set; }

	public IChromeSetupJobs? Jobs { get; set; }

	public bool IsShowingHow => isShowingHow;

	public bool IsSettingUpForThem => isSettingUpForThem;

	public bool IsBusy
	{
		get
		{
			if (!isShowingHow && !isSettingUpForThem)
			{
				return ChromeAutoInstall.IsRunning;
			}
			return true;
		}
	}

	public bool CanDoItForThem => Drive?.IsAvailable ?? false;

	private ClickyBrowserBridge Bridge => ClickyBrowserBridge.Shared;

	private AgentService? Agents => app?.Real?.Agents;

	private DispatcherQueue? Ui => app?.DispatcherQueue;

	public bool HoldsNewWebsiteJobs
	{
		get
		{
			if (!Bridge.IsConnected)
			{
				return ChromiumBrowsers.InstalledNames.Count > 0;
			}
			return false;
		}
	}

	public bool HasWaitingJob
	{
		get
		{
			if ((Jobs?.HeldJobIdsNewestFirst().Count ?? 0) <= 0)
			{
				return (Agents?.ThreadsNeedingChrome().Count ?? 0) > 0;
			}
			return true;
		}
	}

	public event Action? Changed;

	public static string Raw(Choice choice)
	{
		return choice switch
		{
			Choice.DoItForMe => "do_it_for_me", 
			Choice.ShowMeHow => "show_me_how", 
			_ => "not_now", 
		};
	}

	public static Choice? Parse(string? raw)
	{
		return raw switch
		{
			"do_it_for_me" => (Choice?)Choice.DoItForMe, 
			"show_me_how" => Choice.ShowMeHow, 
			"not_now" => Choice.NotNow, 
			_ => null, 
		};
	}

	private ChromeSetupFlow()
	{
	}

	private void OnUi(Action action)
	{
		Ui?.TryEnqueue(() =>
		{
			action();
		});
	}

	private void Notify()
	{
		Changed?.Invoke();
	}

	public void Attach(AppHost host)
	{
		if (app != null)
		{
			return;
		}
		app = host;
		bool wasConnected = Bridge.IsConnected;
		Bridge.ConnectionChanged += () =>
		{
			bool isConnected = Bridge.IsConnected;
			if (isConnected != wasConnected)
			{
				wasConnected = isConnected;
				if (isConnected)
				{
					OnUi(ChromeConnected);
				}
			}
		};
	}

	public void Hold(string jobId, Action<bool> start)
	{
		heldStarts[jobId] = start;
		askedKeys.Add(jobId);
		Jobs?.SetWaitsForChrome(jobId, waits: true);
		Jobs?.PresentNeedsYou(jobId);
		ClickyAnalytics.TrackChromeJobAction("chrome_choice_asked", null, new JsonObject { ["when"] = "before_start" });
		Notify();
	}

	public void JobNeedsChrome(string threadId)
	{
		AgentService agents = Agents;
		if (agents != null && agents.TaskIdForThread(threadId) != null)
		{
			string item = Jobs?.JobIdForThread(threadId) ?? threadId;
			if (!askedKeys.Contains(item) && !IsBusy)
			{
				askedKeys.Add(item);
				app?.AnnounceJobNeedsChrome(threadId);
				ClickyAnalytics.TrackChromeJobAction("chrome_choice_asked", threadId, new JsonObject { ["when"] = "while_working" });
				Notify();
			}
		}
	}

	public Target? TargetFor(string? threadId)
	{
		AgentService agents = Agents;
		if (agents == null)
		{
			return null;
		}
		if (threadId != null && agents.NeedsChromeConnection(threadId))
		{
			return new Target(Jobs?.JobIdForThread(threadId), threadId);
		}
		string text = Jobs?.HeldJobIdsNewestFirst().FirstOrDefault();
		if (text != null)
		{
			return new Target(text, null);
		}
		string text2 = agents.ThreadsNeedingChrome().LastOrDefault();
		if (text2 != null)
		{
			return new Target(Jobs?.JobIdForThread(text2), text2);
		}
		return null;
	}

	public void Choose(Choice choice, Target target)
	{
		if (app == null)
		{
			return;
		}
		ClickyAnalytics.TrackChromeJobAction("chrome_choice", target.ThreadId, new JsonObject
		{
			["choice"] = Raw(choice),
			["for_job"] = target.JobId != null || target.ThreadId != null
		});
		app.DismissCurrentNotchCard();
		if (choice != Choice.ShowMeHow && isShowingHow)
		{
			app.ClearDrawing();
			StopShowingHow();
		}
		switch (choice)
		{
		case Choice.DoItForMe:
			if (!CanDoItForThem)
			{
				Choose(Choice.ShowMeHow, target);
				break;
			}
			if (Bridge.IsConnected)
			{
				ChromeConnected();
				break;
			}
			isSettingUpForThem = true;
			Notify();
			ChromeAutoInstall.InstallByDriving(this, target.ThreadId, evenIfConnected: false, null, (bool connected, bool stoppedByUser) =>
			{
				OnUi(() =>
				{
					isSettingUpForThem = false;
					Notify();
					if (!connected)
					{
						if (stoppedByUser)
						{
							OfferAgain(target);
						}
						else
						{
							ShowHow(afterDrive: true);
						}
					}
				});
			});
			break;
		case Choice.ShowMeHow:
			if (Bridge.IsConnected)
			{
				ChromeConnected();
			}
			else
			{
				ShowHow(afterDrive: false);
			}
			break;
		case Choice.NotNow:
			GoWithoutChrome(target);
			break;
		}
	}

	public void PreviewShowMeHow()
	{
		isPreview = true;
		ShowHow(afterDrive: false);
	}

	public void PreviewHeldJob()
	{
		if (app == null)
		{
			return;
		}
		string jobId = Jobs?.CreatePreviewJob("Posting the song to Discord", "Post my song in the CODY Discord's #general.");
		if (jobId == null)
		{
			Log.Info("Browser", "preview held job: jobs aren't ported on Windows yet; saying the line only");
			app.AnnounceLineAsync(NeedsChromeLine("Posting the song to Discord", CanDoItForThem));
			return;
		}
		Hold(jobId, (bool _) =>
		{
			Jobs?.Dismiss(jobId);
		});
		app.AnnounceLineAsync(NeedsChromeLine("Posting the song to Discord", CanDoItForThem));
	}

	public static string NeedsChromeLine(string? jobName, bool canDoItForThem)
	{
		string text = jobName?.Trim() ?? "";
		return ((text.Length == 0) ? "Your job" : text) + " needs CODY's Chrome extension to go on. " + (canDoItForThem ? "Want me to install it?" : "Want me to show you how to install it?");
	}

	private void OfferAgain(Target target)
	{
		string jobId = target.JobId;
		if (jobId != null)
		{
			IChromeSetupJobs? jobs = Jobs;
			if (jobs != null && jobs.IsHeldForChrome(jobId))
			{
				Jobs.PresentNeedsYou(jobId);
				return;
			}
		}
		string threadId = target.ThreadId;
		if (threadId != null)
		{
			app?.PresentTaskNeedsYou(threadId);
		}
	}

	public void Stop()
	{
		Drive?.HandleEscape();
		StopShowingHowForEscape();
	}

	public bool StopShowingHowForEscape()
	{
		if (!isShowingHow)
		{
			return false;
		}
		app?.ClearDrawing();
		StopShowingHow();
		return true;
	}

	public void ShowHow(bool afterDrive)
	{
		if (app != null)
		{
			isShowingHow = true;
			Notify();
			showHowRun?.Cancel();
			ShowHowAsync(afterDrive, (showHowRun = new CancellationTokenSource()).Token);
		}
	}

	private async Task ShowHowAsync(bool afterDrive, CancellationToken ct)
	{
		await Bridge.ConnectAsync(revealingFolder: false);
        if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return;
		await OnUiAsync(() =>
		{
		});
		if (Bridge.IsConnected && !isPreview)
		{
			OnUi(ChromeConnected);
			return;
		}
		if (isPreview)
		{
			Bridge.OpenExtensionsPage(revealingFolder: false);
		}
		try
		{
			await Task.Delay(1200, ct);
		}
		catch
		{
			return;
		}
		if (!isShowingHow)
		{
			return;
		}
		bool fromStore = Bridge.StoreListingUrl != null;
		if (!fromStore)
		{
			await OnUiAsync(() =>
			{
				ShowStrip(StopShowingHow);
			});
		}
		for (int i = 0; i < 30; i++)
		{
			if (app.VoiceState == VoiceState.Idle)
			{
				break;
			}
			if (app.VoiceState == VoiceState.Listening)
			{
				return;
			}
			try
			{
				await Task.Delay(500, ct);
			}
			catch
			{
				return;
			}
		}
		if (isShowingHow && app.VoiceState == VoiceState.Idle)
		{
			app.StartAppFactTurn(ShowHowFact(fromStore, afterDrive));
		}
	}

	private Task OnUiAsync(Action action)
	{
		TaskCompletionSource done = new TaskCompletionSource();
		DispatcherQueue ui = Ui;
		if ((object)ui == null || !ui.TryEnqueue(() =>
		{
			try
			{
				action();
			}
			finally
			{
				done.TrySetResult();
			}
		}))
		{
			done.TrySetResult();
		}
		return done.Task;
	}

	public static string ShowHowFact(bool fromStore, bool afterDrive)
	{
		string value = (afterDrive ? "[Chrome setup] Your try at adding CODY's Chrome extension on their screen stopped partway, so now they do the rest while you show them how." : "[Chrome setup] They chose to add CODY's Chrome extension themselves, with you showing them how.");
		string value2 = (afterDrive ? "First, one short line on where things are now." : "First, one short line on what you're doing together and why: adding your Chrome extension, so their jobs can work in the sites they're signed into.");
		string value3 = (fromStore ? "CODY's page in the Chrome Web Store is open in front. Then point at the \"Add to Chrome\" button with a click target, and next at \"Add extension\" in the small dialog Chrome shows." : "Chrome's Extensions page is open in front. Then point at the \"Developer mode\" switch at the page's top right with a click target, and say why in a few words: your extension isn't in the Chrome Web Store yet, and Chrome only adds one from outside its store with Developer mode on (skip it if it's already on). CODY shows your extension in a strip under Chrome's window, \"CODY for Chrome\" with your logo: once Developer mode is on, tell them to drag it onto the page.");
		return $"{value} {value2} {value3} One short line per step. Don't do the steps yourself. Stop once CODY says Chrome is connected.";
	}

	public bool ShowStrip(Action? onClose = null)
	{
        if (HeyClicky.App.Cody.CodyEngineBridge.EngineMode) return false;
		string text = Bridge.SyncInstalledExtensionFolder();
		if (text != null)
		{
			(string, string)? tuple = ChromiumBrowsers.Preferred();
			if (tuple.HasValue)
			{
				(string, string) valueOrDefault = tuple.GetValueOrDefault();
				folderStrip.Show(text, valueOrDefault.Item2, valueOrDefault.Item1, () =>
				{
					if (onClose != null)
					{
						onClose();
					}
					else
					{
						HideStrip();
					}
				});
				return true;
			}
		}
		return false;
	}

	public void HideStrip()
	{
		folderStrip.Hide();
	}

	public async Task<bool> DragStripOntoBrowserAsync()
	{
		await Task.Delay(400);
		IChromeClickyDrive drive = Drive;
		if (drive != null)
		{
			Rectangle? frameOnScreen = folderStrip.FrameOnScreen;
			if (frameOnScreen.HasValue)
			{
				Rectangle valueOrDefault = frameOnScreen.GetValueOrDefault();
				frameOnScreen = folderStrip.BrowserWindowFrame();
				if (frameOnScreen.HasValue)
				{
					Rectangle valueOrDefault2 = frameOnScreen.GetValueOrDefault();
					Point point = new Point(valueOrDefault.Left + (int)(48.0 * folderStrip.Scale), valueOrDefault.Top + valueOrDefault.Height / 2);
					Point point2 = new Point(valueOrDefault2.Left + valueOrDefault2.Width / 2, valueOrDefault2.Top + (int)((double)valueOrDefault2.Height * 0.45));
					await drive.GlideAndDragAsync(point, new _003C_003Ez__ReadOnlyArray<Point>(new Point[7]
					{
						point,
						new Point(point.X + 6, point.Y - 14),
						new Point((point.X + point2.X) / 2, (point.Y + point2.Y) / 2),
						point2,
						new Point(point2.X + 4, point2.Y),
						new Point(point2.X, point2.Y + 4),
						point2
					}));
					return true;
				}
			}
		}
		return false;
	}

	private void StopShowingHow()
	{
		isShowingHow = false;
		isPreview = false;
		showHowRun?.Cancel();
		folderStrip.Hide();
		Notify();
	}

	private void ChromeConnected()
	{
		if (app == null || isPreview)
		{
			return;
		}
		if (isShowingHow)
		{
			app.ClearDrawing();
		}
		StopShowingHow();
		foreach (string item in Jobs?.HeldJobIdsNewestFirst() ?? Array.Empty<string>())
		{
			Start(item, withoutChrome: false);
		}
		foreach (string item2 in Agents?.ThreadsNeedingChrome() ?? Array.Empty<string>())
		{
			Agents.ClearNeedsChromeConnection(item2);
			Send("Chrome is connected now. Carry on with the task.", item2);
		}
		askedKeys.Clear();
	}

	private void GoWithoutChrome(Target target)
	{
		string jobId = target.JobId;
		if (jobId != null)
		{
			IChromeSetupJobs? jobs = Jobs;
			if (jobs != null && jobs.IsHeldForChrome(jobId))
			{
				Jobs.SetSkipsChrome(jobId);
				Start(jobId, withoutChrome: true);
				return;
			}
		}
		string threadId = target.ThreadId;
		if (threadId != null)
		{
			string text = target.JobId ?? Jobs?.JobIdForThread(threadId);
			if (text != null)
			{
				Jobs?.SetSkipsChrome(text);
			}
			else
			{
				skippedThreads.Add(threadId);
			}
			Agents?.ClearNeedsChromeConnection(threadId);
			Send("I'd rather not connect Chrome now. Carry on without it: for each step on a website I'm signed into, call mac_step and CODY does it on my screen while I watch.", threadId);
		}
	}

	private void Start(string jobId, bool withoutChrome)
	{
		Jobs?.SetWaitsForChrome(jobId, waits: false);
		if (heldStarts.Remove(jobId, out Action<bool> value))
		{
			value(withoutChrome);
		}
		else
		{
			Jobs?.StartFromSavedPrompt(jobId, withoutChrome);
		}
	}

	private void Send(string message, string threadId)
	{
		AgentService agents = Agents;
		if (agents == null)
		{
			return;
		}
		string text = agents.TaskIdForThread(threadId);
		if (text != null)
		{
			if (agents.IsThreadRunning(threadId))
			{
				messagesAfterTurn[threadId] = message;
			}
			else
			{
				agents.SteerAsync(text, message);
			}
		}
	}

	public void TurnEnded(string? threadId)
	{
		if (threadId == null || !messagesAfterTurn.Remove(threadId, out string value))
		{
			return;
		}
		AgentService agents = Agents;
		if (agents != null)
		{
			string text = agents.TaskIdForThread(threadId);
			if (text != null)
			{
				agents.SteerAsync(text, value);
			}
		}
	}

	public bool SkipsChrome(string threadId)
	{
		if (!skippedThreads.Contains(threadId))
		{
			string text = Jobs?.JobIdForThread(threadId);
			if (text != null)
			{
				return Jobs.SkipsChrome(text);
			}
			return false;
		}
		return true;
	}
}
