using System;
using System.Collections.Generic;
using HeyClicky.Core.Voice;

namespace HeyClicky.App.Cody;

internal sealed class CodySpeechSubtitles(IAudioOutput audio, Action<string> publish)
{
    private readonly object gate = new();
    private readonly Queue<SpeechPlaybackLine> lines = new();
    private SpeechPlaybackLine visible;

    internal void Enqueue(SpeechPlaybackLine line)
    {
        lock (gate) lines.Enqueue(line);
    }

    internal void Tick()
    {
        lock (gate)
        {
            if (lines.Count == 0 && visible == null) return;
            double played = audio.PlayedSeconds;
            bool drained = audio.Buffered <= TimeSpan.Zero;
            while (lines.TryPeek(out var line) && (played >= line.EndSeconds ||
                drained && double.IsFinite(line.EndSeconds)))
                lines.Dequeue();

            var next = lines.TryPeek(out var playing) && played > playing.StartSeconds ? playing : null;
            if (ReferenceEquals(next, visible)) return;
            visible = next;
            publish(next?.Text);
        }
    }

    internal void Clear()
    {
        lock (gate)
        {
            lines.Clear();
            visible = null;
        }
    }
}
