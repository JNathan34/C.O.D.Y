using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using SherpaOnnx;

namespace HeyClicky.App.Cody;
internal static class CodyVoiceActivity
{
    private static readonly object gate=new();
    private static VoiceActivityDetector detector;
    private static IMicrophoneCapture microphone;
    private static bool active,speaking;
    private static long lastFrame;
    private static int sampleCount;
    public static float StreamLevel { get; private set; }
    public static bool StreamHeardSpeech { get; private set; }
    public static bool? Speaking { get { lock(gate)return active&&sampleCount>=512&&Environment.TickCount64-lastFrame<1000?speaking:null; } }
    private static VoiceActivityDetector Create(){
        var config=new VadModelConfig();config.SampleRate=16000;config.NumThreads=1;config.Provider="cpu";
        config.SileroVad.Model=Path.Combine(AppContext.BaseDirectory,"BundledResources","wake","silero-vad.onnx");
        config.SileroVad.Threshold=.45f;config.SileroVad.MinSpeechDuration=.15f;config.SileroVad.MinSilenceDuration=.2f;config.SileroVad.WindowSize=512;config.SileroVad.MaxSpeechDuration=90;
        return new VoiceActivityDetector(config,100);
    }
    public static void Begin(IMicrophoneCapture source,bool enabled,bool streamed=false){
        End();if(!enabled)return;
        try{lock(gate){detector??=Create();detector.Reset();sampleCount=0;speaking=false;active=true;if(!streamed){microphone=source;source.Frame+=Frame;}}}
        catch(Exception error){Log.Warn("wake-vad",error.Message);End();}
    }
    public static void End(){lock(gate){active=false;speaking=false;StreamLevel=0;StreamHeardSpeech=false;if(microphone!=null)microphone.Frame-=Frame;microphone=null;detector?.Reset();}}
    private static void Feed(float[] input,int rate){
        float[] samples=input;
        if(rate!=16000){samples=new float[input.Length*16000/rate];for(int i=0;i<samples.Length;i++){double position=(double)i*rate/16000;int at=(int)position;float fraction=(float)(position-at);samples[i]=input[at]+(input[Math.Min(at+1,input.Length-1)]-input[at])*fraction;}}
        detector.AcceptWaveform(samples);sampleCount+=samples.Length;speaking=detector.IsSpeechDetected();lastFrame=Environment.TickCount64;
        // We only need the speech flag, not retained audio segments.
        while(!detector.IsEmpty())detector.Pop();
    }
    private static void Frame(ReadOnlyMemory<byte> frame){lock(gate){
        if(!active||microphone==null)return;
        try{Feed(Decode(frame.Span),microphone.SampleRate);}
        catch(Exception error){active=false;Log.Warn("wake-vad",error.Message);}
    }}
    private static float[] Decode(ReadOnlySpan<byte> bytes){
        var samples=new float[bytes.Length/2];
        for(int i=0;i<samples.Length;i++)samples[i]=(short)(bytes[i*2]|bytes[i*2+1]<<8)/32768f;
        return samples;
    }
    internal static void StreamFrame(ReadOnlySpan<byte> bytes,int rate){
        lock(gate){
            var samples=Decode(bytes);
            double energy=0;
            foreach(float sample in samples)energy+=sample*sample;
            float level=Math.Min((float)Math.Sqrt(energy/samples.Length)*10.2f,1f);
            StreamLevel=Math.Max(level,StreamLevel*.72f);
            if(!active)return;
            try{Feed(samples,rate);StreamHeardSpeech|=speaking;}
            catch(Exception error){active=false;Log.Warn("wake-vad",error.Message);}
        }
    }
    public static int Test(string folder){
        try{
            detector=Create();
            foreach(string file in Directory.GetFiles(folder,"*.wav")){
                detector.Reset();sampleCount=0;var samples=CodyKeywordListener.ReadWave(file,out int rate);bool heard=false;int windows=0;
                for(int i=0;i<samples.Length;i+=rate/50){Feed(samples.Skip(i).Take(rate/50).ToArray(),rate);if(speaking){heard=true;windows++;}}
                for(int i=0;i<100;i++)Feed(new float[rate/50],rate);
                Console.WriteLine(JsonSerializer.Serialize(new{file=Path.GetFileName(file),speech=heard,windows,ended=!speaking}));
            }
            return 0;
        }catch(Exception error){Console.WriteLine(JsonSerializer.Serialize(new{error=error.Message}));return 1;}
        finally{detector?.Dispose();}
    }
}
