using System;

namespace HeyClicky.Core.Dictation;

public sealed class DictationHotkeyStateMachine
{
	public static readonly TimeSpan QuickTapMaxHold = TimeSpan.FromSeconds(0.4);

	public static readonly TimeSpan LockDoubleTapMaxGap = TimeSpan.FromSeconds(0.4);

	private readonly IDictationScheduler scheduler;

	private readonly Func<bool> isSessionActive;

	private readonly Action begin;

	private readonly Action end;

	private readonly Action lockedHandsFree;

	private DateTimeOffset? holdPressStartTime;

	private IDisposable? pendingQuickTapFinish;

	private bool shouldIgnoreNextReleaseAfterLockStop;

	public DictationEngagement Engagement { get; private set; }

	public bool SessionUsedHandsFree { get; private set; }

	public bool IsDedicatedHandsFreeShortcutConfigured { get; set; }

	public Func<bool> IsOnboardingTutorialActive { get; set; } = () => false;

	public bool HasPendingQuickTapFinish => pendingQuickTapFinish != null;

	public DictationHotkeyStateMachine(IDictationScheduler scheduler, Func<bool> isSessionActive, Action begin, Action end, Action lockedHandsFree)
	{
		this.scheduler = scheduler;
		this.isSessionActive = isSessionActive;
		this.begin = begin;
		this.end = end;
		this.lockedHandsFree = lockedHandsFree;
	}

	public void Pressed()
	{
		if (pendingQuickTapFinish != null)
		{
			pendingQuickTapFinish.Dispose();
			pendingQuickTapFinish = null;
			holdPressStartTime = null;
			Engagement = DictationEngagement.HandsFreeLocked;
			SessionUsedHandsFree = true;
			lockedHandsFree();
		}
		else if (Engagement == DictationEngagement.HandsFreeLocked)
		{
			Engagement = DictationEngagement.Idle;
			shouldIgnoreNextReleaseAfterLockStop = true;
			end();
		}
		else if (Engagement == DictationEngagement.Idle)
		{
			bool flag = isSessionActive();
			begin();
			if (isSessionActive() && !flag)
			{
				Engagement = DictationEngagement.Holding;
				SessionUsedHandsFree = false;
				holdPressStartTime = scheduler.Now;
			}
		}
	}

	public void Released()
	{
		if (shouldIgnoreNextReleaseAfterLockStop)
		{
			shouldIgnoreNextReleaseAfterLockStop = false;
		}
		else
		{
			if (Engagement != DictationEngagement.Holding)
			{
				return;
			}
			DateTimeOffset? dateTimeOffset = holdPressStartTime;
			TimeSpan timeSpan;
			if (dateTimeOffset.HasValue)
			{
				DateTimeOffset valueOrDefault = dateTimeOffset.GetValueOrDefault();
				timeSpan = scheduler.Now - valueOrDefault;
			}
			else
			{
				timeSpan = QuickTapMaxHold + TimeSpan.FromSeconds(1L);
			}
			holdPressStartTime = null;
			if (timeSpan >= QuickTapMaxHold || IsDedicatedHandsFreeShortcutConfigured || IsOnboardingTutorialActive())
			{
				Engagement = DictationEngagement.Idle;
				end();
				return;
			}
			pendingQuickTapFinish = scheduler.Schedule(LockDoubleTapMaxGap, () =>
			{
				if (pendingQuickTapFinish != null)
				{
					pendingQuickTapFinish = null;
					Engagement = DictationEngagement.Idle;
					end();
				}
			});
		}
	}

	public void ToggleHandsFree()
	{
		switch (Engagement)
		{
		case DictationEngagement.HandsFreeLocked:
			Engagement = DictationEngagement.Idle;
			end();
			break;
		case DictationEngagement.Holding:
			pendingQuickTapFinish?.Dispose();
			pendingQuickTapFinish = null;
			holdPressStartTime = null;
			Engagement = DictationEngagement.HandsFreeLocked;
			SessionUsedHandsFree = true;
			lockedHandsFree();
			break;
		case DictationEngagement.Idle:
		{
			bool flag = isSessionActive();
			begin();
			if (isSessionActive() && !flag)
			{
				Engagement = DictationEngagement.HandsFreeLocked;
				SessionUsedHandsFree = true;
				lockedHandsFree();
			}
			break;
		}
		}
	}

	public void Reset()
	{
		pendingQuickTapFinish?.Dispose();
		pendingQuickTapFinish = null;
		holdPressStartTime = null;
		shouldIgnoreNextReleaseAfterLockStop = false;
		Engagement = DictationEngagement.Idle;
	}
}
