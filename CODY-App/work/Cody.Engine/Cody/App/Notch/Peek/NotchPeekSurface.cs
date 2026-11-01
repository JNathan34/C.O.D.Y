using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Text.Json.Nodes;
using HeyClicky.App.Design;
using HeyClicky.App.Home;
using HeyClicky.App.Services;
using HeyClicky.App.UI;
using HeyClicky.Core.Billing;
using HeyClicky.Core.Notch;
using HeyClicky.Core.Telemetry;
using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace HeyClicky.App.Notch.Peek;

public sealed class NotchPeekSurface : NotchSurface
{
	private readonly Grid view = new Grid();

	private readonly Grid background;

	private readonly Grid body = new Grid();

	private readonly Grid header = new Grid
	{
		Height = 30.0
	};

	private readonly Grid overlayLayer = new Grid();

	private readonly Grid pillLayer = new Grid
	{
		IsHitTestVisible = false,
		VerticalAlignment = VerticalAlignment.Top,
		HorizontalAlignment = HorizontalAlignment.Center
	};

	private readonly NotchTabSwitcher switcher;

	private readonly Grid planPillHost = new Grid
	{
		VerticalAlignment = VerticalAlignment.Center
	};

	private NotchPresenter? presenter;

	private NotchTabs? tabs;

	private FrameworkElement? homeTab;

	private FrameworkElement? chatTab;

	private FrameworkElement? settingsTab;

	private FrameworkElement? documentView;

	private FrameworkElement? documentHeader;

	private FrameworkElement? fullReply;

	private NotchChatView? chat;

	private NotchSettingsTab? settings;

	private NotchTab shownTab = (NotchTab)(-1);

	private string? shownReplyId;

	private bool attached;

	private bool snapTabs;

	private string? planPillKind;

	private FrameworkElement? visibleTab;

	public override FrameworkElement View => view;

	public override bool WantsKeyboard => false;

	public override VerticalAlignment ContentAlignment => VerticalAlignment.Stretch;

	public override bool HoldsKeyboard
	{
		get
		{
			NotchChatView? notchChatView = chat;
			if ((object)notchChatView == null || !notchChatView.ComposerHoldsKeyboard)
			{
				return settings?.HoldsKeyboard ?? false;
			}
			return true;
		}
	}

	public NotchPeekSurface()
	{
		view.Margin = new Thickness(0.0);
		background = new Grid
		{
			Margin = new Thickness(-18.0, -6.0, -18.0, -6.0),
			IsHitTestVisible = false,
			Opacity = 0.0
		};
		background.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(30.0)
		});
		background.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(56.0)
		});
		background.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(1.0, GridUnitType.Star)
		});
		Border border = new Border
		{
			Background = Ui.Vertical((0.0, Colors.Black), (1.0, HomeTheme.PaneFill))
		};
		Border border2 = new Border
		{
			Background = Ui.Brush(HomeTheme.PaneFill)
		};
		Grid.SetRow(border, 1);
		Grid.SetRow(border2, 2);
		background.Children.Add(new Border
		{
			Background = Ui.Brush(Colors.Black)
		});
		background.Children.Add(border);
		background.Children.Add(border2);
		view.Children.Add(background);
		body.Margin = new Thickness(0.0, 32.0, 0.0, 0.0);
		view.Children.Add(body);
		header.VerticalAlignment = VerticalAlignment.Top;
		header.Margin = new Thickness(12.0, -2.0, 12.0, 0.0);
		switcher = new NotchTabSwitcher();
		switcher.PlanPillHost = planPillHost;
		header.Children.Add(switcher);
		view.Children.Add(header);
		view.Children.Add(overlayLayer);
		pillLayer.Margin = new Thickness(0.0, 4.0, 0.0, 0.0);
		view.Children.Add(pillLayer);
	}

	public override bool CanUpdate(NotchPresentation p)
	{
		if (p is NotchPresentation.LiveEvent liveEvent)
		{
			return liveEvent.Event is NotchLiveEvent.AgentPeek;
		}
		return false;
	}

	public override void Update(NotchPresentation p)
	{
		Sync();
	}

	public override bool AcceptFiles(IReadOnlyList<string> paths)
	{
		bool flag = presenter == null || tabs == null;
		if (!flag)
		{
			NotchTab selected = tabs.Selected;
			bool flag2 = (uint)(selected - 2) <= 1u;
			flag = flag2;
		}
		if (flag)
		{
			return false;
		}
		string composerOpenSource = presenter.DropFilesOnNotchChat(paths);
		ClickyAnalytics.TrackNotchFilesDropped(paths.Count, composerOpenSource);
		return true;
	}

	public override void SetDropTargeting(bool on)
	{
		chat?.SetDropTargeting(on);
	}

	protected override void OnAttached()
	{
		attached = true;
		presenter = Host.Services.Presenter as NotchPresenter;
		tabs = presenter?.Tabs;
		switcher.Bind(Host, tabs);
		BuildPlanPill();
		HeaderPills.Changed += OnPillsChanged;
		if (tabs != null)
		{
			tabs.Changed += OnTabsChanged;
			tabs.SelectionChanged += OnSelectionChanged;
		}
		if (presenter != null)
		{
			presenter.VoicePillChanged += OnVoicePillChanged;
		}
		NotchExtensions.ShowcaseChanged += OnShowcaseChanged;
		NotchChat.History?.Refresh();
		NotchChat.HandOffs?.Load();
		BillingStateService billingStateService = Host.Services.Billing?.State;
		if (billingStateService != null && billingStateService.AuthenticatedUserId != null)
		{
			billingStateService.RefreshIfStaleAsync();
		}
		settings?.Attached();
		snapTabs = !StillShowing;
		Sync();
		snapTabs = false;
		OnVoicePillChanged();
		OnShowcaseChanged();
		PeekAction("opened_" + (tabs?.Selected ?? NotchTab.Home).RawValue());
	}

	public override void Detached()
	{
		if (attached)
		{
			attached = false;
			HeaderPills.Changed -= OnPillsChanged;
			if (tabs != null)
			{
				tabs.Changed -= OnTabsChanged;
				tabs.SelectionChanged -= OnSelectionChanged;
			}
			if (presenter != null)
			{
				presenter.VoicePillChanged -= OnVoicePillChanged;
			}
			NotchExtensions.ShowcaseChanged -= OnShowcaseChanged;
			chat?.Detached();
			settings?.Detached();
			presenter?.SetNotchAgentPeekHeldOpen(held: false);
			shownTab = (NotchTab)(-1);
			visibleTab = null;
		}
	}

	private void OnPillsChanged()
	{
		view.DispatcherQueue.TryEnqueue(BuildPlanPill);
	}

	private void OnTabsChanged()
	{
		view.DispatcherQueue.TryEnqueue(Sync);
	}

	private void OnSelectionChanged(NotchTab _)
	{
		view.DispatcherQueue.TryEnqueue(() =>
		{
			Sync();
			Host.Relayout();
		});
	}

	private void OnShowcaseChanged()
	{
		view.DispatcherQueue.TryEnqueue(() =>
		{
			view.IsHitTestVisible = !(presenter?.IsTourShowcaseShowing ?? false);
		});
	}

	private void BuildPlanPill()
	{
		AppServices services = Host.Services;
		string text;
		if (HeaderPills.ShowsUpdate(services))
		{
			text = "update";
		}
		else
		{
			text = (HeaderPills.ShowsUpgrade(services) ? "upgrade" : "none");
		}
		if (!(text == planPillKind))
		{
			planPillKind = text;
			planPillHost.Children.Clear();
			if (HeaderPills.ShowsUpdate(services))
			{
				planPillHost.Children.Add(HeaderPills.UpdateButton(services, "notch_peek", compact: true, iconOnly: false, Fold));
			}
			else if (HeaderPills.ShowsUpgrade(services))
			{
				planPillHost.Children.Add(HeaderPills.UpgradeButton(services, PaywallSource.NotchPeekUpgradeButton, compact: true, withIcon: false, Fold));
			}
		}
		void Fold()
		{
			presenter?.DismissNotchAgentPeek();
		}
	}

	private void Sync()
	{
		if (tabs == null)
		{
			return;
		}
		NotchTab selected = tabs.Selected;
		bool flag = selected == NotchTab.Document;
		NotchTab notchTab = (flag ? tabs.TabBeforeDocument : selected);
		if (notchTab == NotchTab.Document)
		{
			notchTab = NotchTab.Home;
		}
		bool flag2 = (uint)(selected - 1) <= 2u;
		bool flag3 = flag2;
		Anim.Opacity(background, flag3 ? 1 : 0, 0.18, Easing.EaseOut(Ui.Compositor));
		FrameworkElement frameworkElement = notchTab switch
		{
			NotchTab.Chat => chatTab ?? (chatTab = BuildChat()), 
			NotchTab.Settings => settingsTab ?? (settingsTab = BuildSettings()), 
			_ => homeTab ?? (homeTab = new NotchHomeTab(Host)), 
		};
		if (selected != shownTab)
		{
			FrameworkElement frameworkElement2 = (flag ? null : frameworkElement);
			foreach (FrameworkElement item in body.Children.OfType<FrameworkElement>().ToList())
			{
				if (!(item == frameworkElement2) && !(item == documentView))
				{
					if (item == settingsTab && visibleTab == settingsTab)
					{
						settings?.Hidden();
					}
					if (snapTabs)
					{
						SnapTab(item, shows: false);
					}
					else
					{
						FadeOutTab(item);
					}
				}
			}
			if (!body.Children.Contains(frameworkElement))
			{
				body.Children.Insert(0, frameworkElement);
				frameworkElement.Opacity = 0.0;
				if (flag)
				{
					frameworkElement.Visibility = Visibility.Collapsed;
				}
			}
			visibleTab = frameworkElement2;
			if ((object)frameworkElement2 != null)
			{
				if (snapTabs)
				{
					SnapTab(frameworkElement2, shows: true);
				}
				else
				{
					FadeInTab(frameworkElement2);
				}
				if (frameworkElement2 == settingsTab)
				{
					settings?.Shown();
				}
				if (frameworkElement2 == chatTab)
				{
					chat?.Shown();
				}
				if (frameworkElement2 == homeTab)
				{
					(homeTab as NotchHomeTab)?.Refresh();
				}
			}
			if (flag)
			{
				if ((object)documentView == null)
				{
					documentView = new NotchDocumentViewer(Host);
				}
				if (!body.Children.Contains(documentView))
				{
					body.Children.Add(documentView);
				}
				documentView.Opacity = 0.0;
				documentView.IsHitTestVisible = true;
				Anim.Opacity(documentView, 1f, 0.18, Easing.EaseOut(Ui.Compositor));
			}
			else if ((object)documentView != null && body.Children.Contains(documentView))
			{
				FrameworkElement leaving = documentView;
				leaving.IsHitTestVisible = false;
				if (snapTabs)
				{
					body.Children.Remove(leaving);
				}
				else
				{
					Anim.Opacity(leaving, 0f, 0.18, Easing.EaseOut(Ui.Compositor));
					After(0.2, () =>
					{
						NotchTabs? notchTabs = tabs;
						if (notchTabs == null || notchTabs.Selected != NotchTab.Document)
						{
							body.Children.Remove(leaving);
						}
					});
				}
			}
			bool flag4 = header.Children.Count > 0 && header.Children[0] != switcher;
			if (flag && !flag4)
			{
				header.Children.Clear();
				documentHeader = new NotchDocumentHeaderRow(Host);
				header.Children.Add(documentHeader);
			}
			else if (!flag && (flag4 || header.Children.Count == 0))
			{
				header.Children.Clear();
				header.Children.Add(switcher);
			}
			shownTab = selected;
			NotchExtensions.HomeDock?.NotchShowsHome(selected == NotchTab.Home);
		}
		if (flag)
		{
			(documentView as NotchDocumentViewer)?.Show(tabs.DocumentPath);
		}
		switcher.Select(selected, animated: true);
		SyncFullReply((selected == NotchTab.Chat) ? tabs.ExpandedReplyEntryId : null);
	}

	private void FadeInTab(FrameworkElement tab)
	{
		bool flag = tab.Visibility == Visibility.Collapsed;
		tab.Visibility = Visibility.Visible;
		tab.IsHitTestVisible = true;
		if (Anim.Instant)
		{
			Anim.Stop(tab, "Opacity");
			tab.Opacity = 1.0;
			return;
		}
		Compositor compositor = Ui.Compositor;
		ScalarKeyFrameAnimation scalarKeyFrameAnimation = compositor.CreateScalarKeyFrameAnimation();
		if (flag)
		{
			scalarKeyFrameAnimation.InsertKeyFrame(0f, 0f);
		}
		scalarKeyFrameAnimation.InsertKeyFrame(1f, 1f, Easing.EaseOut(compositor));
		scalarKeyFrameAnimation.Duration = TimeSpan.FromSeconds(Anim.ReduceMotion ? 0.12 : 0.18);
		scalarKeyFrameAnimation.Target = "Opacity";
		tab.StartAnimation(scalarKeyFrameAnimation);
	}

	private static void SnapTab(FrameworkElement tab, bool shows)
	{
		tab.Visibility = ((!shows) ? Visibility.Collapsed : Visibility.Visible);
		tab.IsHitTestVisible = shows;
		Anim.Opacity(tab, shows ? 1 : 0, 0.001);
	}

	private void FadeOutTab(FrameworkElement tab)
	{
		tab.IsHitTestVisible = false;
		if (tab.Visibility == Visibility.Collapsed)
		{
			return;
		}
		Anim.Opacity(tab, 0f, 0.18, Easing.EaseOut(Ui.Compositor));
		After(0.2, () =>
		{
			if (tab != visibleTab)
			{
				tab.Visibility = Visibility.Collapsed;
			}
		});
	}

	private void After(double seconds, Action action)
	{
		DispatcherQueueTimer t = view.DispatcherQueue.CreateTimer().Rooted();
		t.Interval = TimeSpan.FromSeconds(seconds);
		t.IsRepeating = false;
		t.Tick += (DispatcherQueueTimer _, object _) =>
		{
			t.Stop();
			action();
		};
		t.Start();
	}

	private FrameworkElement BuildChat()
	{
		chat = new NotchChatView(Host);
		return chat;
	}

	private FrameworkElement BuildSettings()
	{
		settings = new NotchSettingsTab(Host);
		return settings;
	}

	private void SyncFullReply(string? entryId)
	{
		if (entryId != null && (object)NotchChat.HandOffs?.Entry(entryId) == null)
		{
			entryId = null;
		}
		if (entryId == shownReplyId)
		{
			return;
		}
		shownReplyId = entryId;
		FrameworkElement frameworkElement = fullReply;
		if ((object)frameworkElement != null)
		{
			FrameworkElement leaving = frameworkElement;
			Anim.Opacity(leaving, 0f, 0.18, Easing.EaseOut(Ui.Compositor));
			DispatcherQueueTimer dispatcherQueueTimer = view.DispatcherQueue.CreateTimer().Rooted();
			dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(0.2);
			dispatcherQueueTimer.IsRepeating = false;
			dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
			{
				overlayLayer.Children.Remove(leaving);
			};
			dispatcherQueueTimer.Start();
			fullReply = null;
		}
		NotchFullReply reply;
		SwiftSpring spring;
		if (entryId != null)
		{
			reply = new NotchFullReply(Host, entryId);
			fullReply = reply;
			overlayLayer.Children.Add(reply);
			reply.Opacity = 0.0;
			spring = new SwiftSpring(0.32, 0.88);
			if (!Anim.ReduceMotion)
			{
				reply.SizeChanged += Grow;
			}
			else
			{
				Anim.OpacitySpring(reply, 1f, spring);
			}
		}
		void Grow(object sender, SizeChangedEventArgs e)
		{
			reply.SizeChanged -= Grow;
			Anim.ScaleUpFrom(reply, 0.98f, spring, new Vector3((float)e.NewSize.Width / 2f, 0f, 0f));
			Anim.OpacitySpring(reply, 1f, spring);
		}
	}

	private void OnVoicePillChanged()
	{
		view.DispatcherQueue.TryEnqueue(() =>
		{
			(NotchActivityPhase, string)? phase = presenter?.VoicePill;
			NotchPresenter? notchPresenter = presenter;
			if (notchPresenter != null && notchPresenter.IsNotchHeldOpenByArc)
			{
				phase = null;
			}
			NotchVoicePill.Update(pillLayer, phase, Host);
		});
	}

	internal static void PeekAction(string action, JsonObject? extra = null)
	{
		JsonObject jsonObject = extra ?? new JsonObject();
		jsonObject["action"] = action;
		ClickyAnalytics.TrackProductEvent("notch_peek_action", null, null, jsonObject);
	}
}
