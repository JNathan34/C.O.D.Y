using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Voice;

namespace HeyClicky.App.Cody;

// Render fixed game cues with the real voice, then play cached PCM without
// changing the Companion's listening state. No credentials leave Core.Auth.
internal static class CodyGameAudio
{
    private static CancellationTokenSource lifetime;
    private static readonly string[] Allowed = { "Three.", "Two.", "One.", "Rock.", "Paper.", "Scissors." };
    public static void Cancel(AppHost host)
    {
        if(lifetime == null)return;
        lifetime.Cancel();lifetime = null;host.Services.Audio.Flush();
    }
    private static string PathFor(AppHost host,string text) => CodyCachedAudio.CachePath(text,
        host.Real.Core.Settings.Read(s=>s.VoiceIdentifier),host.Real.Core.Settings.Read(s=>s.SpeechSpeed),host.Services.Audio.SampleRate);
    public static async Task<object> Prepare(AppHost host,string move)
    {
        if(!host.Services.Auth.IsSignedIn)throw new InvalidOperationException("Sign in to HeyClicky first.");
        if(move!="Rock."&&move!="Paper."&&move!="Scissors.")throw new ArgumentException("Invalid game move.");
        Cancel(host);var current=lifetime=new CancellationTokenSource(TimeSpan.FromMinutes(10));
        string[] cues={"Three.","Two.","One.",move};
        RealtimeMouth mouth=null;
        try
        {
            foreach(string text in cues)
            {
                current.Token.ThrowIfCancellationRequested();
                string path=PathFor(host,text);
                if(File.Exists(path)&&new FileInfo(path).Length>0)continue;
                if(mouth==null)
                {
                    mouth=new RealtimeMouth(host.Real.Core.Http,(force,ct)=>host.Real.Core.Auth.GetValidAccessTokenAsync(force,ct),
                        host.Services.Audio,()=>new MouthConfig(host.Real.Core.Settings.Read(s=>s.VoiceIdentifier),host.Real.Core.Settings.Read(s=>s.SpeechSpeed),"companion"));
                    if(!await mouth.EnsureOpenAsync(current.Token))throw new InvalidOperationException("HeyClicky voice could not connect.");
                }
                using var timeout=CancellationTokenSource.CreateLinkedTokenSource(current.Token);timeout.CancelAfter(TimeSpan.FromSeconds(30));
                byte[] pcm=await mouth.RenderLineAsync(text,0,timeout.Token);
                current.Token.ThrowIfCancellationRequested();
                if(pcm==null||pcm.Length==0)throw new InvalidOperationException("HeyClicky could not prepare the game voice.");
                CodyCachedAudio.SavePrepared(path,pcm,host.Services.Audio.SampleRate);
            }
            return new {prepared=true};
        }
        finally { if(mouth!=null)await mouth.DisposeAsync(); }
    }
    public static async Task<object> Play(AppHost host,string text,Action cue)
    {
        if(Array.IndexOf(Allowed,text)<0)throw new ArgumentException("Invalid game cue.");
        var token=lifetime?.Token??throw new InvalidOperationException("Prepare the game voice first.");
        byte[] pcm=await File.ReadAllBytesAsync(PathFor(host,text),token);
        token.ThrowIfCancellationRequested();
        host.Services.Audio.PrepareForUpcomingAudio();host.Services.Audio.Enqueue(pcm);cue();
        while(host.Services.Audio.Buffered>TimeSpan.Zero)await Task.Delay(15,token);
        return new {spoken=true};
    }
}
