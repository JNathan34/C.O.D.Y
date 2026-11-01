using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;

namespace HeyClicky.App.Notch;

public static class NotchAccessibility
{
	private static string? last;

	public static string Describe(NotchPresentation presentation)
	{
		if (!(presentation is NotchPresentation.Idle))
		{
			if (!(presentation is NotchPresentation.TextInput))
			{
				if (presentation is NotchPresentation.TextResponse textResponse)
				{
					if (textResponse.IsThinking)
					{
						return "HeyClicky is thinking";
					}
					return string.IsNullOrWhiteSpace(textResponse.Answer) ? "HeyClicky answer" : ("HeyClicky: " + Trim(textResponse.Answer));
				}
				if (!(presentation is NotchPresentation.OnboardingPinned))
				{
					if (presentation is NotchPresentation.LiveEvent liveEvent)
					{
						NotchLiveEvent notchLiveEvent = liveEvent.Event;
						string result;
						if (notchLiveEvent is NotchLiveEvent.ActivityListening)
						{
							result = "Listening";
						}
						else if (notchLiveEvent is NotchLiveEvent.ActivityThinking)
						{
							result = "Thinking";
						}
						else if (notchLiveEvent is NotchLiveEvent.ActivitySpeaking)
						{
							result = "Speaking";
						}
						else if (notchLiveEvent is NotchLiveEvent.ActivityCustomStatus activityCustomStatus)
						{
							result = activityCustomStatus.Label;
						}
						else if (notchLiveEvent is NotchLiveEvent.Dictation dictation)
						{
							result = dictation.Label;
						}
						else if (notchLiveEvent is NotchLiveEvent.AgentTask agentTask)
						{
							result = agentTask.Title + ": " + agentTask.Status;
						}
						else if (notchLiveEvent is NotchLiveEvent.AgentMultiActivity agentMultiActivity)
						{
							result = $"{agentMultiActivity.Count} Clickys working";
						}
						else if (notchLiveEvent is NotchLiveEvent.MicrophoneTrouble microphoneTrouble)
						{
							result = microphoneTrouble.Message;
						}
						else if (notchLiveEvent is NotchLiveEvent.VoiceReplyMutedCopiedToClipboard)
						{
							result = "Your sound is off. The reply was copied to your clipboard";
						}
						else if (notchLiveEvent is NotchLiveEvent.DictationCopiedToClipboard)
						{
							result = "Copied to your clipboard. Press Ctrl+V to paste";
						}
						else if (notchLiveEvent is NotchLiveEvent.AppUpdated appUpdated)
						{
							result = "HeyClicky updated. You're on version " + appUpdated.Version;
						}
						else if (notchLiveEvent is NotchLiveEvent.DictionaryWordLearned dictionaryWordLearned)
						{
							result = "Added " + dictionaryWordLearned.Word + " to your dictionary";
						}
						else if (notchLiveEvent is NotchLiveEvent.RestingMark)
						{
							result = "HeyClicky, working";
						}
						else if (notchLiveEvent is NotchLiveEvent.ClickyUpdate clickyUpdate)
						{
							if (clickyUpdate.Kind == "done")
							{
								result = "A job is done";
							}
							else
							{
								result = ((clickyUpdate.Kind == "failed") ? "A job didn't finish" : "A job needs you");
							}
						}
						else
						{
							result = ((!(notchLiveEvent is NotchLiveEvent.AgentPeek)) ? "HeyClicky" : "HeyClicky");
						}
						return result;
					}
					return "HeyClicky";
				}
				return "HeyClicky setup";
			}
			return "Type to HeyClicky";
		}
		return "HeyClicky";
	}

	private static string Trim(string text)
	{
		if (text.Length > 200)
		{
			return text.Substring(0, 200);
		}
		return text;
	}

	public static void Announce(FrameworkElement root, NotchPresentation presentation)
	{
		string text = Describe(presentation);
		if (text == last)
		{
			return;
		}
		last = text;
		AutomationProperties.SetName(root, text);
		AutomationProperties.SetLiveSetting(root, AutomationLiveSetting.Polite);
		try
		{
			if (AutomationPeer.ListenerExists(AutomationEvents.LiveRegionChanged))
			{
				(FrameworkElementAutomationPeer.FromElement(root) ?? FrameworkElementAutomationPeer.CreatePeerForElement(root))?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
			}
		}
		catch
		{
		}
	}
}
