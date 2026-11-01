using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using HeyClicky.App.Design;
using HeyClicky.App.Home;
using HeyClicky.App.Services;
using HeyClicky.App.UI;
using HeyClicky.Core.Notch;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace HeyClicky.App.Notch.Peek;

public sealed class ChatHandOffRow : StackPanel
{
	private sealed class StartMark : Grid
	{
		private readonly ChatHandOff entry;

		private readonly IChatLiveWork live;

		private readonly int seed;

		private bool? showsPencil;

		private bool listening;

		public StartMark(ChatHandOff entry, IChatLiveWork live, int seed)
		{
			StartMark startMark = this;
			this.entry = entry;
			this.live = live;
			this.seed = seed;
			VerticalAlignment = VerticalAlignment.Center;
			Update();
			Loaded += (object _, RoutedEventArgs _) =>
			{
				if (!startMark.listening)
				{
					startMark.listening = true;
					live.Changed += startMark.OnWorkChanged;
				}
				startMark.Update();
			};
			Unloaded += (object _, RoutedEventArgs _) =>
			{
				if (startMark.listening && !startMark.IsLoaded)
				{
					startMark.listening = false;
					live.Changed -= startMark.OnWorkChanged;
				}
			};
		}

		private void OnWorkChanged()
		{
			if (DispatcherQueue.HasThreadAccess)
			{
				Update();
			}
			else
			{
				DispatcherQueue.TryEnqueue(Update);
			}
		}

		private void Update()
		{
			bool flag = live.IsWorking(entry);
			if (showsPencil != flag)
			{
				showsPencil = flag;
				Children.Clear();
				if (flag)
				{
					Children.Add(BusyPencil());
				}
				else if (entry.IsFollowUp)
				{
					Children.Add(ChatStamp.Create(ChatStamp.Status.Working, "sent", seed));
				}
				Visibility = ((Children.Count <= 0) ? Visibility.Collapsed : Visibility.Visible);
			}
		}
	}

	private static readonly HashSet<string> foldedEntryIds = new HashSet<string>();

	public ChatHandOffRow(INotchHost host, ChatHandOff entry, IReadOnlyList<ChatHandOff> allEntries)
	{
		Spacing = 6.0;
		IChatLiveWork liveWork = NotchExtensions.LiveWork;
		bool flag = allEntries.LastOrDefault((ChatHandOff e) => e.TargetKey == entry.TargetKey)?.Id == entry.Id;
		bool flag2 = (entry.Kind == ChatHandOffKind.Started) & flag;
		string displayName = liveWork?.DisplayName(entry) ?? entry.Title;
		Children.Add(Header(entry, displayName, flag2, liveWork));
		if (flag2)
		{
			FrameworkElement frameworkElement = liveWork?.WorkCard(entry);
			if ((object)frameworkElement != null)
			{
				frameworkElement.Margin = new Thickness(30.0, 0.0, 0.0, 0.0);
				Children.Add(frameworkElement);
			}
		}
		if (entry.Kind != ChatHandOffKind.CameBack)
		{
			return;
		}
		int count = Children.Count;
		FrameworkElement reply = null;
		string fullReply = entry.FullReply;
		if (fullReply != null && fullReply.Length > 0)
		{
			Children.Add(reply = ReplyBlock(host, entry.Id, fullReply));
		}
		else
		{
			string replyText = entry.ReplyText;
			if (replyText != null && replyText.Length > 0)
			{
				FrameworkElement frameworkElement2 = ChatBubbles.Bubble(replyText, outgoing: false, tail: true);
				frameworkElement2.MaxWidth = 420.0;
				frameworkElement2.Margin = new Thickness(30.0, 0.0, 0.0, 0.0);
				Children.Add(reply = frameworkElement2);
			}
		}
		IReadOnlyList<string> artifactEntries = entry.ArtifactEntries;
		if (artifactEntries != null && artifactEntries.Count > 0)
		{
			FrameworkElement frameworkElement3 = liveWork?.FileCards(artifactEntries, Open) ?? FilePills(artifactEntries, Open);
			frameworkElement3.Margin = new Thickness(30.0, 4.0, 0.0, 0.0);
			Children.Add(frameworkElement3);
		}
		if ((entry.Outcome == ChatHandOffOutcome.NeedsYou) & flag)
		{
			FrameworkElement frameworkElement4 = liveWork?.WorkCard(entry);
			if ((object)frameworkElement4 != null)
			{
				frameworkElement4.Margin = new Thickness(30.0, 0.0, 0.0, 0.0);
				Children.Add(frameworkElement4);
			}
		}
		StartFoldIfFresh(entry, liveWork, count, reply);
		void Open(string artifact)
		{
			NotchPeekSurface.PeekAction("chat_artifact_opened", NotchChatAnalytics.ChatArtifactOpened("chat", artifact));
			(host.Actions as INotchActions)?.OpenChatArtifact(artifact, entry.ThreadId, entry.ClickySlug);
		}
	}

	private void StartFoldIfFresh(ChatHandOff entry, IChatLiveWork? live, int replyStart, FrameworkElement? reply)
	{
		ChatHandOffOutcome? outcome = entry.Outcome;
		bool flag = ((!outcome.HasValue || outcome.GetValueOrDefault() == ChatHandOffOutcome.Finished) ? true : false);
		if (!flag || Anim.ReduceMotion || live == null || DateTimeOffset.UtcNow - entry.CreatedAt >= TimeSpan.FromSeconds(6L) || foldedEntryIds.Contains(entry.Id))
		{
			return;
		}
		List<UIElement> replyPart = Children.Skip(replyStart).ToList();
		FrameworkElement fold = null;
		fold = live.PlanFold(entry, () =>
		{
			Children.Remove(fold);
			foreach (UIElement item in replyPart)
			{
				item.Visibility = Visibility.Visible;
			}
			if ((object)reply != null)
			{
				SwiftSpring spring = new SwiftSpring(0.42, 0.86);
				reply.Opacity = 0.0;
				reply.Translation = new Vector3(0f, 10f, 0f);
				Anim.OpacitySpring(reply, 1f, spring);
				Anim.TranslationSpring(reply, Vector3.Zero, spring);
			}
		});
		if ((object)fold == null)
		{
			return;
		}
		foldedEntryIds.Add(entry.Id);
		fold.Margin = new Thickness(30.0, 0.0, 0.0, 0.0);
		foreach (UIElement item2 in replyPart)
		{
			item2.Visibility = Visibility.Collapsed;
		}
		Children.Insert(replyStart, fold);
	}

	private static FrameworkElement Header(ChatHandOff entry, string displayName, bool isNewestStart, IChatLiveWork? live)
	{
		Grid grid = new Grid
		{
			ColumnSpacing = 8.0
		};
		grid.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = GridLength.Auto
		});
		grid.ColumnDefinitions.Add(new ColumnDefinition
		{
			Width = new GridLength(1.0, GridUnitType.Star)
		});
		FrameworkElement item = live?.Chip(entry, 22.0) ?? PlainChip(entry);
		grid.Children.Add(item);
		StackPanel stackPanel = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			Spacing = 8.0,
			VerticalAlignment = VerticalAlignment.Center
		};
		TextBlock text = new TextBlock
		{
			FontSize = 11.5,
			FontWeight = FontWeights.Medium,
			FontFamily = DS.Fonts.Small,
			IsTextScaleFactorEnabled = false,
			TextTrimming = TextTrimming.CharacterEllipsis,
			TextWrapping = TextWrapping.NoWrap,
			VerticalAlignment = VerticalAlignment.Center
		};
		Color secondaryText = HomeTheme.SecondaryText;
		Color primaryText = HomeTheme.PrimaryText;
		string text2 = (string.IsNullOrEmpty(entry.TaskTitle) ? null : entry.TaskTitle);
		string s = text2 ?? displayName;
		bool flag = text2 != null && text2 != displayName;
		switch (entry.Kind)
		{
		case ChatHandOffKind.Started:
			if (entry.IsFollowUp)
			{
				Part("Sent to background job ", secondaryText);
				Part(displayName, primaryText, bold: true);
				if (text2 != null)
				{
					Part(": " + text2, secondaryText);
				}
			}
			else
			{
				Part("Started background job ", secondaryText);
				Part(s, primaryText, bold: true);
				if (flag)
				{
					Part("  ·  " + displayName, secondaryText);
				}
			}
			break;
		case ChatHandOffKind.CameBack:
			if (entry.IsRoutineRun == true)
			{
				Part("Routine run · ", secondaryText);
			}
			Part(s, primaryText, bold: true);
			Part(entry.Outcome.GetValueOrDefault() switch
			{
				ChatHandOffOutcome.Finished => " is done", 
				ChatHandOffOutcome.Failed => " couldn't finish", 
				ChatHandOffOutcome.Stopped => " was stopped", 
				_ => " needs a yes", 
			}, secondaryText);
			if (flag)
			{
				Part("  ·  " + displayName, secondaryText);
			}
			break;
		default:
			Part(entry.Title, primaryText);
			break;
		}
		Part("  ·  " + ChatBubbles.ShortTime(entry.CreatedAt), HomeTheme.TertiaryText);
		stackPanel.Children.Add(text);
		int seed = ChatStamp.Seed(entry.Id);
		ChatHandOffKind kind = entry.Kind;
		FrameworkElement frameworkElement;
		if (kind != ChatHandOffKind.Started)
		{
			if (kind != ChatHandOffKind.CameBack)
			{
				goto IL_0369;
			}
			frameworkElement = entry.Outcome.GetValueOrDefault() switch
			{
				ChatHandOffOutcome.Finished => ChatStamp.Create(ChatStamp.Status.Ready, "done", seed), 
				ChatHandOffOutcome.Failed => ChatStamp.Create(ChatStamp.Status.NeedsYou, "oops", seed), 
				ChatHandOffOutcome.Stopped => ChatStamp.Create(ChatStamp.Status.Paused, "stopped", seed), 
				_ => ChatStamp.Create(ChatStamp.Status.NeedsYou, "you", seed), 
			};
		}
		else if (isNewestStart && live != null)
		{
			frameworkElement = new StartMark(entry, live, seed);
		}
		else
		{
			if (!entry.IsFollowUp)
			{
				goto IL_0369;
			}
			frameworkElement = ChatStamp.Create(ChatStamp.Status.Working, "sent", seed);
		}
		goto IL_036c;
		IL_0369:
		frameworkElement = null;
		goto IL_036c;
		IL_036c:
		FrameworkElement frameworkElement2 = frameworkElement;
		if ((object)frameworkElement2 != null)
		{
			stackPanel.Children.Add(frameworkElement2);
		}
		Grid.SetColumn(stackPanel, 1);
		grid.Children.Add(stackPanel);
		return grid;
		void Part(string text3, Color c, bool bold = false)
		{
			text.Inlines.Add(new Run
			{
				Text = text3,
				Foreground = Ui.Brush(c),
				FontWeight = (bold ? FontWeights.Bold : FontWeights.Medium)
			});
		}
	}

	private static FrameworkElement BusyPencil()
	{
		TextBlock pencil = Icons.Glyph("\ue70f", 11.0, ChatStamp.OnBlack(ChatStamp.Status.Working));
		pencil.FontWeight = FontWeights.SemiBold;
		pencil.Loaded += (object _, RoutedEventArgs _) =>
		{
			if (!Anim.ReduceMotion)
			{
				Anim.LoopScalar(pencil, "Opacity", 1.2, (double x) => (float)(0.45 + 0.55 * Math.Abs(Math.Cos(Math.PI * x / 1.2))), 24);
			}
		};
		ToolTipService.SetToolTip(pencil, "Working on it");
		return pencil;
	}

	private static FrameworkElement PlainChip(ChatHandOff entry)
	{
		Border border = new Border
		{
			Width = 22.0,
			Height = 22.0,
			CornerRadius = new CornerRadius(6.6),
			Background = Ui.Brush(HomeTheme.AvatarPlate),
			VerticalAlignment = VerticalAlignment.Center
		};
		TextBlock textBlock = Icons.Glyph((entry.JobId != null) ? "\ue821" : "\ue77b", 10.0, HomeTheme.SecondaryText);
		textBlock.FontWeight = FontWeights.SemiBold;
		border.Child = textBlock;
		return border;
	}

	private static FrameworkElement ReplyBlock(INotchHost host, string entryId, string markdown)
	{
		(string, bool) tuple = ChatReplyPreview.Parts(markdown);
		(string, bool) tuple2 = ChatReplyPreview.Preview(ChatReplyPreview.BubbleText(ChatReplyPreview.WithoutCitations(tuple.Item1 ?? markdown)));
		StackPanel stackPanel = new StackPanel
		{
			Spacing = 4.0,
			MaxWidth = 420.0,
			HorizontalAlignment = HorizontalAlignment.Left,
			Margin = new Thickness(30.0, 0.0, 0.0, 0.0)
		};
		stackPanel.Children.Add(ChatBubbles.Bubble(tuple2.Item1, outgoing: false, tail: true));
		if (tuple2.Item2 || (tuple.Item1 != null && tuple.Item2))
		{
			Pressable pressable = new Pressable
			{
				HorizontalAlignment = HorizontalAlignment.Left,
				Padding = new Thickness(6.0, 0.0, 6.0, 0.0)
			};
			TextBlock label = Ui.Text("Show more", 11.5, FontWeights.SemiBold, HomeTheme.SecondaryText.WithAlpha(0.75));
			TextBlock glyph = Icons.Glyph("\ue740", 8.5, HomeTheme.SecondaryText.WithAlpha(0.75));
			glyph.FontWeight = FontWeights.Bold;
			pressable.Children.Add(Ui.H(4.0, label, glyph));
			pressable.HoverChanged += (bool h) =>
			{
				SolidColorBrush foreground = Ui.Brush(HomeTheme.SecondaryText.WithAlpha(h ? 1.0 : 0.75));
				label.Foreground = foreground;
				glyph.Foreground = foreground;
			};
			pressable.Click += () =>
			{
				NotchPeekSurface.PeekAction("chat_reply_show_more");
				if (host.Services.Presenter is NotchPresenter notchPresenter)
				{
					notchPresenter.Tabs.TrackFullReplyOpened(entryId, NotchChatFullReplyOpenSource.ShowMore);
					notchPresenter.Tabs.ExpandedReplyEntryId = entryId;
				}
			};
			stackPanel.Children.Add(pressable);
		}
		return stackPanel;
	}

	public static FrameworkElement FilePills(IReadOnlyList<string> entries, Action<string> open)
	{
		WrapPanel wrapPanel = new WrapPanel
		{
			HorizontalSpacing = 6.0,
			VerticalSpacing = 6.0
		};
		foreach (string entry in entries.Take(8))
		{
			object text;
			if (ArtifactPaths.IsWebLink(entry))
			{
				text = (Uri.TryCreate(entry, UriKind.Absolute, out Uri result) ? result.Host : entry);
			}
			else
			{
				text = Path.GetFileName(entry.TrimEnd(new char[2] { '/', '\\' }));
			}
			Pressable pressable = new Pressable
			{
				CornerRadius = new CornerRadius(9.0),
				Background = Ui.Brush(Colors.White),
				Padding = new Thickness(8.0, 5.0, 10.0, 5.0)
			};
			TextBlock textBlock = Icons.Glyph(ArtifactPaths.IsWebLink(entry) ? "\ue774" : "\ue8a5", 11.0, DS.Black(0.7));
			TextBlock textBlock2 = Ui.Text((string)text, 11.5, FontWeights.SemiBold, DS.Black(0.85), TextAlignment.Left, 1);
			textBlock2.MaxWidth = 220.0;
			textBlock2.TextTrimming = TextTrimming.CharacterEllipsis;
			pressable.Children.Add(Ui.H(6.0, textBlock, textBlock2));
			pressable.WithHoverScale(1.03f);
			pressable.Click += () =>
			{
				open(entry);
			};
			pressable.Tip(entry);
			wrapPanel.Children.Add(pressable);
		}
		return wrapPanel;
	}
}
