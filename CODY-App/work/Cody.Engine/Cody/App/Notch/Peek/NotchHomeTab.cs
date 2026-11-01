using System.Collections.Generic;
using System.Linq;
using HeyClicky.App.Design;
using HeyClicky.App.Services;
using HeyClicky.App.UI;
using HeyClicky.Core.Notch;
using HeyClicky.Core.Telemetry;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace HeyClicky.App.Notch.Peek;

public sealed class NotchHomeTab : Grid
{
	private readonly INotchHost host;

	private readonly TextBlock greeting;

	private readonly TextBlock status;

	private readonly Grid footer = new Grid
	{
		ColumnSpacing = 8.0
	};

	private bool listening;

	private string? footerLook;

	public Grid DockSlot { get; } = new Grid
	{
		Tag = "home-dock-slot"
	};

	public NotchHomeTab(INotchHost host)
	{
		this.host = host;
		RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(58.0)
		});
		RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(1.0, GridUnitType.Star)
		});
		RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(44.0)
		});
		greeting = Ui.Text("", 19.0, FontWeights.SemiBold, DS.White(0.95));
		greeting.HorizontalAlignment = HorizontalAlignment.Center;
		status = Ui.Text("", 12.0, FontWeights.Medium, DS.White(0.55), TextAlignment.Left, 1);
		status.HorizontalAlignment = HorizontalAlignment.Center;
		status.TextTrimming = TextTrimming.CharacterEllipsis;
		StackPanel item = new StackPanel
		{
			Spacing = 4.0,
			VerticalAlignment = VerticalAlignment.Center,
			Children = 
			{
				(UIElement)greeting,
				(UIElement)status
			}
		};
		Children.Add(item);
		Grid.SetRow(DockSlot, 1);
		Children.Add(DockSlot);
		footer.Margin = new Thickness(12.0, 0.0, 12.0, 0.0);
		footer.VerticalAlignment = VerticalAlignment.Top;
		footer.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		footer.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = new GridLength(1.0, GridUnitType.Star)
		});
		footer.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		Grid.SetRow(footer, 2);
		Children.Add(footer);
		Loaded += (object _, RoutedEventArgs _) =>
		{
			Refresh();
			BuildFooter();
			if (!listening)
			{
				listening = true;
				ConnectedApps.Changed += OnAppsChanged;
				HeaderPills.Changed += OnAppsChanged;
				NotchExtensions.ShowcaseChanged += OnAppsChanged;
				INotchHomeDock homeDock = NotchExtensions.HomeDock;
				if (homeDock != null)
				{
					homeDock.FrontCardSizeChanged += OnDockChanged;
				}
			}
			DockSlot.Children.Clear();
			FrameworkElement frameworkElement = NotchExtensions.HomeDock?.CreateHomeSlot();
			if ((object)frameworkElement != null)
			{
				DockSlot.Children.Add(frameworkElement);
			}
		};
		Unloaded += (object _, RoutedEventArgs _) =>
		{
			if (!IsLoaded && listening)
			{
				listening = false;
				ConnectedApps.Changed -= OnAppsChanged;
				HeaderPills.Changed -= OnAppsChanged;
				NotchExtensions.ShowcaseChanged -= OnAppsChanged;
				INotchHomeDock homeDock = NotchExtensions.HomeDock;
				if (homeDock != null)
				{
					homeDock.FrontCardSizeChanged -= OnDockChanged;
				}
			}
		};
	}

	private void OnAppsChanged()
	{
		DispatcherQueue.TryEnqueue(BuildFooter);
	}

	private void OnDockChanged()
	{
		DispatcherQueue.TryEnqueue(() =>
		{
			Refresh();
			host.Relayout();
		});
	}

	public void Refresh()
	{
		greeting.Text = NotchGreeting.Greeting(host.Services.Auth.User);
		TextBlock textBlock = status;
		string text = NotchExtensions.HomeDock?.StatusLine;
		textBlock.Text = ((text != null && text.Length > 0) ? text : ("Hold " + host.Services.Settings.PushToTalkDisplay + " and tell me what to take off your plate."));
	}

	private void BuildFooter()
	{
		IReadOnlyList<string> showcaseSampleIntegrationIds = NotchExtensions.ShowcaseSampleIntegrationIds;
		IEnumerable<string> enumerable2;
		if (showcaseSampleIntegrationIds.Count != 0)
		{
			IEnumerable<string> enumerable = showcaseSampleIntegrationIds;
			enumerable2 = enumerable;
		}
		else
		{
			enumerable2 = from a in ConnectedApps.Connected()
				select a.Id + "=" + a.LogoUrl;
		}
		IEnumerable<string> values = enumerable2;
		string text = $"{HeaderPills.HidesPromotionalButtons()}|{NotchPreferences.HasClickedHomeReferralButton}|{string.Join(",", values)}";
		if (!(text == footerLook) || footer.Children.Count <= 0)
		{
			footerLook = text;
			footer.Children.Clear();
			if (!HeaderPills.HidesPromotionalButtons())
			{
				footer.Children.Add(ReferralButton());
			}
			FrameworkElement frameworkElement = AppsPill();
			Grid.SetColumn(frameworkElement, 2);
			footer.Children.Add(frameworkElement);
		}
	}

	private FrameworkElement ReferralButton()
	{
		bool highlighted = !NotchPreferences.HasClickedHomeReferralButton;
		Pressable p = new Pressable
		{
			Height = 32.0,
			CornerRadius = new CornerRadius(100.0),
			Tag = "notch-referral"
		};
		Path gift = Icons.PathIcon("M2.5,8.2 h8.6 v3.8 h-8.6 z M12.9,8.2 h8.6 v3.8 h-8.6 z M4,13.4 h7.1 v8.1 h-5.6 a1.5,1.5 0 0 1 -1.5,-1.5 z M12.9,13.4 h7.1 v6.6 a1.5,1.5 0 0 1 -1.5,1.5 h-5.6 z M12,7.6 C10.6,4.6 7.8,2.8 6.6,4.2 C5.6,5.4 6.6,7.4 12,7.6 z M12,7.6 C13.4,4.6 16.2,2.8 17.4,4.2 C18.4,5.4 17.4,7.4 12,7.6 z", 10.0, Ink(hovered: false));
		TextBlock label = Ui.Text("Invite & earn", 11.0, FontWeights.SemiBold, Ink(hovered: false), TextAlignment.Left, 1);
		label.VerticalAlignment = VerticalAlignment.Center;
		StackPanel stackPanel = Ui.H(5.0, gift, label);
		stackPanel.VerticalAlignment = VerticalAlignment.Center;
		stackPanel.Margin = new Thickness(10.0, 0.0, 10.0, 0.0);
		if (highlighted)
		{
			GelSurface gel = new GelSurface(GelAppearance.Mint, 100.0);
			p.Children.Add(gel);
			p.HoverChanged += (bool h) =>
			{
				gel.Hovered = h;
			};
		}
		else
		{
			p.Background = Ui.Brush(DS.White(0.08));
			p.HoverChanged += (bool h) =>
			{
				p.Background = Ui.Brush(DS.White(h ? 0.14 : 0.08));
				gift.Fill = Ui.Brush(Ink(h));
				label.Foreground = Ui.Brush(Ink(h));
			};
		}
		p.Children.Add(stackPanel);
		AutomationProperties.SetName(p, "Invite & Earn");
		p.Click += () =>
		{
			NotchPreferences.HasClickedHomeReferralButton = true;
			ClickyAnalytics.NoteReferralPageEntryPoint("notch");
			(host.Services.Presenter as NotchPresenter)?.Tabs.ShowSettings(NotchSettingsSection.Referral);
		};
		return p;
		Color Ink(bool hovered)
		{
			if (!highlighted)
			{
				return DS.White(hovered ? 0.95 : 0.7);
			}
			return DS.Black(0.85);
		}
	}

	private FrameworkElement AppsPill()
	{
		IReadOnlyList<string> showcaseSampleIntegrationIds = NotchExtensions.ShowcaseSampleIntegrationIds;
		List<AppEntry> list = ((showcaseSampleIntegrationIds.Count == 0) ? ConnectedApps.Connected().ToList() : showcaseSampleIntegrationIds.Select((string id) => ConnectedApps.All().FirstOrDefault((AppEntry a) => a.Id == id)).OfType<AppEntry>().ToList());
		Pressable p = new Pressable
		{
			Height = 32.0,
			CornerRadius = new CornerRadius(100.0),
			Background = Ui.Brush(DS.White(0.08)),
			Tag = "notch-apps"
		};
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 4.0,
			VerticalAlignment = VerticalAlignment.Center,
			Margin = new Thickness(10.0, 0.0, 10.0, 0.0)
		};
		if (list.Count == 0)
		{
			TextBlock textBlock = Icons.Glyph("\ue71d", 10.0, DS.White(0.7));
			textBlock.FontWeight = FontWeights.SemiBold;
			stackPanel.Children.Add(textBlock);
		}
		else
		{
			foreach (AppEntry item in list.Take(3))
			{
				FrameworkElement frameworkElement = IntegrationLogos.Artwork(item.ToolkitSlug, item.DisplayName, 15.0, 9.0, item.LogoUrl);
				frameworkElement.Tag = "app:" + item.Id;
				stackPanel.Children.Add(frameworkElement);
			}
			if (list.Count > 3)
			{
				TextBlock textBlock2 = Ui.Text($"+{list.Count - 3}", 9.0, FontWeights.Bold, DS.White(0.6));
				textBlock2.VerticalAlignment = VerticalAlignment.Center;
				stackPanel.Children.Add(textBlock2);
			}
		}
		TextBlock appsLabel = Ui.Text("Apps", 11.0, FontWeights.SemiBold, DS.White(0.7), TextAlignment.Left, 1);
		appsLabel.VerticalAlignment = VerticalAlignment.Center;
		stackPanel.Children.Add(appsLabel);
		TextBlock textBlock3 = Icons.Glyph("\ue710", 8.5, DS.White(0.6));
		textBlock3.FontWeight = FontWeights.Bold;
		stackPanel.Children.Add(textBlock3);
		p.Children.Add(stackPanel);
		p.HoverChanged += (bool h) =>
		{
			p.Background = Ui.Brush(DS.White(h ? 0.14 : 0.08));
			appsLabel.Foreground = Ui.Brush(DS.White(h ? 0.95 : 0.7));
		};
		p.Tip((list.Count == 0) ? "Connect apps" : "Connected apps");
		AutomationProperties.SetName(p, "Apps");
		p.Click += () =>
		{
			NotchPeekSurface.PeekAction("open_integrations");
			(host.Services.Presenter as NotchPresenter)?.Tabs.ShowSettings(NotchSettingsSection.Integrations);
		};
		return p;
	}
}
