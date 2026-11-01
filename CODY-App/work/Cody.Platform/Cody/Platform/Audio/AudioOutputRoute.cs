using System;

namespace HeyClicky.Platform.Audio;

public static class AudioOutputRoute
{
	public static event Action<AudioOutputRouteChange>? Changed;

	internal static void Raise(AudioOutputRouteChange change)
	{
		Log.Info("AudioOut", $"{change.StreamName}: route {change.FromDevice} ({change.FromTransport}) -> {change.ToDevice} ({change.ToTransport}), dropped {change.DroppedBuffers}, was running {change.EngineWasRunning}, reopened {change.RestartSucceeded}");
		try
		{
			Changed?.Invoke(change);
		}
		catch (Exception ex)
		{
			Log.Warn("AudioOut", "route observer threw: " + ex.Message);
		}
	}
}
