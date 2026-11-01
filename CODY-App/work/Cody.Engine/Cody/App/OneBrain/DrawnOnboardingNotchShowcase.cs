using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using HeyClicky.App.UI;
using HeyClicky.Core.Proactive;
using HeyClicky.Core.Telemetry;
using Microsoft.UI.Dispatching;

namespace HeyClicky.App.OneBrain;

public sealed class DrawnOnboardingNotchShowcase
{
	private const string Area = "drawn tour";

	public static Action? OpenNotchOnHome;

	public static Action? FoldNotch;

	public static Action<bool>? SetDockTourShowcase;

	private readonly List<string> sampleIntegrationIds = new List<string>();

	private int generation;

	private long holdOpenUntil;

	private bool hasPoppedApps;

	private long? openedAt;

	private const double MinimumOpenSeconds = 4.5;

	public static readonly string[] PreferredAppKeys = new string[4] { "gmail", "notion", "figma", "github" };

	public static DrawnOnboardingNotchShowcase Shared { get; } = new DrawnOnboardingNotchShowcase();

	public IReadOnlyList<string> SampleIntegrationIds => sampleIntegrationIds;

	public bool IsShowing { get; private set; }

	public bool ShowsDock { get; private set; }

	public event Action? Changed;

	private static void Track(string action, JsonObject? properties = null)
	{
		ClickyTourJobCards.TrackFlowAction(action, GoodMorningBrief.IsPlaying && !DrawnOnboardingTour.IsRunning, properties);
	}

	private DrawnOnboardingNotchShowcase()
	{
	}

	public void Show(AppHost host)
	{
		if (IsShowing)
		{
			return;
		}
		IsShowing = true;
		ShowsDock = true;
		hasPoppedApps = false;
		holdOpenUntil = Environment.TickCount64 + 4500;
		openedAt = Environment.TickCount64;
		int showGeneration = ++generation;
		Track("notch_shown");
		host.Real?.Canvas.SetBelowNotch(isBelow: true);
		SetDockTourShowcase?.Invoke(obj: true);
		Changed?.Invoke();
		Action openNotchOnHome = OpenNotchOnHome;
		if (openNotchOnHome != null)
		{
			openNotchOnHome();
		}
		else
		{
			Log.Info("drawn tour", "notch shown (no notch Home to open in this build)");
		}
		Sounds.Play("clicky-text-open", 0.3);
		Log.Info("drawn tour", "notch shown");
		After(host, 7.0, () =>
		{
			if (IsShowing && generation == showGeneration)
			{
				PopApps(host, fromBeat: false);
			}
		});
		After(host, 22.0, () =>
		{
			if (IsShowing && generation == showGeneration)
			{
				Close(host, "timeout");
			}
		});
	}

	public void PopApps(AppHost host, bool fromBeat = true)
	{
		if (!IsShowing)
		{
			Show(host);
		}
		if (hasPoppedApps)
		{
			return;
		}
		hasPoppedApps = true;
		int showGeneration = generation;
		IReadOnlyList<AgentIntegrationInfo> readOnlyList = SampleIntegrations(host.Proactive?.Integrations ?? Array.Empty<AgentIntegrationInfo>());
		Track("apps_popped", new JsonObject
		{
			["count"] = readOnlyList.Count,
			["from_beat"] = fromBeat
		});
		long val = Environment.TickCount64 + (long)((0.5 + 0.55 * (double)readOnlyList.Count + 2.5) * 1000.0);
		holdOpenUntil = Math.Max(holdOpenUntil, val);
		for (int i = 0; i < readOnlyList.Count; i++)
		{
			AgentIntegrationInfo integration = readOnlyList[i];
			After(host, 0.5 + 0.55 * (double)i, () =>
			{
				if (IsShowing && generation == showGeneration)
				{
					sampleIntegrationIds.Add(integration.Id);
					Changed?.Invoke();
					Sounds.Play("skill-up", 0.3);
				}
			});
		}
	}

	public void Close(AppHost host, string reason = "tour_end")
	{
		if (!IsShowing)
		{
			return;
		}
		IsShowing = false;
		JsonObject jsonObject = new JsonObject { ["reason"] = reason };
		long? num = openedAt;
		double seconds;
		if (num.HasValue)
		{
			long valueOrDefault = num.GetValueOrDefault();
			seconds = (double)(Environment.TickCount64 - valueOrDefault) / 1000.0;
		}
		else
		{
			seconds = 0.0;
		}
		jsonObject["seconds_open"] = ClickyAnalytics.RoundedSeconds(seconds);
		jsonObject["apps_popped"] = hasPoppedApps;
		Track("notch_closed", jsonObject);
		openedAt = null;
		int closeGeneration = ++generation;
		Action foldNotch = FoldNotch;
		if (foldNotch != null)
		{
			foldNotch();
		}
		else
		{
			host.Services.Presenter.DismissLiveEvent(typeof(NotchLiveEvent.AgentPeek));
		}
		Log.Info("drawn tour", "notch closed");
		After(host, 0.7, () =>
		{
			if (generation == closeGeneration)
			{
				host.Real?.Canvas.SetBelowNotch(isBelow: false);
				SetDockTourShowcase?.Invoke(obj: false);
				ShowsDock = false;
				sampleIntegrationIds.Clear();
				Changed?.Invoke();
			}
		});
	}

	public void FadeDrawingAway(AppHost host)
	{
		if (!IsShowing)
		{
			return;
		}
		double seconds = Math.Max(0.0, (double)(holdOpenUntil - Environment.TickCount64) / 1000.0);
		int showGeneration = generation;
		After(host, seconds, () =>
		{
			if (generation == showGeneration)
			{
				Close(host, "fade_away");
			}
		});
	}

	public void Reset(AppHost host)
	{
		Close(host, "reset");
	}

	public static IReadOnlyList<AgentIntegrationInfo> SampleIntegrations(IReadOnlyList<AgentIntegrationInfo> catalog)
	{
		List<AgentIntegrationInfo> sample = new List<AgentIntegrationInfo>();
		string[] preferredAppKeys = PreferredAppKeys;
		foreach (string key in preferredAppKeys)
		{
			AgentIntegrationInfo agentIntegrationInfo = catalog.FirstOrDefault((AgentIntegrationInfo agentIntegrationInfo2) => Matches(agentIntegrationInfo2, key) && sample.All((AgentIntegrationInfo s) => s.Id != agentIntegrationInfo2.Id));
			if ((object)agentIntegrationInfo != null)
			{
				sample.Add(agentIntegrationInfo);
			}
		}
		foreach (AgentIntegrationInfo integration in catalog)
		{
			if (sample.Count >= 4)
			{
				break;
			}
			if (sample.All((AgentIntegrationInfo s) => s.Id != integration.Id))
			{
				sample.Add(integration);
			}
		}
		return sample;
		static bool Matches(AgentIntegrationInfo agentIntegrationInfo2, string value)
		{
			_003C_003Ey__InlineArray3<string> buffer = default;
			buffer[0] = agentIntegrationInfo2.Id;
			buffer[1] = agentIntegrationInfo2.PrimaryToolkitSlug;
			buffer[2] = agentIntegrationInfo2.DisplayName;
			return string.Join(" ", (ReadOnlySpan<string?>)buffer).ToLowerInvariant().Replace(" ", "")
				.Contains(value);
		}
	}

	private static void After(AppHost host, double seconds, Action action)
	{
		DispatcherQueueTimer t = host.DispatcherQueue.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(Math.Max(0.001, seconds));
		t.IsRepeating = false;
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			t.Stop();
			action();
		};
		t.Start();
	}
}
