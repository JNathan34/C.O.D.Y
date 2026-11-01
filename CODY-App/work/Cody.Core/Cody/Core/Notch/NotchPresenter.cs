using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using HeyClicky.Core.Telemetry;

namespace HeyClicky.Core.Notch;

public sealed class NotchPresenter : INotchPresenter, IDisposable
{
	private sealed record LiveEventSlot(NotchLiveEvent Event, TimeSpan? Remaining, bool PausesOnHover);

	public static readonly TimeSpan HoverDwell = TimeSpan.FromSeconds(0.45);

	public static readonly TimeSpan MutedSpeakerAutoHide = TimeSpan.FromSeconds(10L);

	public static readonly TimeSpan MicrophoneTroubleAutoHide = TimeSpan.FromSeconds(8L);

	public static readonly TimeSpan DictationClipboardAutoHide = TimeSpan.FromSeconds(6L);

	public static readonly TimeSpan AppUpdatedAutoHide = TimeSpan.FromSeconds(12L);

	public static readonly TimeSpan HoverExpandHoldAfterCardLeft = TimeSpan.FromSeconds(1L);

	private static readonly TimeSpan HoldAfterListening = TimeSpan.FromSeconds(2.5);

	private static readonly TimeSpan HoldAfterProcessing = TimeSpan.FromSeconds(30L);

	private static readonly TimeSpan HoldAfterResponding = TimeSpan.FromSeconds(0.3);

	private readonly object gate = new object();

	private readonly Func<DateTimeOffset> clock;

	private readonly Timer? ticker;

	private readonly Dictionary<Type, LiveEventSlot> slots = new Dictionary<Type, LiveEventSlot>();

	private NotchPresentation presentation = new NotchPresentation.Idle();

	private bool textInputActive;

	private string textInputDraft = "";

	private NotchAgentFollowUp? textInputAgentFollowUp;

	private NotchPresentation.TextResponse? textResponse;

	private TimeSpan? textResponseRemaining;

	private TimeSpan textResponseTotal;

	private bool textResponseUserPaused;

	private bool textResponseFollowUpActive;

	private bool ambientSuppressed;

	private int? onboardingPinStep;

	private bool onboardingPinManuallyDismissed;

	private bool isSignedIn = true;

	private bool isRestrictingForTutorial;

	private VoiceState voiceState;

	private string? customStatusLabel;

	private NotchLiveEvent? heldVoiceEvent;

	private DateTimeOffset heldVoiceEventUntil;

	private bool voiceTurnTerminationSuppressesNextHold;

	private bool pointerInside;

	private DateTimeOffset pointerEnteredAt;

	private bool hovering;

	private bool suppressHoverExpandUntilNotchReentry;

	private DateTimeOffset hoverExpandRearmNotBefore = DateTimeOffset.MinValue;

	private DateTimeOffset lastTick;

	public static readonly TimeSpan OpenRequestTimeout = TimeSpan.FromSeconds(6L);

	public static readonly TimeSpan DragOpenedChatCloseGrace = TimeSpan.FromSeconds(0.35);

	private bool hoverRoutesToNotch;

	private bool peekHeldOpen;

	private bool heldOpenForPresentation;

	private bool heldOpenByArc;

	private bool openRequested;

	private bool openRequestSawHover;

	private DateTimeOffset openRequestDeadline;

	private bool documentOpen;

	private bool chatSessionOpen;

	private bool chatComposerHasDraft;

	private bool chatComposerHasKeyboard;

	private bool chatOpenedByFileDrag;

	private DateTimeOffset? dragOpenedChatCloseAt;

	private bool keepsOpenThroughVoiceTurn;

	private bool voiceTurnBeganWithListening = true;

	private bool restingMarkShowsHandle;

	private bool restingMarkIsWorking;

	private readonly List<string> pendingDroppedAttachments = new List<string>();

	private (NotchActivityPhase Phase, string? Label)? voicePill;

	private NotchTab? tabsBeforeLadder;

	private bool hoverOpenedNotchThisPass;

	private bool routesTextModeToNotchChat;

	private DateTimeOffset? chatSessionStartedAt;

	private NotchChatSessionOpenVia chatSessionOpenedVia;

	private int chatSessionSentMessageCount;

	private int chatSessionSentAttachmentCount;

	private readonly List<JsonObject> pendingChatAnalytics = new List<JsonObject>();

	private bool tourShowcaseShowing;

	private bool introWelcomeActive;

	private bool introWelcomeAutoShownPin;

	private bool introWelcomeHadHoverIn;

	private bool introOwnsStage;

	private bool dockedStripCoversForegroundApp;

	private bool ticking;

	private bool hasAppliedInitialPresentation;

	private DateTimeOffset? expandedSurfaceStartedAt;

	public const int SignedOutCardStep = -1;

	private static readonly HashSet<Type> ActionableCards = new HashSet<Type>
	{
		typeof(NotchLiveEvent.IntegrationSuggestion),
		typeof(NotchLiveEvent.MeetingCountdown),
		typeof(NotchLiveEvent.DictationCopiedToClipboard),
		typeof(NotchLiveEvent.VoiceReplyMutedCopiedToClipboard),
		typeof(NotchLiveEvent.MicrophoneTrouble),
		typeof(NotchLiveEvent.AppUpdated),
		typeof(NotchLiveEvent.MorningSuggestions),
		typeof(NotchLiveEvent.OnboardingTutorialInvite),
		typeof(NotchLiveEvent.SidecarLearningSuggestion),
		typeof(NotchLiveEvent.SpotifyVoiceTip),
		typeof(NotchLiveEvent.DictionaryWordLearned),
		typeof(NotchLiveEvent.DocumentFolderAccessDenied)
	};

	private static readonly HashSet<Type> CardsHoldingHoverAfterLeaving;

	public NotchTabs Tabs { get; }

	public NotchUpdates Updates { get; }

	internal DateTimeOffset Now => clock();

	public NotchPresentation Presentation
	{
		get
		{
			lock (gate)
			{
				return presentation;
			}
		}
	}

	public bool IsHovering
	{
		get
		{
			lock (gate)
			{
				return hovering;
			}
		}
	}

	public VoiceState VoiceState
	{
		get
		{
			lock (gate)
			{
				return voiceState;
			}
		}
	}

	public NotchPresentation.TextResponse? CurrentTextResponse
	{
		get
		{
			lock (gate)
			{
				return textResponse;
			}
		}
	}

	public bool IsTextResponseInProgress
	{
		get
		{
			lock (gate)
			{
				return (object)textResponse != null;
			}
		}
	}

	public string? CustomStatusLabel
	{
		get
		{
			lock (gate)
			{
				return customStatusLabel;
			}
		}
	}

	public bool RequiresPointerExitBeforeHoverExpansion
	{
		get
		{
			lock (gate)
			{
				return suppressHoverExpandUntilNotchReentry;
			}
		}
	}

	public (NotchActivityPhase Phase, string? Label)? VoicePill
	{
		get
		{
			lock (gate)
			{
				return voicePill;
			}
		}
	}

	public bool IsShowingNotchAgentPeek
	{
		get
		{
			lock (gate)
			{
				return IsShowingNotchAgentPeekUnlocked;
			}
		}
	}

	internal bool IsShowingNotchAgentPeekUnlocked
	{
		get
		{
			if (presentation is NotchPresentation.LiveEvent liveEvent)
			{
				return liveEvent.Event is NotchLiveEvent.AgentPeek;
			}
			return false;
		}
	}

	public bool IsNotchDocumentOpen
	{
		get
		{
			lock (gate)
			{
				return documentOpen;
			}
		}
	}

	public bool IsNotchChatSessionOpen
	{
		get
		{
			lock (gate)
			{
				return chatSessionOpen;
			}
		}
	}

	public bool IsNotchHeldOpenByArc
	{
		get
		{
			lock (gate)
			{
				return heldOpenByArc;
			}
		}
	}

	public bool RendersTextResponsesInNotchChat
	{
		get
		{
			lock (gate)
			{
				return chatSessionOpen;
			}
		}
	}

	private bool ChatSessionHoldingNotch
	{
		get
		{
			if (chatSessionOpen)
			{
				return Tabs.SelectedCore == NotchTab.Chat;
			}
			return false;
		}
	}

	public bool HoldsNotchOpenWithoutArc
	{
		get
		{
			lock (gate)
			{
				return hovering || peekHeldOpen || heldOpenForPresentation || openRequested || documentOpen || ChatSessionHoldingNotch;
			}
		}
	}

	public bool RoutesTextModeToNotchChat
	{
		get
		{
			lock (gate)
			{
				return routesTextModeToNotchChat && isSignedIn;
			}
		}
	}

	public bool NotchChatComposerHasKeyboard
	{
		get
		{
			lock (gate)
			{
				return chatComposerHasKeyboard;
			}
		}
	}

	public bool IsNotchChatAwaitingAnswer
	{
		get
		{
			lock (gate)
			{
				return ChatAwaitingAnswer;
			}
		}
	}

	private bool ChatAwaitingAnswer
	{
		get
		{
			bool flag = (object)textResponse != null;
			if (!flag)
			{
				VoiceState voiceState = this.voiceState;
				bool flag2 = (uint)(voiceState - 2) <= 1u;
				flag = flag2 && !voiceTurnBeganWithListening;
			}
			return flag;
		}
	}

	private bool VoiceTurnActiveForPresentation
	{
		get
		{
			if (voiceState == VoiceState.Idle)
			{
				if ((object)heldVoiceEvent != null)
				{
					return clock() < heldVoiceEventUntil;
				}
				return false;
			}
			return true;
		}
	}

	public bool IsTourShowcaseShowing
	{
		get
		{
			lock (gate)
			{
				return tourShowcaseShowing;
			}
		}
	}

	public bool IsIntroHomeWelcomeAutoShownPin
	{
		get
		{
			lock (gate)
			{
				return introWelcomeAutoShownPin;
			}
		}
	}

	public bool IsOnboardingIntroOwningStage
	{
		get
		{
			lock (gate)
			{
				return introOwnsStage;
			}
		}
	}

	public bool DockedStripCoversForegroundApp
	{
		get
		{
			lock (gate)
			{
				return dockedStripCoversForegroundApp;
			}
		}
	}

	public bool IsAmbientSuppressed
	{
		get
		{
			lock (gate)
			{
				return ambientSuppressed;
			}
		}
	}

	public (TimeSpan Remaining, TimeSpan Total, bool UserPaused)? TextResponseCountdown
	{
		get
		{
			lock (gate)
			{
				if (presentation is NotchPresentation.TextResponse)
				{
					TimeSpan? timeSpan = textResponseRemaining;
					if (timeSpan.HasValue)
					{
						TimeSpan valueOrDefault = timeSpan.GetValueOrDefault();
						return (valueOrDefault, textResponseTotal, textResponseUserPaused);
					}
				}
				return null;
			}
		}
	}

	public bool IntroWelcomeAutoPinned
	{
		get
		{
			lock (gate)
			{
				return introWelcomeActive && introWelcomeAutoShownPin;
			}
		}
	}

	public static bool ShowsRunningAgentsStrip { get; set; } = false;

	public static bool RestingMarkIsGlowingBar { get; set; } = true;

	public event EventHandler? PresentationChanged;

	public event Action? HoverDwellCompleted;

	public event Action? VoicePillChanged;

	public event Action? HoverOpenedNotch;

	public event Action? NotchSessionChanged;

	public event Action? DroppedAttachmentsPending;

	public event Action? DragOpenedChatAbandoned;

	public NotchPresenter(Func<DateTimeOffset>? clock = null, bool autoTick = true)
	{
		this.clock = clock ?? ((Func<DateTimeOffset>)(() => DateTimeOffset.UtcNow));
		lastTick = this.clock();
		if (autoTick)
		{
			ticker = new Timer((object? _) =>
			{
				Tick();
			}, null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
		}
		Tabs = new NotchTabs(this, gate);
		Updates = new NotchUpdates(this.clock, autoTick);
		Updates.CurrentChanged += () =>
		{
			Update(() =>
			{
			});
		};
	}

	public void Present(NotchPresentation next)
	{
		NotchPresentation.TextInput textInput = next as NotchPresentation.TextInput;
		if ((object)textInput == null)
		{
			NotchPresentation.TextResponse textResponse = next as NotchPresentation.TextResponse;
			if ((object)textResponse == null)
			{
				NotchPresentation.OnboardingPinned onboardingPinned = next as NotchPresentation.OnboardingPinned;
				if ((object)onboardingPinned == null)
				{
					if (!(next is NotchPresentation.LiveEvent liveEvent))
					{
						if (next is NotchPresentation.Idle)
						{
							Update(() =>
							{
								EndTextInput();
								DismissTextResponse();
							});
						}
					}
					else
					{
						ShowLiveEvent(liveEvent.Event);
					}
				}
				else
				{
					Update(() =>
					{
						onboardingPinStep = onboardingPinned.Step;
						onboardingPinManuallyDismissed = false;
					});
				}
				return;
			}
			Update(() =>
			{
				EndTextInput();
				if ((object)this.textResponse == null || this.textResponse.Question != textResponse.Question || textResponse.IsThinking)
				{
					textResponseUserPaused = false;
				}
				this.textResponse = textResponse;
				textResponseRemaining = (textResponse.IsThinking ? ((TimeSpan?)null) : new TimeSpan?(AutoDismissForTextResponse(textResponse.Answer, isRestrictingForTutorial)));
				TimeSpan? timeSpan = textResponseRemaining;
				if (timeSpan.HasValue)
				{
					TimeSpan valueOrDefault = timeSpan.GetValueOrDefault();
					textResponseTotal = valueOrDefault;
				}
			});
		}
		else
		{
			Update(() =>
			{
				textInputAgentFollowUp = (textInputActive ? (textInput.AgentFollowUp ?? textInputAgentFollowUp) : textInput.AgentFollowUp);
				textInputActive = true;
				textInputDraft = textInput.Draft;
				this.textResponse = null;
				textResponseRemaining = null;
			});
		}
	}

	private void EndTextInput()
	{
		if (textInputActive)
		{
			if (pointerInside)
			{
				suppressHoverExpandUntilNotchReentry = true;
			}
			textInputActive = false;
			textInputAgentFollowUp = null;
		}
	}

	private void DismissTextResponse()
	{
		if ((object)textResponse != null && pointerInside)
		{
			suppressHoverExpandUntilNotchReentry = true;
		}
		textResponse = null;
		textResponseRemaining = null;
	}

	public void ShowLiveEvent(NotchLiveEvent liveEvent, TimeSpan? autoDismissAfter = null)
	{
		if (!(liveEvent is NotchLiveEvent.ActivityListening))
		{
			if (!(liveEvent is NotchLiveEvent.ActivityThinking))
			{
				if (!(liveEvent is NotchLiveEvent.ActivitySpeaking))
				{
					if (!(liveEvent is NotchLiveEvent.ActivityCustomStatus activityCustomStatus))
					{
						if (liveEvent is NotchLiveEvent.AgentPeek)
						{
							OpenNotchAgentPeekOnRequest();
							return;
						}
						Update(() =>
						{
							if (!(liveEvent is NotchLiveEvent.MicrophoneTrouble) || autoDismissAfter.HasValue || !slots.TryGetValue(liveEvent.GetType(), out LiveEventSlot value) || !value.Event.Equals(liveEvent))
							{
								var (timeSpan, pausesOnHover) = DefaultAutoDismiss(liveEvent);
								slots[liveEvent.GetType()] = new LiveEventSlot(liveEvent, autoDismissAfter ?? timeSpan, pausesOnHover);
							}
						});
					}
					else
					{
						SetVoiceState(VoiceState.Processing, activityCustomStatus.Label);
					}
				}
				else
				{
					SetVoiceState(VoiceState.Responding);
				}
			}
			else
			{
				SetVoiceState(VoiceState.Processing);
			}
		}
		else
		{
			SetVoiceState(VoiceState.Listening);
		}
	}

	public (TimeSpan Remaining, TimeSpan Total)? LiveEventCountdown(Type liveEventType)
	{
		lock (gate)
		{
			if (slots.TryGetValue(liveEventType, out LiveEventSlot value))
			{
				TimeSpan? remaining = value.Remaining;
				if (remaining.HasValue)
				{
					TimeSpan valueOrDefault = remaining.GetValueOrDefault();
					TimeSpan timeSpan = DefaultAutoDismiss(value.Event).Duration ?? valueOrDefault;
					return (valueOrDefault, (timeSpan < valueOrDefault) ? valueOrDefault : timeSpan);
				}
			}
			return null;
		}
	}

	public bool HasLiveEvent(Type liveEventType)
	{
		lock (gate)
		{
			return slots.ContainsKey(liveEventType);
		}
	}

	public void DismissLiveEvent(Type liveEventType)
	{
		if (liveEventType == typeof(NotchLiveEvent.ActivityListening) || liveEventType == typeof(NotchLiveEvent.ActivityThinking) || liveEventType == typeof(NotchLiveEvent.ActivitySpeaking) || liveEventType == typeof(NotchLiveEvent.ActivityCustomStatus))
		{
			SetVoiceState(VoiceState.Idle);
			return;
		}
		if (liveEventType == typeof(NotchLiveEvent.AgentPeek))
		{
			DismissNotchAgentPeek();
			return;
		}
		Update(() =>
		{
			slots.Remove(liveEventType);
		});
	}

	public void ReturnToIdle()
	{
		Update(() =>
		{
			EndTextInput();
			DismissTextResponse();
			slots.Clear();
			heldVoiceEvent = null;
			customStatusLabel = null;
			voiceState = VoiceState.Idle;
		});
	}

	public void SetVoiceState(VoiceState next, string? customStatus = null)
	{
		Update(() =>
		{
			VoiceState voiceState = this.voiceState;
			this.voiceState = next;
			if (next == VoiceState.Listening)
			{
				voiceTurnBeganWithListening = true;
			}
			customStatusLabel = ((next == VoiceState.Processing) ? customStatus : null);
			if (voiceState != next)
			{
				if (next != VoiceState.Idle)
				{
					heldVoiceEvent = null;
				}
				else if (voiceTurnTerminationSuppressesNextHold)
				{
					voiceTurnTerminationSuppressesNextHold = false;
					heldVoiceEvent = null;
				}
				else if (presentation is NotchPresentation.LiveEvent liveEvent && liveEvent.Event is NotchLiveEvent.MorningSuggestions && voiceState != VoiceState.Listening)
				{
					heldVoiceEvent = null;
				}
				else
				{
					(NotchLiveEvent, TimeSpan) tuple = voiceState switch
					{
						VoiceState.Listening => ((NotchLiveEvent)new NotchLiveEvent.ActivityThinking(), HoldAfterListening), 
						VoiceState.Processing => (new NotchLiveEvent.ActivityThinking(), HoldAfterProcessing), 
						_ => (new NotchLiveEvent.ActivitySpeaking(), HoldAfterResponding), 
					};
					heldVoiceEvent = tuple.Item1;
					TimeSpan item = tuple.Item2;
					heldVoiceEventUntil = clock() + item;
				}
			}
		});
	}

	public void SetCustomStatusLabel(string? label)
	{
		Update(() =>
		{
			customStatusLabel = ((voiceState == VoiceState.Processing) ? label : null);
		});
	}

	public void NotifyVoiceTurnTerminating()
	{
		Update(() =>
		{
			if (voiceState != VoiceState.Idle)
			{
				voiceTurnTerminationSuppressesNextHold = true;
			}
			heldVoiceEvent = null;
		});
	}

	public void SetPointerInside(bool inside)
	{
		Update(() =>
		{
			if (inside != pointerInside)
			{
				pointerInside = inside;
				if (inside)
				{
					pointerEnteredAt = clock();
					if (presentation is NotchPresentation.LiveEvent liveEvent && liveEvent.Event is NotchLiveEvent.AgentPeek && !introOwnsStage)
					{
						hovering = true;
						NoteHoverForOpenRequest();
					}
				}
				else
				{
					hovering = false;
					if (openRequested && openRequestSawHover)
					{
						openRequested = false;
						openRequestSawHover = false;
					}
					if (clock() >= hoverExpandRearmNotBefore)
					{
						suppressHoverExpandUntilNotchReentry = false;
					}
					if (introWelcomeAutoShownPin && introWelcomeHadHoverIn)
					{
						introWelcomeAutoShownPin = false;
						introWelcomeHadHoverIn = false;
					}
				}
			}
		});
	}

	public void SuppressHoverUntilPointerReentry()
	{
		Update(() =>
		{
			suppressHoverExpandUntilNotchReentry = true;
			hoverExpandRearmNotBefore = clock() + HoverExpandHoldAfterCardLeft;
			hovering = false;
		});
	}

	public void SetHoverRoutesToNotch(bool routes)
	{
		Update(() =>
		{
			hoverRoutesToNotch = routes;
		});
	}

	public void SetNotchHeldOpenForPresentation(bool held)
	{
		Update(() =>
		{
			heldOpenForPresentation = held;
		});
	}

	public void SetNotchHeldOpenByArc(bool held)
	{
		Update(() =>
		{
			heldOpenByArc = held;
		});
	}

	public void SetNotchAgentPeekHeldOpen(bool held)
	{
		Update(() =>
		{
			peekHeldOpen = held;
		});
	}

	public void SetRestingMarkState(bool showsHandle, bool isWorking)
	{
		Update(() =>
		{
			restingMarkShowsHandle = showsHandle;
			restingMarkIsWorking = isWorking;
		});
	}

	public void NoteTabPickedInsideOpenNotch()
	{
		Update(() =>
		{
			if (IsShowingNotchAgentPeekUnlocked)
			{
				suppressHoverExpandUntilNotchReentry = false;
				hovering = true;
				openRequested = true;
				openRequestSawHover = true;
			}
		});
	}

	public void OpenNotchAgentPeekOnRequest()
	{
		Update(() =>
		{
			openRequested = true;
			openRequestSawHover = hovering;
			suppressHoverExpandUntilNotchReentry = false;
			openRequestDeadline = clock() + OpenRequestTimeout;
		});
	}

	public void OpenNotchDocument()
	{
		Update(() =>
		{
			documentOpen = true;
			suppressHoverExpandUntilNotchReentry = false;
		}, sessionChanged: true);
	}

	public void CloseNotchDocument()
	{
		Update(() =>
		{
			documentOpen = false;
		}, sessionChanged: true);
	}

	public void DismissNotchAgentPeek()
	{
		Update(() =>
		{
			if (IsShowingNotchAgentPeekUnlocked)
			{
				keepsOpenThroughVoiceTurn = false;
				peekHeldOpen = false;
				heldOpenForPresentation = false;
				heldOpenByArc = false;
				documentOpen = false;
				if (chatSessionOpen)
				{
					TrackChatSessionEnded(NotchChatSessionCloseReason.NotchFolded);
				}
				chatSessionOpen = false;
				chatComposerHasDraft = false;
				chatComposerHasKeyboard = false;
				Tabs.DropDocumentIfShowingCore();
				openRequested = false;
				suppressHoverExpandUntilNotchReentry = true;
				hoverExpandRearmNotBefore = clock() + HoverExpandHoldAfterCardLeft;
				hovering = false;
			}
		}, sessionChanged: true);
	}

	public void SetRoutesTextModeToNotchChat(bool routes)
	{
		Update(() =>
		{
			routesTextModeToNotchChat = routes;
		});
	}

	public void SetNotchChatComposerHasDraft(bool hasDraft)
	{
		Update(() =>
		{
			chatComposerHasDraft = hasDraft;
		});
	}

	public void SetNotchChatComposerHasKeyboard(bool hasKeyboard)
	{
		Update(() =>
		{
			chatComposerHasKeyboard = hasKeyboard;
		});
	}

	public void NoteTypedChatMessageSent(int attachmentCount = 0)
	{
		Update(() =>
		{
			voiceTurnBeganWithListening = false;
			if (chatSessionOpen)
			{
				chatSessionSentMessageCount++;
				chatSessionSentAttachmentCount += attachmentCount;
			}
		});
	}

	private void TrackChatSessionOpened(NotchChatSessionOpenVia via, bool notchWasOpen, NotchTab tabBefore)
	{
		chatSessionStartedAt = clock();
		chatSessionOpenedVia = via;
		chatSessionSentMessageCount = 0;
		chatSessionSentAttachmentCount = 0;
		pendingChatAnalytics.Add(NotchChatAnalytics.SessionOpened(via, notchWasOpen, tabBefore));
	}

	private void TrackChatSessionEnded(NotchChatSessionCloseReason reason)
	{
		DateTimeOffset? dateTimeOffset = chatSessionStartedAt;
		if (dateTimeOffset.HasValue)
		{
			DateTimeOffset valueOrDefault = dateTimeOffset.GetValueOrDefault();
			chatSessionStartedAt = null;
			pendingChatAnalytics.Add(NotchChatAnalytics.SessionClosed(reason, chatSessionOpenedVia, clock() - valueOrDefault, chatSessionSentMessageCount, chatSessionSentAttachmentCount, chatComposerHasDraft, ChatAwaitingAnswer));
		}
	}

	private void FlushChatAnalytics()
	{
		JsonObject[] array;
		lock (gate)
		{
			if (pendingChatAnalytics.Count == 0)
			{
				return;
			}
			array = pendingChatAnalytics.ToArray();
			pendingChatAnalytics.Clear();
		}
		JsonObject[] array2 = array;
		foreach (JsonObject properties in array2)
		{
			ClickyAnalytics.TrackProductEvent("notch_chat_action", null, null, properties);
		}
	}

	public void OpenNotchChatSession(NotchChatSessionOpenVia via = NotchChatSessionOpenVia.DoubleControl)
	{
		bool isShowingNotchAgentPeekUnlocked;
		lock (gate)
		{
			isShowingNotchAgentPeekUnlocked = IsShowingNotchAgentPeekUnlocked;
			if (!chatSessionOpen)
			{
				TrackChatSessionOpened(via, isShowingNotchAgentPeekUnlocked, Tabs.SelectedCore);
			}
		}
		FlushChatAnalytics();
		Tabs.ShowChatForTyping(isShowingNotchAgentPeekUnlocked);
		Update(() =>
		{
			EndTextInput();
			documentOpen = false;
			NotchPresentation.TextResponse textResponse = this.textResponse;
			if ((object)textResponse != null && !textResponse.IsThinking && voiceState == VoiceState.Idle)
			{
				this.textResponse = null;
				textResponseRemaining = null;
			}
			chatSessionOpen = true;
			suppressHoverExpandUntilNotchReentry = false;
		}, sessionChanged: true);
		Tabs.RequestComposerFocus();
	}

	public void CloseNotchChatSession(NotchChatSessionCloseReason reason = NotchChatSessionCloseReason.Unspecified)
	{
		Update(() =>
		{
			if (chatSessionOpen)
			{
				TrackChatSessionEnded(reason);
				dragOpenedChatCloseAt = null;
				chatOpenedByFileDrag = false;
				chatSessionOpen = false;
				chatComposerHasDraft = false;
				chatComposerHasKeyboard = false;
				peekHeldOpen = false;
				Tabs.ConsumeComposerFocusRequestCore();
				pendingDroppedAttachments.Clear();
				suppressHoverExpandUntilNotchReentry = hovering;
				hovering = false;
			}
		}, sessionChanged: true);
	}

	public void EndNotchChatSessionIfLeftBehind(bool awaitingAnswerToSentMessage)
	{
		Update(() =>
		{
			if (!((!chatSessionOpen || ChatAwaitingAnswer) | awaitingAnswerToSentMessage))
			{
				NotchTab selectedCore = Tabs.SelectedCore;
				if ((selectedCore != NotchTab.Chat && selectedCore != NotchTab.Document) || 1 == 0)
				{
					dragOpenedChatCloseAt = null;
					chatOpenedByFileDrag = false;
					TrackChatSessionEnded(NotchChatSessionCloseReason.LeftChatTab);
					chatSessionOpen = false;
					chatComposerHasDraft = false;
					chatComposerHasKeyboard = false;
					Tabs.ConsumeComposerFocusRequestCore();
					pendingDroppedAttachments.Clear();
				}
			}
		}, sessionChanged: true);
	}

	public bool NotchChatHostsFileDrops(bool textResponseFollowUpHostsDrops)
	{
		lock (gate)
		{
			return ((routesTextModeToNotchChat && isSignedIn) || chatSessionOpen) && !textInputActive && !textResponseFollowUpHostsDrops;
		}
	}

	public bool NoteFileDragOverNotchChat()
	{
		bool flag = false;
		bool flag2 = false;
		lock (gate)
		{
			dragOpenedChatCloseAt = null;
			if (!chatSessionOpen && !chatOpenedByFileDrag)
			{
				chatOpenedByFileDrag = true;
				flag = true;
			}
			else if (chatSessionOpen && Tabs.SelectedCore != NotchTab.Chat)
			{
				flag2 = true;
			}
		}
		if (flag)
		{
			OpenNotchChatSession(NotchChatSessionOpenVia.FileDrag);
		}
		else if (flag2)
		{
			Tabs.Select(NotchTab.Chat);
		}
		return flag;
	}

	public bool NoteFileDragLeftNotchChat()
	{
		bool scheduled = false;
		Update(() =>
		{
			if (chatOpenedByFileDrag)
			{
				DateTimeOffset? dateTimeOffset = dragOpenedChatCloseAt;
				if (!dateTimeOffset.HasValue)
				{
					dragOpenedChatCloseAt = clock() + DragOpenedChatCloseGrace;
					scheduled = true;
				}
			}
		});
		return scheduled;
	}

	public string DropFilesOnNotchChat(IReadOnlyList<string> paths)
	{
		bool flag = false;
		string result;
		bool flag2;
		lock (gate)
		{
			if (chatOpenedByFileDrag)
			{
				result = "drag_opened";
			}
			else
			{
				result = (chatSessionOpen ? "user_opened" : "drop_opened");
			}
			dragOpenedChatCloseAt = null;
			chatOpenedByFileDrag = false;
			pendingDroppedAttachments.AddRange(paths);
			flag2 = !chatSessionOpen;
			if (!flag2 && Tabs.SelectedCore != NotchTab.Chat)
			{
				flag = true;
			}
		}
		if (flag2)
		{
			OpenNotchChatSession(NotchChatSessionOpenVia.FileDrop);
		}
		else if (flag)
		{
			Tabs.Select(NotchTab.Chat);
		}
		DroppedAttachmentsPending?.Invoke();
		return result;
	}

	public IReadOnlyList<string> TakePendingDroppedAttachments()
	{
		lock (gate)
		{
			List<string> result = pendingDroppedAttachments.ToList();
			pendingDroppedAttachments.Clear();
			return result;
		}
	}

	private void NoteHoverForOpenRequest()
	{
		if (openRequested)
		{
			openRequestSawHover = true;
		}
	}

	private (NotchActivityPhase, string?)? VoicePillPhaseForCurrentVoiceState()
	{
		if ((object)textResponse != null)
		{
			return null;
		}
		if (chatSessionOpen && !voiceTurnBeganWithListening && voiceState != VoiceState.Listening)
		{
			return null;
		}
		switch (voiceState)
		{
		case VoiceState.Listening:
			return (NotchActivityPhase.Listening, null);
		case VoiceState.Processing:
			return string.IsNullOrEmpty(customStatusLabel) ? (NotchActivityPhase.Thinking, null) : (NotchActivityPhase.Custom, customStatusLabel);
		case VoiceState.Responding:
			return (NotchActivityPhase.Speaking, null);
		default:
		{
			NotchLiveEvent notchLiveEvent = heldVoiceEvent;
			if (!(notchLiveEvent is NotchLiveEvent.ActivityListening))
			{
				if (!(notchLiveEvent is NotchLiveEvent.ActivityThinking))
				{
					if (!(notchLiveEvent is NotchLiveEvent.ActivitySpeaking))
					{
						if (notchLiveEvent is NotchLiveEvent.ActivityCustomStatus activityCustomStatus)
						{
							return (NotchActivityPhase.Custom, activityCustomStatus.Label);
						}
						return null;
					}
					return (NotchActivityPhase.Speaking, null);
				}
				return (NotchActivityPhase.Thinking, null);
			}
			return (NotchActivityPhase.Listening, null);
		}
		}
	}

	public void SetTourShowcaseShowing(bool showing)
	{
		Update(() =>
		{
			tourShowcaseShowing = showing;
		});
	}

	public void SetIntroHomeWelcomeActive(bool active)
	{
		Update(() =>
		{
			if (introWelcomeActive != active)
			{
				introWelcomeActive = active;
				if (!active)
				{
					introWelcomeAutoShownPin = false;
					introWelcomeHadHoverIn = false;
				}
			}
		});
	}

	public void SetIntroHomeWelcomeAutoShownPin(bool pinned)
	{
		Update(() =>
		{
			introWelcomeAutoShownPin = pinned;
			if (!pinned)
			{
				introWelcomeHadHoverIn = false;
			}
		});
	}

	public bool CollapseHoverAfterOutsideClick()
	{
		bool collapsed = false;
		bool closeChat = false;
		Update(() =>
		{
			if (!textInputActive)
			{
				if (keepsOpenThroughVoiceTurn)
				{
					keepsOpenThroughVoiceTurn = false;
					collapsed = true;
				}
				bool flag = openRequested;
				if (flag)
				{
					openRequested = false;
					openRequestSawHover = false;
				}
				if (chatSessionOpen)
				{
					if (chatComposerHasDraft || ChatAwaitingAnswer)
					{
						collapsed |= flag;
					}
					else
					{
						closeChat = true;
					}
				}
				else
				{
					bool flag2 = peekHeldOpen;
					peekHeldOpen = false;
					if (documentOpen)
					{
						documentOpen = false;
						Tabs.DropDocumentIfShowingCore();
						hovering = false;
						collapsed = true;
					}
					else if ((object)textResponse == null && (hovering || flag || flag2))
					{
						hovering = false;
						pointerInside = false;
						collapsed = true;
					}
				}
			}
		}, sessionChanged: true);
		if (closeChat)
		{
			CloseNotchChatSession(NotchChatSessionCloseReason.ClickElsewhere);
			return true;
		}
		return collapsed;
	}

	public void SetSignedIn(bool signedIn)
	{
		Update(() =>
		{
			isSignedIn = signedIn;
		});
	}

	public void SetOnboardingPin(int? step)
	{
		Update(() =>
		{
			if (onboardingPinStep != step)
			{
				onboardingPinManuallyDismissed = false;
			}
			onboardingPinStep = step;
		});
	}

	public void DismissOnboardingPin()
	{
		Update(() =>
		{
			onboardingPinManuallyDismissed = true;
			hovering = false;
		});
	}

	public void SetTutorialRestrictingNormalUse(bool restricting)
	{
		Update(() =>
		{
			isRestrictingForTutorial = restricting;
		});
	}

	public void SetOnboardingIntroOwnsStage(bool owns)
	{
		Update(() =>
		{
			if (introOwnsStage != owns)
			{
				introOwnsStage = owns;
				if (owns)
				{
					hovering = false;
				}
			}
		});
	}

	public void SetAmbientSuppressed(bool suppressed)
	{
		Update(() =>
		{
			ambientSuppressed = suppressed;
		});
	}

	public void SetDockedStripCoversForegroundApp(bool covers)
	{
		Update(() =>
		{
			dockedStripCoversForegroundApp = covers;
		});
	}

	public void PauseTextResponseAutoDismiss()
	{
		Update(() =>
		{
			textResponseUserPaused = true;
		});
	}

	public void SetTextResponseFollowUpActive(bool active)
	{
		Update(() =>
		{
			textResponseFollowUpActive = active;
		});
	}

	public void UpdateTextInputDraft(string draft)
	{
		Update(() =>
		{
			textInputDraft = draft;
		});
	}

	private void Update(Action change, bool sessionChanged = false)
	{
		bool changed;
		NotchTab? tabsBefore;
		bool pillChanged;
		bool hoverOpened;
		lock (gate)
		{
			(NotchActivityPhase Phase, string? Label)? tuple = voicePill;
			bool flag = heldOpenByArc;
			change();
			changed = Recompute();
			UpdateTicker();
			tabsBefore = tabsBeforeLadder;
			tabsBeforeLadder = null;
			(NotchActivityPhase, string)? tuple2 = voicePill;
			(NotchActivityPhase, string)? tuple3 = tuple;
			bool hasValue = tuple2.HasValue;
			if (hasValue != tuple3.HasValue)
			{
				goto IL_00cd;
			}
			if (hasValue)
			{
				(NotchActivityPhase, string) valueOrDefault = tuple2.GetValueOrDefault();
				(NotchActivityPhase, string) valueOrDefault2 = tuple3.GetValueOrDefault();
				if (valueOrDefault.Item1 != valueOrDefault2.Item1 || valueOrDefault.Item2 != valueOrDefault2.Item2)
				{
					goto IL_00cd;
				}
			}
			tuple3 = voicePill;
			int num = ((tuple3.HasValue && heldOpenByArc != flag) ? 1 : 0);
			goto IL_00ce;
			IL_00cd:
			num = 1;
			goto IL_00ce;
			IL_00ce:
			pillChanged = (byte)num != 0;
			hoverOpened = hoverOpenedNotchThisPass;
			hoverOpenedNotchThisPass = false;
		}
		FlushChatAnalytics();
		RaiseAfterLadder(changed, tabsBefore, pillChanged, hoverOpened, sessionChanged);
	}

	private void RaiseAfterLadder(bool changed, NotchTab? tabsBefore, bool pillChanged, bool hoverOpened, bool sessionChanged)
	{
		if (tabsBefore.HasValue)
		{
			NotchTab valueOrDefault = tabsBefore.GetValueOrDefault();
			Tabs.RaiseChangedAfterLadder(valueOrDefault);
		}
		if (changed)
		{
			RaiseChanged();
		}
		if (pillChanged)
		{
			VoicePillChanged?.Invoke();
		}
		if (hoverOpened)
		{
			HoverOpenedNotch?.Invoke();
		}
		if (sessionChanged)
		{
			NotchSessionChanged?.Invoke();
		}
	}

	public void Tick()
	{
		bool flag = false;
		bool flag2 = false;
		bool sessionChanged = false;
		bool changed;
		NotchTab? tabsBefore;
		bool pillChanged;
		bool hoverOpened;
		lock (gate)
		{
			(NotchActivityPhase Phase, string? Label)? tuple = voicePill;
			DateTimeOffset dateTimeOffset = clock();
			TimeSpan timeSpan = dateTimeOffset - lastTick;
			lastTick = dateTimeOffset;
			if (timeSpan < TimeSpan.Zero)
			{
				timeSpan = TimeSpan.Zero;
			}
			if (openRequested && !openRequestSawHover && dateTimeOffset >= openRequestDeadline)
			{
				openRequested = false;
				openRequestSawHover = false;
			}
			DateTimeOffset? dateTimeOffset2 = dragOpenedChatCloseAt;
			if (dateTimeOffset2.HasValue)
			{
				DateTimeOffset valueOrDefault = dateTimeOffset2.GetValueOrDefault();
				if (dateTimeOffset >= valueOrDefault)
				{
					dragOpenedChatCloseAt = null;
					if (chatOpenedByFileDrag && chatSessionOpen)
					{
						chatOpenedByFileDrag = false;
						if (!chatComposerHasDraft)
						{
							TrackChatSessionEnded(NotchChatSessionCloseReason.DragAbandoned);
							chatSessionOpen = false;
							chatComposerHasKeyboard = false;
							peekHeldOpen = false;
							Tabs.ConsumeComposerFocusRequestCore();
							pendingDroppedAttachments.Clear();
							suppressHoverExpandUntilNotchReentry = hovering;
							hovering = false;
							flag2 = true;
							sessionChanged = true;
						}
					}
				}
			}
			if (pointerInside && !hovering && !introOwnsStage && dateTimeOffset - pointerEnteredAt >= HoverDwell)
			{
				hovering = true;
				NoteHoverForOpenRequest();
				onboardingPinManuallyDismissed = false;
				flag = !suppressHoverExpandUntilNotchReentry;
				if (introWelcomeAutoShownPin && !slots.ContainsKey(typeof(NotchLiveEvent.IntroHatchPeek)))
				{
					introWelcomeHadHoverIn = true;
				}
			}
			if (suppressHoverExpandUntilNotchReentry && !pointerInside && dateTimeOffset >= hoverExpandRearmNotBefore)
			{
				suppressHoverExpandUntilNotchReentry = false;
			}
			if ((object)heldVoiceEvent != null && dateTimeOffset >= heldVoiceEventUntil)
			{
				heldVoiceEvent = null;
			}
			if (presentation is NotchPresentation.LiveEvent liveEvent && slots.TryGetValue(liveEvent.Event.GetType(), out LiveEventSlot value))
			{
				TimeSpan? remaining = value.Remaining;
				if (remaining.HasValue)
				{
					TimeSpan valueOrDefault2 = remaining.GetValueOrDefault();
					if (!value.PausesOnHover || !hovering)
					{
						valueOrDefault2 -= timeSpan;
						if (valueOrDefault2 <= TimeSpan.Zero)
						{
							slots.Remove(liveEvent.Event.GetType());
						}
						else
						{
							slots[liveEvent.Event.GetType()] = value with
							{
								Remaining = valueOrDefault2
							};
						}
					}
				}
			}
			if (presentation is NotchPresentation.TextResponse)
			{
				TimeSpan? remaining = textResponseRemaining;
				if (remaining.HasValue)
				{
					TimeSpan valueOrDefault3 = remaining.GetValueOrDefault();
					if (!hovering && !textResponseUserPaused && !textResponseFollowUpActive)
					{
						valueOrDefault3 -= timeSpan;
						if (valueOrDefault3 <= TimeSpan.Zero)
						{
							textResponse = null;
							textResponseRemaining = null;
						}
						else
						{
							textResponseRemaining = valueOrDefault3;
						}
					}
				}
			}
			changed = Recompute();
			UpdateTicker();
			tabsBefore = tabsBeforeLadder;
			tabsBeforeLadder = null;
			(NotchActivityPhase, string)? tuple2 = voicePill;
			(NotchActivityPhase, string)? tuple3 = tuple;
			bool hasValue = tuple2.HasValue;
			int num;
			if (hasValue != tuple3.HasValue)
			{
				num = 1;
			}
			else if (!hasValue)
			{
				num = 0;
			}
			else
			{
				(NotchActivityPhase, string) valueOrDefault4 = tuple2.GetValueOrDefault();
				(NotchActivityPhase, string) valueOrDefault5 = tuple3.GetValueOrDefault();
				num = ((valueOrDefault4.Item1 != valueOrDefault5.Item1 || valueOrDefault4.Item2 != valueOrDefault5.Item2) ? 1 : 0);
			}
			pillChanged = (byte)num != 0;
			hoverOpened = hoverOpenedNotchThisPass;
			hoverOpenedNotchThisPass = false;
		}
		FlushChatAnalytics();
		RaiseAfterLadder(changed, tabsBefore, pillChanged, hoverOpened, sessionChanged);
		if (flag2)
		{
			DragOpenedChatAbandoned?.Invoke();
		}
		if (flag)
		{
			try
			{
				HoverDwellCompleted?.Invoke();
			}
			catch (Exception ex)
			{
				Log.Error("Notch", "HoverDwellCompleted handler threw", ex);
			}
		}
	}

	private void UpdateTicker()
	{
		if (ticker == null)
		{
			return;
		}
		int num;
		if ((!pointerInside || hovering) && (object)heldVoiceEvent == null && (!suppressHoverExpandUntilNotchReentry || pointerInside) && (!openRequested || openRequestSawHover))
		{
			DateTimeOffset? dateTimeOffset = dragOpenedChatCloseAt;
			if (!dateTimeOffset.HasValue && (!(presentation is NotchPresentation.LiveEvent liveEvent) || !slots.TryGetValue(liveEvent.Event.GetType(), out LiveEventSlot value) || !value.Remaining.HasValue))
			{
				if (presentation is NotchPresentation.TextResponse)
				{
					TimeSpan? timeSpan = textResponseRemaining;
					if (timeSpan.HasValue)
					{
						num = ((!textResponseUserPaused) ? 1 : 0);
						goto IL_00c1;
					}
				}
				num = 0;
				goto IL_00c1;
			}
		}
		num = 1;
		goto IL_00c1;
		IL_00c1:
		bool flag = (byte)num != 0;
		if (flag != ticking)
		{
			ticking = flag;
			if (flag)
			{
				lastTick = clock();
				ticker.Change(TimeSpan.FromMilliseconds(100L, 0L), TimeSpan.FromMilliseconds(100L, 0L));
			}
			else
			{
				ticker.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
			}
		}
	}

	private bool Recompute()
	{
		HoldHoverClosedIfShownCardIsGoingAway();
		NotchPresentation notchPresentation = Ladder();
		if (notchPresentation == presentation)
		{
			hasAppliedInitialPresentation = true;
			return false;
		}
		TrackPinnedTransition(presentation, notchPresentation);
		presentation = notchPresentation;
		return true;
	}

	private void HoldHoverClosedIfShownCardIsGoingAway()
	{
		if (!(presentation is NotchPresentation.LiveEvent liveEvent))
		{
			return;
		}
		NotchLiveEvent notchLiveEvent = liveEvent.Event;
		Type type = notchLiveEvent.GetType();
		bool num;
		if (!(notchLiveEvent is NotchLiveEvent.ClickyUpdate))
		{
			if (!CardsHoldingHoverAfterLeaving.Contains(type))
			{
				return;
			}
			num = !slots.ContainsKey(type);
		}
		else
		{
			num = (object)Updates.Current == null;
		}
		if (num)
		{
			suppressHoverExpandUntilNotchReentry = true;
			hoverExpandRearmNotBefore = clock() + HoverExpandHoldAfterCardLeft;
		}
	}

	private void TrackPinnedTransition(NotchPresentation previous, NotchPresentation next)
	{
		bool flag = !hasAppliedInitialPresentation;
		hasAppliedInitialPresentation = true;
		bool flag2 = previous is NotchPresentation.OnboardingPinned;
		bool flag3 = next is NotchPresentation.OnboardingPinned;
		if (flag)
		{
			if (flag3)
			{
				expandedSurfaceStartedAt = clock();
			}
		}
		else if (!flag2 & flag3)
		{
			expandedSurfaceStartedAt = clock();
			string trigger;
			if (IntroWelcomeAutoPinned)
			{
				trigger = "intro_welcome_auto_pin";
			}
			else
			{
				trigger = (hovering ? "hover" : "onboarding_pin");
			}
			ClickyAnalytics.TrackNotchExpanded(trigger);
		}
		else if (flag2 && !flag3)
		{
			DateTimeOffset? dateTimeOffset = expandedSurfaceStartedAt;
			int dwellMs;
			if (dateTimeOffset.HasValue)
			{
				DateTimeOffset valueOrDefault = dateTimeOffset.GetValueOrDefault();
				dwellMs = (int)(clock() - valueOrDefault).TotalMilliseconds;
			}
			else
			{
				dwellMs = 0;
			}
			expandedSurfaceStartedAt = null;
			ClickyAnalytics.TrackNotchCollapsed(dwellMs);
		}
	}

	private NotchPresentation Ladder()
	{
		bool isShowingNotchAgentPeekUnlocked = IsShowingNotchAgentPeekUnlocked;
		DateTimeOffset dateTimeOffset = clock();
		int? num = onboardingPinStep;
		bool flag = num.HasValue && !introOwnsStage;
		NotchUpdate current = Updates.Current;
		bool flag2 = slots.Keys.Any((Type t) => ActionableCards.Contains(t)) || (object)current != null;
		bool flag3 = hovering && !suppressHoverExpandUntilNotchReentry && !flag && !flag2 && !isRestrictingForTutorial && !introOwnsStage;
		if (textInputActive)
		{
			return new NotchPresentation.TextInput(textInputDraft, textInputAgentFollowUp);
		}
		if (Has<NotchLiveEvent.Dictation>(out var value))
		{
			return Live(value);
		}
		if (!chatSessionOpen)
		{
			NotchPresentation.TextResponse textResponse = this.textResponse;
			if ((object)textResponse != null)
			{
				if (textResponse.Answer.Length == 0 && textResponse.IsThinking)
				{
					return Live(string.IsNullOrEmpty(customStatusLabel) ? ((NotchLiveEvent)new NotchLiveEvent.ActivityThinking()) : ((NotchLiveEvent)new NotchLiveEvent.ActivityCustomStatus(customStatusLabel)));
				}
				return textResponse;
			}
		}
		if (Has<NotchLiveEvent.IntegrationConnected>(out var value2))
		{
			return Live(value2);
		}
		if (VoiceTurnActiveForPresentation & isShowingNotchAgentPeekUnlocked)
		{
			keepsOpenThroughVoiceTurn = true;
		}
		if (keepsOpenThroughVoiceTurn)
		{
			bool flag4 = hovering || peekHeldOpen || heldOpenForPresentation || heldOpenByArc || documentOpen || ChatSessionHoldingNotch || openRequested;
			if (VoiceTurnActiveForPresentation & flag4)
			{
				voicePill = (tourShowcaseShowing ? (((NotchActivityPhase, string)?)null) : VoicePillPhaseForCurrentVoiceState());
				return Peek();
			}
			keepsOpenThroughVoiceTurn = false;
		}
		voicePill = null;
		if (Has<NotchLiveEvent.VoiceReplyMutedCopiedToClipboard>(out var value3))
		{
			return Live(value3);
		}
		if (voiceState == VoiceState.Listening)
		{
			return Live(new NotchLiveEvent.ActivityListening());
		}
		bool chatSessionHoldingNotch = ChatSessionHoldingNotch;
		if ((peekHeldOpen || heldOpenForPresentation || heldOpenByArc || openRequested || documentOpen) | chatSessionHoldingNotch)
		{
			if (!isShowingNotchAgentPeekUnlocked)
			{
				NoteFreshOpen();
				if (chatSessionHoldingNotch && Tabs.SelectedCore != NotchTab.Chat)
				{
					Tabs.SelectCoreInternal(NotchTab.Chat);
				}
			}
			return Peek();
		}
		if (flag3)
		{
			if (hoverRoutesToNotch && isSignedIn)
			{
				if (!isShowingNotchAgentPeekUnlocked)
				{
					hoverOpenedNotchThisPass = true;
					NoteFreshOpen(isHoverOpen: true);
				}
				return Peek();
			}
			if (!isSignedIn)
			{
				return new NotchPresentation.OnboardingPinned(-1);
			}
		}
		if ((object)current != null)
		{
			return Live(new NotchLiveEvent.ClickyUpdate(current.RailKey, current.Kind.RawValue()));
		}
		if (voiceState == VoiceState.Processing)
		{
			return Live(string.IsNullOrEmpty(customStatusLabel) ? ((NotchLiveEvent)new NotchLiveEvent.ActivityThinking()) : ((NotchLiveEvent)new NotchLiveEvent.ActivityCustomStatus(customStatusLabel)));
		}
		if (voiceState == VoiceState.Responding)
		{
			return Live(new NotchLiveEvent.ActivitySpeaking());
		}
		if ((object)heldVoiceEvent != null && dateTimeOffset < heldVoiceEventUntil)
		{
			return Live(heldVoiceEvent);
		}
		if (Has<NotchLiveEvent.HandoffSent>(out var value4))
		{
			return Live(value4);
		}
		if (Has<NotchLiveEvent.HandoffQueued>(out var value5))
		{
			return Live(value5);
		}
		if (Has<NotchLiveEvent.OnboardingTutorialInvite>(out var value6))
		{
			return Live(value6);
		}
		if (Has<NotchLiveEvent.OnboardingTutorialResume>(out var value7) && hovering)
		{
			return Live(value7);
		}
		if (Has<NotchLiveEvent.MicrophoneTrouble>(out var value8))
		{
			return Live(value8);
		}
		if (Has<NotchLiveEvent.DictationCopiedToClipboard>(out var value9))
		{
			return Live(value9);
		}
		if (Has<NotchLiveEvent.MeetingCountdown>(out var value10))
		{
			return Live(value10);
		}
		if (Has<NotchLiveEvent.DocumentFolderAccessDenied>(out var value11))
		{
			return Live(value11);
		}
		if (Has<NotchLiveEvent.MorningSuggestions>(out var value12) && voiceState == VoiceState.Idle)
		{
			return Live(value12);
		}
		if (Has<NotchLiveEvent.SpotifyVoiceTip>(out var value13))
		{
			return Live(value13);
		}
		if (Has<NotchLiveEvent.SidecarLearningSuggestion>(out var value14))
		{
			return Live(value14);
		}
		if (Has<NotchLiveEvent.IntegrationSuggestion>(out var value15))
		{
			return Live(value15);
		}
		if (Has<NotchLiveEvent.DictionaryWordLearned>(out var value16))
		{
			return Live(value16);
		}
		if (Has<NotchLiveEvent.AppUpdated>(out var value17))
		{
			return Live(value17);
		}
		bool flag5 = !ambientSuppressed;
		if ((ShowsRunningAgentsStrip & flag5) && Has<NotchLiveEvent.AgentMultiActivity>(out var value18))
		{
			return Live(value18);
		}
		if ((ShowsRunningAgentsStrip & flag5) && Has<NotchLiveEvent.AgentTask>(out var value19))
		{
			return Live(value19);
		}
		if (Has<NotchLiveEvent.IntroHatchPeek>(out var value20))
		{
			return Live(value20);
		}
		if (Has<NotchLiveEvent.IntroSkillPing>(out var value21))
		{
			return Live(value21);
		}
		bool flag6 = !introWelcomeActive || hovering || introWelcomeAutoShownPin;
		if ((flag && !onboardingPinManuallyDismissed) & flag6)
		{
			return new NotchPresentation.OnboardingPinned(onboardingPinStep.Value);
		}
		if (flag5 && Has<NotchLiveEvent.SkillPinned>(out var value22) && value22.Count > 0)
		{
			return Live(value22);
		}
		bool flag7 = Has<NotchLiveEvent.DockedIdle>(out var value23);
		if (flag5 && restingMarkShowsHandle && restingMarkIsWorking && (!dockedStripCoversForegroundApp || (RestingMarkIsGlowingBar && !flag7)))
		{
			return Live(new NotchLiveEvent.RestingMark(flag7));
		}
		if ((flag5 && !dockedStripCoversForegroundApp) & flag7)
		{
			return Live(value23);
		}
		return new NotchPresentation.Idle();
		bool Has<T>(out T reference) where T : notnull, NotchLiveEvent
		{
			if (slots.TryGetValue(typeof(T), out LiveEventSlot value24))
			{
				reference = (T)value24.Event;
				return true;
			}
			reference = null;
			return false;
		}
		static NotchPresentation Live(NotchLiveEvent e)
		{
			return new NotchPresentation.LiveEvent(e);
		}
		void NoteFreshOpen(bool isHoverOpen = false)
		{
			NotchTab valueOrDefault = tabsBeforeLadder.GetValueOrDefault();
			if (!tabsBeforeLadder.HasValue)
			{
				valueOrDefault = Tabs.SelectedCore;
				tabsBeforeLadder = valueOrDefault;
			}
			Tabs.NoteFreshOpenCore(isHoverOpen);
		}
		static NotchPresentation Peek()
		{
			return Live(new NotchLiveEvent.AgentPeek());
		}
	}

	private static (TimeSpan? Duration, bool PausesOnHover) DefaultAutoDismiss(NotchLiveEvent liveEvent)
	{
		if (!(liveEvent is NotchLiveEvent.MicrophoneTrouble))
		{
			if (!(liveEvent is NotchLiveEvent.DictationCopiedToClipboard))
			{
				if (!(liveEvent is NotchLiveEvent.VoiceReplyMutedCopiedToClipboard))
				{
					if (!(liveEvent is NotchLiveEvent.AppUpdated))
					{
						if (!(liveEvent is NotchLiveEvent.HandoffQueued))
						{
							if (!(liveEvent is NotchLiveEvent.HandoffSent))
							{
								if (liveEvent is NotchLiveEvent.DictionaryWordLearned)
								{
									return (Duration: TimeSpan.FromSeconds(6L), PausesOnHover: false);
								}
								return (Duration: null, PausesOnHover: false);
							}
							return (Duration: TimeSpan.FromSeconds(1.5), PausesOnHover: false);
						}
						return (Duration: TimeSpan.FromSeconds(1.4), PausesOnHover: false);
					}
					return (Duration: AppUpdatedAutoHide, PausesOnHover: true);
				}
				return (Duration: MutedSpeakerAutoHide, PausesOnHover: true);
			}
			return (Duration: DictationClipboardAutoHide, PausesOnHover: false);
		}
		return (Duration: MicrophoneTroubleAutoHide, PausesOnHover: false);
	}

	public static TimeSpan AutoDismissForTextResponse(string answer, bool duringTutorial = false)
	{
		string text = answer.Trim();
		double num;
		if (text.Length == 0)
		{
			num = 10.0;
		}
		else
		{
			int num2 = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
			int num3 = text.Split('\n').Sum((string line) => Math.Max(1, (int)Math.Ceiling((double)line.Length / 74.0)));
			num = ((num2 <= 32 && num3 <= 3) ? 10 : ((num2 <= 90 && num3 <= 8) ? 20 : 30));
		}
		if (duringTutorial)
		{
			num = Math.Min(num, 6.0);
		}
		return TimeSpan.FromSeconds(num);
	}

	private void RaiseChanged()
	{
		try
		{
			PresentationChanged?.Invoke(this, EventArgs.Empty);
		}
		catch (Exception ex)
		{
			Log.Error("Notch", "PresentationChanged handler threw", ex);
		}
	}

	public void Dispose()
	{
		ticker?.Dispose();
	}

	static NotchPresenter()
	{
		HashSet<Type> hashSet = new HashSet<Type>();
		foreach (Type actionableCard in ActionableCards)
		{
			hashSet.Add(actionableCard);
		}
		hashSet.Add(typeof(NotchLiveEvent.IntegrationConnected));
		CardsHoldingHoverAfterLeaving = hashSet;
	}
}
