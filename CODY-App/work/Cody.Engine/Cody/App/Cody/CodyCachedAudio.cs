using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace HeyClicky.App.Cody;

// Records only fixed C.O.D.Y. confirmations while the original HeyClicky
// voice plays them. Ordinary conversations and microphone audio are not stored.
public sealed class CodyCachedAudio(IAudioOutput inner) : IAudioOutput
{
    public static CodyCachedAudio Current { get; private set; }
    private readonly object gate = new();
    private MemoryStream recording;
    private int recordingId;
    private static readonly HashSet<string> Phrases = new(StringComparer.Ordinal)
    {
        "Volume up.", "Volume down.", "Volume set.",
        "Muted.", "Unmuted.", "Playing.", "Paused.",
        "Next track.", "Previous track.", "Timer set.", "Timer stopped.", "Done.",
        "Your move.", "You win.", "I win.", "It's a draw.",
        "Three, two, one.", "Say rock, paper or scissors.",
        "Three.", "Two.", "One.", "Rock.", "Paper.", "Scissors.",
        "I picked rock. You win.", "I picked rock. I win.", "I picked rock. It's a draw.",
        "I picked paper. You win.", "I picked paper. I win.", "I picked paper. It's a draw.",
        "I picked scissors. You win.", "I picked scissors. I win.", "I picked scissors. It's a draw."
    };
    public static IAudioOutput Wrap(IAudioOutput output) => Current = new CodyCachedAudio(output);
    public int SampleRate => inner.SampleRate;
    public TimeSpan Buffered => inner.Buffered;
    public double PlayedSeconds => inner.PlayedSeconds;
    public float Level => inner.Level;
    public void Enqueue(ReadOnlySpan<byte> pcm)
    {
        lock(gate) { if(recording != null && recording.Length < SampleRate * 2 * 15) recording.Write(pcm); }
        inner.Enqueue(pcm);
    }
    public void Flush() => inner.Flush();
    public void PlayEarcon(string name) => inner.PlayEarcon(name);
    public void PrepareForUpcomingAudio() => inner.PrepareForUpcomingAudio();
    public void Dispose() => inner.Dispose();
    public static string CachePath(string text, string voice, double speed, int sampleRate)
    {
        if(!Phrases.Contains(text)) return null;
        string identity = text + "|" + voice + "|" + speed.ToString("R",System.Globalization.CultureInfo.InvariantCulture) + "|" + sampleRate;
        return Path.Combine(CodyPaths.StateRoot,"voice-cache",Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))) + ".pcm");
    }
    public int BeginRecording() { lock(gate) { recording?.Dispose(); recording = new MemoryStream(); return ++recordingId; } }
    public static void SavePrepared(string path,byte[] pcm,int sampleRate)
    {
        pcm=Current.TrimSilence(pcm);
        if(pcm.Length==0)throw new InvalidDataException("The game voice was silent.");
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllBytes(path+".tmp",pcm);File.Move(path+".tmp",path,true);
    }
    private byte[] TrimSilence(byte[] pcm)
    {
        int count=pcm.Length/2,first=0,last=count-1;
        int Sample(int i) => System.Buffers.Binary.BinaryPrimitives.ReadInt16LittleEndian(pcm.AsSpan(i*2,2));
        while(first<count && Math.Abs(Sample(first))<=64)first++;
        if(first==count)return Array.Empty<byte>();
        while(last>first && Math.Abs(Sample(last))<=64)last--;
        first=Math.Max(0,first-SampleRate/30);last=Math.Min(count-1,last+SampleRate/12);
        return pcm.AsSpan(first*2,(last-first+1)*2).ToArray();
    }
    public void EndRecording(string path, bool completed, int id)
    {
        byte[] pcm;
        lock(gate) { if(id != recordingId) return; pcm=recording?.ToArray(); recording?.Dispose(); recording=null; }
        if(completed && path != null && pcm?.Length > SampleRate / 2)
        {
            pcm = TrimSilence(pcm);
            if(pcm.Length == 0) return;
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path + ".tmp",pcm);
            File.Move(path + ".tmp",path,true);
        }
    }
}
