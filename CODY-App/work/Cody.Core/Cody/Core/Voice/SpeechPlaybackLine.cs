using System.Threading;

namespace HeyClicky.Core.Voice;

public sealed class SpeechPlaybackLine(string text, double startSeconds, double durationSeconds = double.PositiveInfinity)
{
    private double endSeconds = startSeconds + durationSeconds;

    public string Text { get; } = text;
    public double StartSeconds { get; } = startSeconds;
    public double EndSeconds => Volatile.Read(ref endSeconds);

    internal void Complete(double seconds) => Volatile.Write(ref endSeconds, StartSeconds + seconds);
}
