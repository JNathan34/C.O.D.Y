using System;

namespace HeyClicky.Core.Dictation;

public sealed class DictationControllerOptions
{
	public Func<string> UsageContext { get; init; } = () => "companion";

	public Func<bool> IsOnboardingTutorialRestricting { get; init; } = () => false;

	public Func<bool> CanStartRecording { get; init; } = () => true;

	public Func<bool> IsMicrophoneDenied { get; init; } = () => false;

	public Action<string, float> PlayCue { get; init; } = (string _, float _) =>
	{
	};
}
