using HeyClicky;
using HeyClicky.App.Cody;
using HeyClicky.Core.Voice;

var audio = new Audio();
string caption = null;
var subtitles = new CodySpeechSubtitles(audio, text => caption = text);

void Check(double position, double buffered, string expected)
{
    audio.PlayedSeconds = position;
    audio.Buffered = TimeSpan.FromSeconds(buffered);
    subtitles.Tick();
    if (caption != expected)
        throw new Exception($"At {position}s expected '{expected}', got '{caption}'.");
}

var line = new SpeechPlaybackLine("The first line", 0.5);
subtitles.Enqueue(line);
Check(0, 1, null);
Check(0.9, 0.6, "The first line");
Check(1.5, 0, "The first line"); // The next audio chunk has yet to arrive.
line.Complete(2);
subtitles.Enqueue(new SpeechPlaybackLine("The next line", 2.85, 1.5));
Check(2.49, 1.86, "The first line");
Check(2.6, 1.75, null);
Check(2.9, 1.45, "The next line");
Check(4.35, 0, null);

// The same words finish later when the voice produces a longer audio segment.
subtitles.Enqueue(new SpeechPlaybackLine("Same words", 0, 2));
Check(1.9, 0.1, "Same words");
Check(2, 0, null);
subtitles.Enqueue(new SpeechPlaybackLine("Same words", 0, 4));
Check(2, 2, "Same words");
Check(3.99, 0.01, "Same words");
Check(4, 0, null);

subtitles.Enqueue(new SpeechPlaybackLine("Interrupted", 0));
Check(1, 0.5, "Interrupted");
subtitles.Clear();
caption = null;
Check(2, 0, null);
Console.WriteLine("PASS: captions follow queued and streamed audio across voice speeds, pauses, and interruption.");

sealed class Audio : IAudioOutput
{
    public int SampleRate => 24000;
    public TimeSpan Buffered { get; set; }
    public double PlayedSeconds { get; set; }
    public float Level => 0;
    public void Enqueue(ReadOnlySpan<byte> pcm16Mono) { }
    public void Flush() { }
    public void PlayEarcon(string name) { }
    public void Dispose() { }
}
