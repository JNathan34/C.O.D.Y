using System;
using System.Collections.Generic;
using HeyClicky.App.Design;
using HeyClicky.App.Notch.Peek;
using HeyClicky.App.Notch.Surfaces;
using Windows.UI;

namespace HeyClicky.App.Notch;

public static class NotchSurfaces
{
	public static Func<string, IReadOnlyList<string>> UseCasesFor { get; set; } = (string toolkit) => toolkit.ToLowerInvariant() switch
	{
		"gmail" => (IReadOnlyList<string>)new string[4] { "Draft replies from your inbox", "Summarize unread threads", "Find that one email", "Clean up newsletters" }, 
		"github" => new string[4] { "Review open pull requests", "Triage new issues", "Summarize a repo", "Write release notes" }, 
		"googlecalendar" => new string[4] { "Plan your week", "Find a free slot", "Prep for your next meeting", "Move a meeting" }, 
		_ => new string[4] { "Answer questions with your data", "Automate busywork", "Draft and summarize", "Keep things in sync" }, 
	};

	public static NotchSurface? Create(NotchPresentation p, INotchHost host)
	{
		if (HeyClicky.App.Cody.CodyChrome.Handles(p, host)) return new HeyClicky.App.Cody.CodyChatSurface(p);
		p = NotchGeometry.Shown(p);
		if (!(p is NotchPresentation.TextInput p2))
		{
			if (!(p is NotchPresentation.TextResponse r))
			{
				if (!(p is NotchPresentation.OnboardingPinned onboardingPinned))
				{
					if (p is NotchPresentation.LiveEvent liveEvent)
					{
						NotchLiveEvent notchLiveEvent = liveEvent.Event;
						(ActivityPhase, string, bool)? tuple = ActivitySurface.Classify(notchLiveEvent);
						if (tuple.HasValue)
						{
							var (phase, label, recording) = tuple.GetValueOrDefault();
							return new ActivitySurface(phase, label, recording, Cursor);
						}
						if (notchLiveEvent is NotchLiveEvent.AgentTask agentTask)
						{
							return new AgentTaskSurface(agentTask, AgentColors.For(agentTask.TaskId, 0));
						}
						if (notchLiveEvent is NotchLiveEvent.RestingMark)
						{
							if (!NotchGeometry.IsWorkingBar(p))
							{
								return new RestingMarkSurface();
							}
							return null;
						}
						if (notchLiveEvent is NotchLiveEvent.ClickyUpdate)
						{
							return new ClickyUpdateSurface();
						}
						if (notchLiveEvent is NotchLiveEvent.AppUpdated e)
						{
							return new AppUpdatedSurface(e);
						}
						if (notchLiveEvent is NotchLiveEvent.DictationCopiedToClipboard)
						{
							return new DictationClipboardSurface();
						}
						if (notchLiveEvent is NotchLiveEvent.VoiceReplyMutedCopiedToClipboard e2)
						{
							return new MutedSpeakerSurface(e2);
						}
						if (notchLiveEvent is NotchLiveEvent.MicrophoneTrouble e3)
						{
							return new MicrophoneTroubleSurface(e3);
						}
						if (notchLiveEvent is NotchLiveEvent.MeetingCountdown e4)
						{
							return new MeetingCountdownSurface(e4);
						}
						if (notchLiveEvent is NotchLiveEvent.OnboardingTutorialInvite)
						{
							return new TutorialInviteSurface(TutorialInviteSurface.Mode.Invite);
						}
						if (notchLiveEvent is NotchLiveEvent.OnboardingTutorialResume)
						{
							return new TutorialInviteSurface(TutorialInviteSurface.Mode.Resume, host.SizeContext.TutorialResumeShowsContinue);
						}
						if (notchLiveEvent is NotchLiveEvent.MorningSuggestions e5)
						{
							return new MorningSuggestionsSurface(e5);
						}
						if (notchLiveEvent is NotchLiveEvent.IntegrationSuggestion integrationSuggestion)
						{
							IReadOnlyList<string> readOnlyList = UseCasesFor(integrationSuggestion.Toolkit);
							host.SizeContext.IntegrationHasUseCases = readOnlyList.Count > 0;
							return new IntegrationSuggestionSurface(integrationSuggestion, readOnlyList);
						}
						if (notchLiveEvent is NotchLiveEvent.IntegrationConnected integrationConnected)
						{
							IReadOnlyList<string> readOnlyList2 = UseCasesFor(integrationConnected.Toolkit);
							host.SizeContext.IntegrationHasUseCases = readOnlyList2.Count > 0;
							return new IntegrationConnectedSurface(integrationConnected, readOnlyList2);
						}
						if (notchLiveEvent is NotchLiveEvent.AgentPeek)
						{
							return new NotchPeekSurface();
						}
						if (notchLiveEvent is NotchLiveEvent.HandoffQueued || notchLiveEvent is NotchLiveEvent.HandoffSent)
						{
							return new HandoffSurface(notchLiveEvent);
						}
						if (notchLiveEvent is NotchLiveEvent.SkillPinned e6)
						{
							return new SkillPinnedSurface(e6);
						}
						if (notchLiveEvent is NotchLiveEvent.IntroSkillPing e7)
						{
							return new IntroSkillPingSurface(e7, Cursor());
						}
						if (notchLiveEvent is NotchLiveEvent.SidecarLearningSuggestion || notchLiveEvent is NotchLiveEvent.SpotifyVoiceTip)
						{
							return new AppTipSurface(notchLiveEvent);
						}
						if (notchLiveEvent is NotchLiveEvent.DictionaryWordLearned e8)
						{
							return new DictionaryLearnedSurface(e8);
						}
						if (notchLiveEvent is NotchLiveEvent.DocumentFolderAccessDenied e9)
						{
							return new DocumentAccessSurface(e9);
						}
					}
					return null;
				}
				return new OnboardingCardSurface(onboardingPinned.Step);
			}
			return new TextResponseSurface(r);
		}
		return new TextInputSurface(p2, host.Services.Auth.IsSignedIn, () => host.WindowHandle);
		Color Cursor()
		{
			return DS.CursorColor(host.Services.Settings.CursorColorHex);
		}
	}
}
