using System;
using System.Text.Json.Nodes;
using HeyClicky.Core.Telemetry;

namespace HeyClicky.Core.Notch;

public sealed class NotchTabs
{
	private readonly NotchPresenter presenter;

	private readonly object gate;

	private NotchTab selected;

	private string? chatFocusEntryId;

	private string? expandedReplyEntryId;

	private double? fullReplyContentHeight;

	private NotchSettingsSection settingsSection;

	private string? documentPath;

	private string? documentThreadId;

	private NotchTab tabBeforeDocument;

	private (string EntryId, NotchTab? ReturnTab)? expandedReplyBeforeDocument;

	private int composerFocusRequestId;

	private bool hasPendingComposerFocusRequest;

	private NotchTab? pendingTab;

	private string? pendingExpandedReplyEntryId;

	private NotchTab? tabBeforeFullReply;

	private DateTimeOffset? fullReplyOpenedAt;

	public Func<string, ChatHandOff?>? EntryLookup { get; set; }

	public NotchTab Selected
	{
		get
		{
			lock (gate)
			{
				return selected;
			}
		}
	}

	public string? ChatFocusEntryId
	{
		get
		{
			lock (gate)
			{
				return chatFocusEntryId;
			}
		}
		set
		{
			Mutate(() =>
			{
				chatFocusEntryId = value;
			});
		}
	}

	public string? ExpandedReplyEntryId
	{
		get
		{
			lock (gate)
			{
				return expandedReplyEntryId;
			}
		}
		set
		{
			Mutate(() =>
			{
				SetExpandedReply(value);
			});
		}
	}

	public double? FullReplyContentHeight
	{
		get
		{
			lock (gate)
			{
				return fullReplyContentHeight;
			}
		}
		set
		{
			Mutate(() =>
			{
				fullReplyContentHeight = value;
			});
		}
	}

	public NotchSettingsSection SettingsSection
	{
		get
		{
			lock (gate)
			{
				return settingsSection;
			}
		}
		set
		{
			Mutate(() =>
			{
				settingsSection = value;
			});
		}
	}

	public string? DocumentPath
	{
		get
		{
			lock (gate)
			{
				return documentPath;
			}
		}
	}

	public string? DocumentThreadId
	{
		get
		{
			lock (gate)
			{
				return documentThreadId;
			}
		}
	}

	public NotchTab TabBeforeDocument
	{
		get
		{
			lock (gate)
			{
				return tabBeforeDocument;
			}
		}
	}

	public int ComposerFocusRequestId
	{
		get
		{
			lock (gate)
			{
				return composerFocusRequestId;
			}
		}
	}

	public bool HasPendingComposerFocusRequest
	{
		get
		{
			lock (gate)
			{
				return hasPendingComposerFocusRequest;
			}
		}
	}

	public bool IsShowingDocument
	{
		get
		{
			lock (gate)
			{
				return selected == NotchTab.Document && presenter.IsNotchDocumentOpen && presenter.IsShowingNotchAgentPeekUnlocked;
			}
		}
	}

	internal NotchTab SelectedCore => selected;

	public event Action? Changed;

	public event Action<NotchTab>? SelectionChanged;

	public event Action? ComposerFocusRequested;

	internal NotchTabs(NotchPresenter presenter, object gate)
	{
		this.presenter = presenter;
		this.gate = gate;
	}

	private void SetExpandedReply(string? value)
	{
		if (expandedReplyEntryId != value)
		{
			fullReplyContentHeight = null;
		}
		expandedReplyEntryId = value;
	}

	private void Mutate(Action change)
	{
		NotchTab notchTab;
		NotchTab notchTab2;
		lock (gate)
		{
			notchTab = selected;
			change();
			notchTab2 = selected;
		}
		Changed?.Invoke();
		if (notchTab != notchTab2)
		{
			SelectionChanged?.Invoke(notchTab2);
		}
	}

	private void SelectCore(NotchTab tab)
	{
		if (selected != tab)
		{
			selected = tab;
			if (tab != NotchTab.Chat)
			{
				SetExpandedReply(null);
				tabBeforeFullReply = null;
			}
			ClickyAnalytics.TrackProductEvent("notch_peek_action", null, null, new JsonObject { ["action"] = "tab_" + tab.RawValue() });
		}
	}

	public void Select(NotchTab tab)
	{
		Mutate(() =>
		{
			SelectCore(tab);
		});
	}

	public void Show(NotchTab tab, string? focusingEntryId = null)
	{
		Mutate(() =>
		{
			ShowCore(tab, focusingEntryId);
		});
	}

	private void ShowCore(NotchTab tab, string? focusingEntryId)
	{
		pendingTab = tab;
		pendingExpandedReplyEntryId = null;
		tabBeforeFullReply = null;
		chatFocusEntryId = focusingEntryId;
		SetExpandedReply(null);
		SelectCore(tab);
	}

	public void RequestComposerFocus()
	{
		lock (gate)
		{
			hasPendingComposerFocusRequest = true;
			composerFocusRequestId++;
		}
		ComposerFocusRequested?.Invoke();
		Changed?.Invoke();
	}

	public void ConsumeComposerFocusRequest()
	{
		lock (gate)
		{
			hasPendingComposerFocusRequest = false;
		}
	}

	public void ShowChatForTyping(bool isNotchOpen)
	{
		Mutate(() =>
		{
			if (isNotchOpen)
			{
				chatFocusEntryId = null;
				SetExpandedReply(null);
				tabBeforeFullReply = null;
				SelectCore(NotchTab.Chat);
			}
			else
			{
				ShowCore(NotchTab.Chat, null);
			}
		});
	}

	public void ShowSettings(NotchSettingsSection section)
	{
		Mutate(() =>
		{
			settingsSection = section;
			ShowCore(NotchTab.Settings, null);
		});
		presenter.OpenNotchAgentPeekOnRequest();
	}

	public void ShowDocument(string path, string? threadId)
	{
		Mutate(() =>
		{
			NotchTabs notchTabs;
			(string, NotchTab?)? tuple;
			if (selected != NotchTab.Document)
			{
				bool isShowingNotchAgentPeekUnlocked = presenter.IsShowingNotchAgentPeekUnlocked;
				tabBeforeDocument = (isShowingNotchAgentPeekUnlocked ? selected : NotchTab.Home);
				notchTabs = this;
				if (isShowingNotchAgentPeekUnlocked && selected == NotchTab.Chat)
				{
					string text = expandedReplyEntryId;
					if (text != null)
					{
						tuple = (text, tabBeforeFullReply);
						goto IL_0082;
					}
				}
				tuple = null;
				goto IL_0082;
			}
			goto IL_0087;
			IL_0087:
			documentPath = path;
			documentThreadId = threadId;
			ShowCore(NotchTab.Document, null);
			return;
			IL_0082:
			notchTabs.expandedReplyBeforeDocument = tuple;
			goto IL_0087;
		});
		presenter.OpenNotchDocument();
		ClickyAnalytics.TrackProductEvent("notch_peek_action", null, null, new JsonObject { ["action"] = "document_opened" });
	}

	public void CloseDocument()
	{
		Mutate(() =>
		{
			if (selected == NotchTab.Document)
			{
				SelectCore((tabBeforeDocument != NotchTab.Document) ? tabBeforeDocument : NotchTab.Home);
				if (selected == NotchTab.Chat)
				{
					(string, NotchTab?)? tuple = expandedReplyBeforeDocument;
					if (tuple.HasValue)
					{
						(string, NotchTab?) valueOrDefault = tuple.GetValueOrDefault();
						SetExpandedReply(valueOrDefault.Item1);
						tabBeforeFullReply = valueOrDefault.Item2;
					}
				}
			}
			expandedReplyBeforeDocument = null;
		});
		presenter.CloseNotchDocument();
	}

	public void DropDocumentIfShowing()
	{
		Mutate(DropDocumentIfShowingCore);
	}

	internal void DropDocumentIfShowingCore()
	{
		expandedReplyBeforeDocument = null;
		if (selected == NotchTab.Document)
		{
			selected = ((tabBeforeDocument != NotchTab.Document) ? tabBeforeDocument : NotchTab.Home);
		}
	}

	public void ShowFullReply(string entryId, NotchChatFullReplyOpenSource? from = null)
	{
		bool isShowingNotchAgentPeek = presenter.IsShowingNotchAgentPeek;
		TrackFullReplyOpened(entryId, (NotchChatFullReplyOpenSource)(((int?)from) ?? (isShowingNotchAgentPeek ? 1 : 2)));
		Mutate(() =>
		{
			bool isShowingNotchAgentPeekUnlocked = presenter.IsShowingNotchAgentPeekUnlocked;
			NotchTab? notchTab = ((!isShowingNotchAgentPeekUnlocked) ? new NotchTab?(NotchTab.Home) : ((selected == NotchTab.Chat) ? ((NotchTab?)null) : new NotchTab?((selected != NotchTab.Document) ? selected : NotchTab.Home)));
			pendingTab = (isShowingNotchAgentPeekUnlocked ? ((NotchTab?)null) : new NotchTab?(NotchTab.Chat));
			pendingExpandedReplyEntryId = (isShowingNotchAgentPeekUnlocked ? null : entryId);
			chatFocusEntryId = null;
			SelectCore(NotchTab.Chat);
			tabBeforeFullReply = notchTab;
			SetExpandedReply(entryId);
		});
		presenter.OpenNotchAgentPeekOnRequest();
	}

	public void DropExpandedReply()
	{
		Mutate(() =>
		{
			SetExpandedReply(null);
			tabBeforeFullReply = null;
		});
	}

	public void CloseFullReply(NotchChatFullReplyCloseVia? via = NotchChatFullReplyCloseVia.Escape)
	{
		if (via.HasValue)
		{
			NotchChatFullReplyCloseVia valueOrDefault = via.GetValueOrDefault();
			string text = ExpandedReplyEntryId;
			if (text != null)
			{
				TrackFullReplyClosed(text, valueOrDefault);
			}
		}
		Mutate(() =>
		{
			NotchTab? notchTab = tabBeforeFullReply;
			tabBeforeFullReply = null;
			SetExpandedReply(null);
			if (notchTab.HasValue)
			{
				NotchTab valueOrDefault2 = notchTab.GetValueOrDefault();
				SelectCore(valueOrDefault2);
			}
		});
	}

	public void TrackFullReplyOpened(string entryId, NotchChatFullReplyOpenSource from)
	{
		ChatHandOff chatHandOff = EntryLookup?.Invoke(entryId);
		lock (gate)
		{
			fullReplyOpenedAt = presenter.Now;
		}
		ClickyAnalytics.TrackProductEvent("notch_chat_action", chatHandOff?.ClickySlug, chatHandOff?.ThreadId, NotchChatAnalytics.FullReplyOpened(chatHandOff, from));
	}

	private void TrackFullReplyClosed(string entryId, NotchChatFullReplyCloseVia via)
	{
		ChatHandOff chatHandOff = EntryLookup?.Invoke(entryId);
		TimeSpan? openFor;
		lock (gate)
		{
			DateTimeOffset? dateTimeOffset = fullReplyOpenedAt;
			TimeSpan? timeSpan;
			if (dateTimeOffset.HasValue)
			{
				DateTimeOffset valueOrDefault = dateTimeOffset.GetValueOrDefault();
				timeSpan = presenter.Now - valueOrDefault;
			}
			else
			{
				timeSpan = null;
			}
			openFor = timeSpan;
			fullReplyOpenedAt = null;
		}
		ClickyAnalytics.TrackProductEvent("notch_chat_action", chatHandOff?.ClickySlug, chatHandOff?.ThreadId, NotchChatAnalytics.FullReplyClosed(via, openFor));
	}

	internal void NoteFreshOpenCore(bool isHoverOpen = false)
	{
		NotchTab notchTab = ((!isHoverOpen) ? pendingTab.GetValueOrDefault() : NotchTab.Home);
		if (isHoverOpen)
		{
			pendingExpandedReplyEntryId = null;
		}
		pendingTab = null;
		if (notchTab != NotchTab.Chat)
		{
			chatFocusEntryId = null;
		}
		SetExpandedReply(pendingExpandedReplyEntryId);
		pendingExpandedReplyEntryId = null;
		if (expandedReplyEntryId == null)
		{
			tabBeforeFullReply = null;
		}
		if (selected != notchTab)
		{
			selected = notchTab;
		}
	}

	internal void RaiseChangedAfterLadder(NotchTab before)
	{
		NotchTab notchTab;
		lock (gate)
		{
			notchTab = selected;
		}
		Changed?.Invoke();
		if (before != notchTab)
		{
			SelectionChanged?.Invoke(notchTab);
		}
	}

	internal void ConsumeComposerFocusRequestCore()
	{
		hasPendingComposerFocusRequest = false;
	}

	internal void SelectCoreInternal(NotchTab tab)
	{
		SelectCore(tab);
	}
}
