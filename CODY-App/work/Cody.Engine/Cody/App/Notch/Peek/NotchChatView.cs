using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using HeyClicky.App.Design;
using HeyClicky.App.Home;
using HeyClicky.App.Services;
using HeyClicky.App.UI;
using HeyClicky.Core.Notch;
using HeyClicky.Core.Telemetry;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace HeyClicky.App.Notch.Peek;

public sealed class NotchChatView : Grid
{
	private readonly INotchHost host;

	private readonly NotchPresenter? presenter;

	private readonly ScrollViewer scroller;

	private readonly StackPanel list = new StackPanel
	{
		Padding = new Thickness(12.0, 0.0, 12.0, 0.0)
	};

	private readonly Border bottomSpacer = new Border();

	private readonly Grid earlierRow = new Grid
	{
		Height = 28.0
	};

	private readonly StackPanel emptyState = new StackPanel
	{
		Spacing = 8.0,
		HorizontalAlignment = HorizontalAlignment.Center,
		VerticalAlignment = VerticalAlignment.Center,
		Margin = new Thickness(24.0, 0.0, 24.0, 64.0)
	};

	private readonly Border bottomFade;

	private readonly Border bottomFill;

	private readonly NotchChatComposer composer;

	private readonly Pressable jumpDisc;

	private readonly Dictionary<string, (ChatRow Row, FrameworkElement View, string Look)> built = new Dictionary<string, (ChatRow, FrameworkElement, string)>();

	private int shownRowCount = 40;

	private bool waitingForEarlierPage;

	private bool isAwayFromBottom;

	private bool nearTop;

	private bool attached;

	private bool renderQueued;

	private bool newestWhenShown;

	private string? lastFocusedEntry;

	private string? emptyStateShown;

	private string? earlierRowShown;

	private int earlierPagesLoadedCount;

	public bool ComposerHoldsKeyboard => composer.HoldsKeyboard;

	public NotchChatView(INotchHost host)
	{
		this.host = host;
		presenter = host.Services.Presenter as NotchPresenter;
		Width = 500.0;
		Height = NotchPeekLayout.ChatBodyFrameHeight;
		HorizontalAlignment = HorizontalAlignment.Center;
		VerticalAlignment = VerticalAlignment.Top;
		Ui.ClipRounded(this, 0.0);
		Children.Add(BoardDots(500.0, NotchPeekLayout.ChatBodyFrameHeight, DS.White(0.09)));
		StackPanel content = new StackPanel
		{
			Children = 
			{
				(UIElement)new Border
				{
					Height = 40.0
				},
				(UIElement)earlierRow,
				(UIElement)list,
				(UIElement)bottomSpacer
			}
		};
		scroller = new ScrollViewer
		{
			Content = content,
			VerticalScrollBarVisibility = ScrollBarVisibility.Hidden,
			HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
			HorizontalScrollMode = ScrollMode.Disabled,
			IsTabStop = false
		};
		scroller.ViewChanged += (object? _, ScrollViewerViewChangedEventArgs _) =>
		{
			OnScrolled();
		};
		Children.Add(scroller);
		Children.Add(emptyState);
		Children.Add(NotchTopFade.Create(8.0));
		bottomFade = new Border
		{
			Height = 38.0,
			VerticalAlignment = VerticalAlignment.Bottom,
			IsHitTestVisible = false,
			Background = Ui.Vertical((0.0, HomeTheme.PaneFill.WithAlpha(0.0)), (1.0, HomeTheme.PaneFill))
		};
		bottomFill = new Border
		{
			VerticalAlignment = VerticalAlignment.Bottom,
			IsHitTestVisible = false,
			Background = Ui.Brush(HomeTheme.PaneFill)
		};
		Children.Add(bottomFade);
		Children.Add(bottomFill);
		composer = new NotchChatComposer(host);
		composer.ExtraHeightChanged += (double _) =>
		{
			LayoutComposerBand();
		};
		Children.Add(composer);
		jumpDisc = new Pressable
		{
			Width = 34.0,
			Height = 34.0,
			HorizontalAlignment = HorizontalAlignment.Right,
			VerticalAlignment = VerticalAlignment.Bottom,
			Opacity = 0.0,
			IsHitTestVisible = false
		};
		Ellipse ring = new Ellipse
		{
			Fill = Ui.Brush(HomeTheme.IncomingBubble),
			Stroke = Ui.Brush(DS.White(0.16)),
			StrokeThickness = 1.0
		};
		jumpDisc.Children.Add(new ShadowLayer(17.0, DS.Black(0.35), 8.0, 3.0));
		jumpDisc.Children.Add(ring);
		TextBlock textBlock = Icons.Glyph("\ue74b", 13.0, Colors.White);
		textBlock.FontWeight = FontWeights.Bold;
		jumpDisc.Children.Add(textBlock);
		jumpDisc.HoverChanged += (bool h) =>
		{
			ring.Stroke = Ui.Brush(DS.White(h ? 0.35 : 0.16));
			Anim.Scale(jumpDisc, h ? 1.06f : 1f, 0.15, Easing.EaseOut(Ui.Compositor), new Vector3(17f, 17f, 0f));
		};
		jumpDisc.Click += () =>
		{
			NotchPeekSurface.PeekAction("chat_scroll_to_bottom");
			scroller.ChangeView(null, scroller.ScrollableHeight, null, disableAnimation: false);
		};
		jumpDisc.Tip("Jump to the newest message");
		Children.Add(jumpDisc);
		LayoutComposerBand();
		Loaded += (object _, RoutedEventArgs _) =>
		{
			Attach();
		};
		Unloaded += (object _, RoutedEventArgs _) =>
		{
			if (!IsLoaded)
			{
				Detach();
			}
		};
	}

	public void SetDropTargeting(bool on)
	{
		composer.SetDropTargeting(on);
	}

	public void Shown()
	{
		if (!isAwayFromBottom || newestWhenShown)
		{
			ScrollToBottom();
		}
		newestWhenShown = false;
		RenderSoon();
		composer.TakeFocusIfRequested();
	}

	public void Detached()
	{
		composer.Detached();
	}

	private void Attach()
	{
		if (!attached)
		{
			attached = true;
			ConversationHistory history = NotchChat.History;
			if (history != null)
			{
				history.Changed += RenderSoon;
			}
			ChatHandOffs handOffs = NotchChat.HandOffs;
			if (handOffs != null)
			{
				handOffs.Changed += RenderSoon;
			}
			if (presenter != null)
			{
				presenter.PresentationChanged += OnPresentationChanged;
				presenter.Tabs.Changed += RenderSoon;
				presenter.Tabs.ComposerFocusRequested += OnComposerFocusRequested;
				presenter.DroppedAttachmentsPending += OnDroppedAttachments;
				presenter.NotchSessionChanged += OnSessionChanged;
			}
			host.Services.Companion.StateChanged += OnCompanionChanged;
			host.Services.Companion.ResponseTextUpdated += OnResponseText;
			Render();
			ScrollToBottom();
			newestWhenShown = Visibility != Visibility.Visible;
			composer.TakeFocusIfRequested();
			composer.DrainDroppedAttachments();
		}
	}

	private void Detach()
	{
		if (attached)
		{
			attached = false;
			ConversationHistory history = NotchChat.History;
			if (history != null)
			{
				history.Changed -= RenderSoon;
			}
			ChatHandOffs handOffs = NotchChat.HandOffs;
			if (handOffs != null)
			{
				handOffs.Changed -= RenderSoon;
			}
			if (presenter != null)
			{
				presenter.PresentationChanged -= OnPresentationChanged;
				presenter.Tabs.Changed -= RenderSoon;
				presenter.Tabs.ComposerFocusRequested -= OnComposerFocusRequested;
				presenter.DroppedAttachmentsPending -= OnDroppedAttachments;
				presenter.NotchSessionChanged -= OnSessionChanged;
			}
			host.Services.Companion.StateChanged -= OnCompanionChanged;
			host.Services.Companion.ResponseTextUpdated -= OnResponseText;
			composer.Detached();
		}
	}

	private void OnPresentationChanged(object? sender, EventArgs e)
	{
		RenderSoon();
	}

	private void OnCompanionChanged(object? sender, EventArgs e)
	{
		RenderSoon();
	}

	private void OnResponseText(object? sender, string e)
	{
		RenderSoon();
	}

	private void OnComposerFocusRequested()
	{
		DispatcherQueue.TryEnqueue(composer.TakeFocusIfRequested);
	}

	private void OnDroppedAttachments()
	{
		DispatcherQueue.TryEnqueue(composer.DrainDroppedAttachments);
	}

	private void OnSessionChanged()
	{
		DispatcherQueue.TryEnqueue(() =>
		{
			NotchPresenter? notchPresenter = presenter;
			if (notchPresenter != null && !notchPresenter.IsNotchChatSessionOpen)
			{
				composer.ChatSessionClosed();
			}
		});
	}

	private void LayoutComposerBand()
	{
		double extraHeight = composer.ExtraHeight;
		double num = 54.0 + extraHeight;
		bottomFill.Height = num;
		bottomFade.Margin = new Thickness(0.0, 0.0, 0.0, num);
		bottomSpacer.Height = 64.0 + extraHeight + 6.0;
		jumpDisc.Margin = new Thickness(0.0, 0.0, 12.0, 64.0 + extraHeight + 8.0);
	}

	private void RenderSoon()
	{
		if (renderQueued)
		{
			return;
		}
		renderQueued = true;
		DispatcherQueue.TryEnqueue(() =>
		{
			renderQueued = false;
			if (attached)
			{
				Render();
			}
		});
	}

	private List<ChatRow> CurrentRows()
	{
		ConversationHistory history = NotchChat.History;
		IReadOnlyList<ChatHandOff> handOffs = NotchChat.HandOffs?.Entries ?? Array.Empty<ChatHandOff>();
		ChatLiveReply liveReply = null;
		if (presenter != null && history != null)
		{
			liveReply = ChatTranscript.LiveReply(presenter.RendersTextResponsesInNotchChat, presenter.IsTextResponseInProgress, presenter.CurrentTextResponse?.Answer ?? "", presenter.CustomStatusLabel, history.LiveReplyMessageId(), DateTimeOffset.UtcNow);
		}
		return ChatTranscript.Rows(history?.Messages ?? Array.Empty<ConversationMessage>(), handOffs, liveReply, history?.LastAnswerEndedAt, DateTimeOffset.UtcNow);
	}

	private void Render()
	{
		ConversationHistory history = NotchChat.History;
		List<ChatRow> list = CurrentRows();
		RenderEmptyState(list.Count == 0, history);
		scroller.Visibility = ((list.Count == 0) ? Visibility.Collapsed : Visibility.Visible);
		List<ChatRow> list2 = list.Skip(Math.Max(0, list.Count - shownRowCount)).ToList();
		bool hasMoreAbove = list.Count > list2.Count || (history?.HasEarlierMessages ?? false);
		RenderEarlierRow(hasMoreAbove, history, list.Count);
		double num = scroller.ExtentHeight - scroller.VerticalOffset - scroller.ViewportHeight;
		bool flag = !isAwayFromBottom;
		string text = presenter?.Tabs.ChatFocusEntryId;
		IReadOnlyList<ChatHandOff> allEntries = NotchChat.HandOffs?.Entries ?? Array.Empty<ChatHandOff>();
		HashSet<string> hashSet = (from r in list2.TakeLast(3)
			select r.Id).ToHashSet();
		HashSet<string> keep = new HashSet<string>();
		List<FrameworkElement> list3 = new List<FrameworkElement>(list2.Count);
		bool flag2 = built.Count == 0;
		bool flag3 = false;
		int num2 = 0;
		int num3 = 0;
		foreach (ChatRow item in list2)
		{
			keep.Add(item.Id);
			string focus = ((item is ChatRow.HandOff handOff && handOff.Entry.Id == text) ? text : null);
			string text2 = RowLook(item, focus, allEntries);
			if (built.TryGetValue(item.Id, out (ChatRow, FrameworkElement, string) value))
			{
				if (value.Item3 == text2 && (item is ChatRow.Message || value.Item1 == item))
				{
					list3.Add(value.Item2);
					continue;
				}
				if (item is ChatRow.Message message && value.Item1 is ChatRow.Message message2 && message2.IsFirstOfRun == message.IsFirstOfRun && value.Item2 is ChatMessageRow chatMessageRow && chatMessageRow.TryGrow(message.Value, message.IsLastOfRun))
				{
					built[item.Id] = (item, value.Item2, text2);
					list3.Add(value.Item2);
					flag3 = true;
					num3++;
					continue;
				}
			}
			FrameworkElement frameworkElement = Build(item, focus, allEntries);
			num2++;
			if (!flag2 && !built.ContainsKey(item.Id) && hashSet.Contains(item.Id))
			{
				Arrive(frameworkElement, item);
			}
			built[item.Id] = (item, frameworkElement, text2);
			list3.Add(frameworkElement);
		}
		foreach (string item2 in built.Keys.Where((string k) => !keep.Contains(k)).ToList())
		{
			built.Remove(item2);
		}
		if (Reconcile(this.list.Children, list3) | flag3)
		{
			scroller.UpdateLayout();
			if (flag)
			{
				scroller.ChangeView(null, scroller.ScrollableHeight, null, disableAnimation: true);
			}
			else if (!double.IsNaN(num))
			{
				scroller.ChangeView(null, Math.Max(0.0, scroller.ExtentHeight - scroller.ViewportHeight - num), null, disableAnimation: true);
			}
		}
		if (text != null && text != lastFocusedEntry)
		{
			ScrollToFocusedEntry(text);
		}
		lastFocusedEntry = text;
	}

	private static string RowLook(ChatRow row, string? focus, IReadOnlyList<ChatHandOff> allEntries)
	{
		if (!(row is ChatRow.Message message))
		{
			ChatRow.HandOff handOff = row as ChatRow.HandOff;
			if ((object)handOff != null)
			{
				_003C_003Ey__InlineArray4<object> buffer = default;
				buffer[0] = "handoff";
				buffer[1] = focus;
				buffer[2] = allEntries.LastOrDefault((ChatHandOff e) => e.TargetKey == handOff.Entry.TargetKey)?.Id == handOff.Entry.Id;
				buffer[3] = NotchExtensions.LiveWork?.DisplayName(handOff.Entry);
				return string.Join("\u001f", (ReadOnlySpan<object?>)buffer);
			}
			return row.ToString();
		}
		_003C_003Ey__InlineArray8<object> buffer2 = default;
		buffer2[0] = "message";
		buffer2[1] = message.IsLastOfRun;
		buffer2[2] = message.IsFirstOfRun;
		buffer2[3] = message.Value.IsUser;
		buffer2[4] = message.Value.BubbleIsOnlyAboutAttachments;
		buffer2[5] = message.Value.ActionCaption;
		buffer2[6] = string.Join("\u001e", message.Value.AttachmentPaths ?? Array.Empty<string>());
		buffer2[7] = string.Join("\u001e", message.Value.BubbleTexts);
		return string.Join("\u001f", (ReadOnlySpan<object?>)buffer2);
	}

	private static bool Reconcile(UIElementCollection children, List<FrameworkElement> views)
	{
		bool result = false;
		HashSet<UIElement> hashSet = new HashSet<UIElement>(views);
		for (int num = children.Count - 1; num >= 0; num--)
		{
			if (!hashSet.Contains(children[num]))
			{
				children.RemoveAt(num);
				result = true;
			}
		}
		for (int i = 0; i < views.Count; i++)
		{
			if (i >= children.Count || (object)children[i] != views[i])
			{
				int num2 = children.IndexOf(views[i]);
				if (num2 >= 0)
				{
					children.RemoveAt(num2);
				}
				children.Insert(i, views[i]);
				result = true;
			}
		}
		return result;
	}

	private FrameworkElement Build(ChatRow row, string? focus, IReadOnlyList<ChatHandOff> allEntries)
	{
		if (!(row is ChatRow.Separator separator))
		{
			if (!(row is ChatRow.Message message))
			{
				if (!(row is ChatRow.HandOff handOff))
				{
					if (!(row is ChatRow.Typing typing))
					{
						if (row is ChatRow.SentStatus sentStatus)
						{
							TextBlock textBlock = Ui.Text(sentStatus.Text, 11.0, FontWeights.Normal, HomeTheme.TertiaryText);
							textBlock.HorizontalAlignment = HorizontalAlignment.Right;
							textBlock.Margin = new Thickness(6.0, 2.0, 6.0, 0.0);
							return textBlock;
						}
						return new Grid();
					}
					StackPanel stackPanel = new StackPanel
					{
						Spacing = 4.0,
						Margin = new Thickness(0.0, 8.0, 0.0, 0.0),
						HorizontalAlignment = HorizontalAlignment.Left
					};
					stackPanel.Children.Add(ChatBubbles.TypingBubble());
					string statusText = typing.StatusText;
					if (statusText != null)
					{
						TextBlock textBlock2 = Ui.Text(statusText, 10.5, FontWeights.Normal, HomeTheme.TertiaryText, TextAlignment.Left, 1);
						textBlock2.Margin = new Thickness(8.0, 0.0, 0.0, 0.0);
						stackPanel.Children.Add(textBlock2);
					}
					return stackPanel;
				}
				FrameworkElement item = handOff.Entry.Kind switch
				{
					ChatHandOffKind.Drawing => (FrameworkElement)new ChatDrawingRow(host, handOff.Entry), 
					ChatHandOffKind.Text => new ChatTextRow(handOff.Entry), 
					_ => new ChatHandOffRow(host, handOff.Entry, allEntries), 
				};
				Grid grid = new Grid
				{
					Margin = new Thickness(0.0, 12.0, 0.0, 4.0),
					Tag = "handoff-" + handOff.Entry.Id
				};
				if (focus != null)
				{
					Border item2 = new Border
					{
						CornerRadius = new CornerRadius(14.0),
						Background = Ui.Brush(DS.White(0.06)),
						Margin = new Thickness(-6.0),
						IsHitTestVisible = false
					};
					grid.Children.Add(item2);
				}
				grid.Children.Add(item);
				return grid;
			}
			return new ChatMessageRow(message.Value, message.IsLastOfRun, (string path) =>
			{
				NotchPeekSurface.PeekAction("chat_sent_attachment_opened");
				(host.Actions as INotchActions)?.OpenChatArtifact(path, null, null);
			})
			{
				Margin = new Thickness(0.0, message.IsFirstOfRun ? 8 : 2, 0.0, 0.0)
			};
		}
		return ChatBubbles.DateSeparator(separator.Date);
	}

	private static void Arrive(FrameworkElement view, ChatRow row)
	{
		if (Anim.ReduceMotion)
		{
			return;
		}
		int num;
		if (row is ChatRow.Message message)
		{
			ConversationMessage value = message.Value;
			if ((object)value != null)
			{
				num = (value.IsUser ? 1 : 0);
				goto IL_003f;
			}
		}
		num = 0;
		goto IL_003f;
		IL_003f:
		bool outgoing = (byte)num != 0;
		view.Opacity = 0.0;
		view.SizeChanged += Go;
		void Go(object sender, SizeChangedEventArgs e)
		{
			view.SizeChanged -= Go;
			Vector3 value2 = ((row is ChatRow.HandOff) ? new Vector3(0f, 0f, 0f) : new Vector3(outgoing ? ((float)e.NewSize.Width) : 0f, (float)e.NewSize.Height, 0f));
			SwiftSpring spring = new SwiftSpring(0.34, 0.86);
			Anim.ScaleUpFrom(view, 0.92f, spring, value2);
			Anim.OpacitySpring(view, 1f, spring);
		}
	}

	private void RenderEmptyState(bool empty, ConversationHistory? history)
	{
		emptyState.Visibility = ((!empty) ? Visibility.Collapsed : Visibility.Visible);
		if (!empty)
		{
			return;
		}
		string text;
		if (history != null && history.IsLoadingNewest)
		{
			text = "loading";
		}
		else
		{
			text = ((history != null && history.HasLoadFailed) ? "failed" : "hello");
		}
		if (text == emptyStateShown && emptyState.Children.Count > 0)
		{
			return;
		}
		emptyStateShown = text;
		emptyState.Children.Clear();
		if (history != null && history.IsLoadingNewest)
		{
			emptyState.Children.Add(new ProgressRing
			{
				Width = 16.0,
				Height = 16.0,
				IsActive = true,
				Foreground = Ui.Brush(HomeTheme.SecondaryText)
			});
		}
		else if (history != null && history.HasLoadFailed)
		{
			TextBlock textBlock = Ui.Text("Couldn't load your conversation", 14.0, FontWeights.SemiBold, HomeTheme.PrimaryText);
			textBlock.HorizontalAlignment = HorizontalAlignment.Center;
			emptyState.Children.Add(textBlock);
			Pressable pressable = new Pressable
			{
				Height = 28.0,
				HorizontalAlignment = HorizontalAlignment.Center
			};
			pressable.Children.Add(new GelSurface(GelAppearance.PrimaryBlue, 14.0));
			TextBlock textBlock2 = Ui.Text("Try again", 12.0, FontWeights.SemiBold, DS.Rgb(0.06, 0.16, 0.36));
			textBlock2.Margin = new Thickness(14.0, 0.0, 14.0, 0.0);
			textBlock2.VerticalAlignment = VerticalAlignment.Center;
			pressable.Children.Add(textBlock2);
			pressable.Click += () =>
			{
				NotchChat.History?.Refresh();
			};
			emptyState.Children.Add(pressable);
		}
		else
		{
			TextBlock textBlock3 = Ui.Text("Say hi to HeyClicky", 15.0, FontWeights.SemiBold, HomeTheme.PrimaryText);
			textBlock3.HorizontalAlignment = HorizontalAlignment.Center;
			TextBlock textBlock4 = Ui.Text("Everything you ask, by voice or by typing, lives here.", 12.0, FontWeights.Normal, HomeTheme.SecondaryText, TextAlignment.Center);
			textBlock4.HorizontalAlignment = HorizontalAlignment.Center;
			emptyState.Children.Add(textBlock3);
			emptyState.Children.Add(textBlock4);
		}
	}

	private void RenderEarlierRow(bool hasMoreAbove, ConversationHistory? history, int totalRowCount)
	{
		string text;
		if (hasMoreAbove)
		{
			text = ((history != null && history.IsLoadingEarlier) ? "loading" : ("button:" + totalRowCount));
		}
		else
		{
			text = "none";
		}
		if (text == earlierRowShown)
		{
			return;
		}
		earlierRowShown = text;
		earlierRow.Children.Clear();
		earlierRow.Visibility = ((!hasMoreAbove) ? Visibility.Collapsed : Visibility.Visible);
		if (!hasMoreAbove)
		{
			return;
		}
		if (history != null && history.IsLoadingEarlier)
		{
			earlierRow.Children.Add(new ProgressRing
			{
				Width = 14.0,
				Height = 14.0,
				IsActive = true,
				Foreground = Ui.Brush(HomeTheme.TertiaryText)
			});
			return;
		}
		Pressable pressable = new Pressable
		{
			HorizontalAlignment = HorizontalAlignment.Center,
			VerticalAlignment = VerticalAlignment.Center
		};
		pressable.Children.Add(Ui.Text("Earlier messages", 11.0, FontWeights.Medium, HomeTheme.TertiaryText));
		pressable.Click += () =>
		{
			ShowEarlierRows(totalRowCount, "button");
		};
		earlierRow.Children.Add(pressable);
	}

	private void ShowEarlierRows(int totalRowCount, string trigger)
	{
		ConversationHistory history = NotchChat.History;
		string source;
		if (totalRowCount > shownRowCount)
		{
			shownRowCount = Math.Min(totalRowCount, shownRowCount + 40);
			RenderSoon();
			source = "held_rows";
		}
		else
		{
			if (history == null || !history.HasEarlierMessages || history.IsLoadingEarlier)
			{
				return;
			}
			waitingForEarlierPage = true;
			history.Changed += OnEarlierPage;
			history.LoadEarlier();
			source = "server";
		}
		earlierPagesLoadedCount++;
		ClickyAnalytics.TrackProductEvent("notch_chat_action", null, null, NotchChatAnalytics.EarlierMessagesLoaded(trigger, source, earlierPagesLoadedCount));
	}

	private void OnEarlierPage()
	{
		ConversationHistory history = NotchChat.History;
		if (history != null && !history.IsLoadingEarlier && waitingForEarlierPage)
		{
			history.Changed -= OnEarlierPage;
			waitingForEarlierPage = false;
			DispatcherQueue.TryEnqueue(() =>
			{
				shownRowCount += 40;
				Render();
			});
		}
	}

	private void OnScrolled()
	{
		bool flag = scroller.ExtentHeight - scroller.VerticalOffset - scroller.ViewportHeight > 120.0;
		if (flag != isAwayFromBottom)
		{
			isAwayFromBottom = flag;
			jumpDisc.IsHitTestVisible = flag;
			Anim.Opacity(jumpDisc, flag ? 1 : 0, 0.18, Easing.EaseOut(Ui.Compositor));
			if (!flag && shownRowCount > 40)
			{
				shownRowCount = 40;
				RenderSoon();
			}
			if (!flag)
			{
				earlierPagesLoadedCount = 0;
			}
		}
		bool flag2 = scroller.VerticalOffset < 240.0;
		if (flag2 && !nearTop)
		{
			ShowEarlierRows(CurrentRows().Count, "scroll");
		}
		nearTop = flag2;
	}

	private void ScrollToBottom()
	{
		scroller.UpdateLayout();
		scroller.ChangeView(null, scroller.ScrollableHeight, null, disableAnimation: true);
	}

	private void ScrollToFocusedEntry(string entryId)
	{
		string key = "handoff-" + entryId;
		List<ChatRow> list = CurrentRows();
		int num = list.FindIndex((ChatRow r) => r.Id == key);
		if (num >= 0 && list.Count - num > shownRowCount)
		{
			shownRowCount = list.Count - num;
			RenderSoon();
		}
		double[] array = new double[4] { 0.05, 0.3, 0.65, 1.1 };
		for (int num2 = 0; num2 < array.Length; num2++)
		{
			bool animated = num2 == 0;
			After(array[num2], () =>
			{
				if (!(presenter?.Tabs.ChatFocusEntryId != entryId))
				{
					FrameworkElement frameworkElement = this.list.Children.OfType<FrameworkElement>().FirstOrDefault((FrameworkElement c) => c.Tag as string == key);
					if ((object)frameworkElement != null)
					{
						Point point = frameworkElement.TransformToVisual((UIElement)scroller.Content).TransformPoint(new Point(0f, 0f));
						isAwayFromBottom = true;
						scroller.ChangeView(null, Math.Max(0.0, point.Y - 52.0 + 12.0), null, !animated);
					}
				}
			});
		}
		After(2.6, () =>
		{
			if (presenter?.Tabs.ChatFocusEntryId == entryId)
			{
				presenter.Tabs.ChatFocusEntryId = null;
			}
		});
	}

	private void After(double seconds, Action action)
	{
		DispatcherQueueTimer dispatcherQueueTimer = DispatcherQueue.CreateTimer().Rooted();
		dispatcherQueueTimer.Interval = TimeSpan.FromSeconds(seconds);
		dispatcherQueueTimer.IsRepeating = false;
		dispatcherQueueTimer.Tick += (DispatcherQueueTimer _, object _) =>
		{
			action();
		};
		dispatcherQueueTimer.Start();
	}

	private static FrameworkElement BoardDots(double width, double height, Color color)
	{
		GeometryGroup geometryGroup = new GeometryGroup();
		for (double num = 16.0; num <= height - 6.4; num += 16.0)
		{
			for (double num2 = 16.0; num2 <= width - 6.4; num2 += 16.0)
			{
				geometryGroup.Children.Add(new EllipseGeometry
				{
					Center = new Point(num2, num),
					RadiusX = 1.1,
					RadiusY = 1.1
				});
			}
		}
		return new Path
		{
			Data = geometryGroup,
			Fill = Ui.Brush(color),
			IsHitTestVisible = false
		};
	}
}
