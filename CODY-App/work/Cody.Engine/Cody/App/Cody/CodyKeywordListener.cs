using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using HeyClicky.Platform.Audio;
using SherpaOnnx;

namespace HeyClicky.App.Cody;

// Runs before WinUI startup in its own process. Standby audio stays in memory.
internal static class CodyKeywordListener
{
    private static readonly object gate=new(),output=new();
    private static readonly Queue<byte[]> prefix=new();
    private static bool listening,detected;
    private static KeywordSpotter longWords,nameOnly;
    private static OnlineStream longStream,nameStream;
    private static int epoch;
    private static readonly ManualResetEventSlim firstFrame=new(false);
    private static string selected;
    private static void Send(object value){lock(output){Console.WriteLine(JsonSerializer.Serialize(value));Console.Out.Flush();}}
    private static KeywordSpotter Create(string keywords,int blanks,float score){
        string dir=Path.Combine(AppContext.BaseDirectory,"BundledResources","wake");
        var c=new KeywordSpotterConfig();
        c.FeatConfig.SampleRate=16000;c.FeatConfig.FeatureDim=80;
        c.ModelConfig.Transducer.Encoder=Path.Combine(dir,"encoder.onnx");
        c.ModelConfig.Transducer.Decoder=Path.Combine(dir,"decoder.onnx");
        c.ModelConfig.Transducer.Joiner=Path.Combine(dir,"joiner.onnx");
        c.ModelConfig.Tokens=Path.Combine(dir,"tokens.txt");c.ModelConfig.NumThreads=1;c.ModelConfig.Provider="cpu";
        c.NumTrailingBlanks=blanks;c.KeywordsScore=score;c.KeywordsThreshold=blanks>1?.3f:.25f;
        c.KeywordsBuf=keywords;c.KeywordsBufSize=Encoding.UTF8.GetByteCount(keywords);
        return new KeywordSpotter(c);
    }
    private static void Reset(){longStream?.Dispose();nameStream?.Dispose();longStream=longWords?.CreateStream();nameStream=nameOnly?.CreateStream();detected=false;prefix.Clear();}
    private static string Decode(KeywordSpotter detector,OnlineStream stream,int rate,float[] samples){
        if(detector==null)return null;
        stream.AcceptWaveform(rate,samples);
        while(detector.IsReady(stream)){detector.Decode(stream);var result=detector.GetResult(stream);if(!string.IsNullOrEmpty(result.Keyword))return result.Keyword;}
        return null;
    }
    private static void Frame(ReadOnlyMemory<byte> input){
        lock(gate){
            if(!listening)return;
            firstFrame.Set();var data=input.ToArray();prefix.Enqueue(data);while(prefix.Count>75)prefix.Dequeue();
            if(detected)return;
            float[] samples=new float[data.Length/2];for(int i=0;i<samples.Length;i++)samples[i]=(short)(data[i*2]|data[i*2+1]<<8)/32768f;
            string found=Decode(longWords,longStream,24000,samples)??Decode(nameOnly,nameStream,24000,samples);
            if(found==null)return;
            detected=true;Send(new{type="wake",phrase=found.Replace('_',' ').ToLowerInvariant(),epoch});
        }
    }
    internal static float[] ReadWave(string path,out int rate){
        using var r=new BinaryReader(File.OpenRead(path));
        if(new string(r.ReadChars(4))!="RIFF")throw new InvalidDataException("Expected PCM WAV");r.ReadInt32();r.ReadChars(4);rate=0;short channels=0,bits=0;byte[] data=null;
        while(r.BaseStream.Position+8<=r.BaseStream.Length){string id=new(r.ReadChars(4));int size=r.ReadInt32();if(size<0||size>r.BaseStream.Length-r.BaseStream.Position)break;long next=r.BaseStream.Position+size+(size&1);
            if(id=="fmt "){short format=r.ReadInt16();channels=r.ReadInt16();rate=r.ReadInt32();r.ReadInt32();r.ReadInt16();bits=r.ReadInt16();if(format!=1)throw new InvalidDataException("Expected PCM WAV");}
            else if(id=="data")data=r.ReadBytes(size);r.BaseStream.Position=next;}
        if(data==null||channels!=1||bits!=16||rate==0)throw new InvalidDataException("Expected mono 16-bit WAV");
        float[] samples=new float[data.Length/2];for(int i=0;i<samples.Length;i++)samples[i]=(short)(data[2*i]|data[2*i+1]<<8)/32768f;return samples;
    }
    public static int Run(string[] args){
        try{
            string Arg(string key,string fallback=""){int i=Array.IndexOf(args,key);return i>=0&&i+1<args.Length?args[i+1]:fallback;}
            selected=Arg("--phrases","hey cody|ok cody|okay cody|cody");var words=selected.Split('|');string keywords="";
            if(words.Contains("hey cody"))keywords+="HH EY1 K OW1 D IY0 @HEY_CODY\n";
            if(words.Contains("ok cody"))keywords+="OW1 K EY1 K OW1 D IY0 @OK_CODY\n";
            if(words.Contains("okay cody"))keywords+="OW2 K EY1 K OW1 D IY0 @OKAY_CODY\n";
            if(keywords.Length>0)longWords=Create(keywords,1,1.5f);
            // The shorter name needs a longer phone boundary to reject 'coding'.
            if(words.Contains("cody"))nameOnly=Create("K OW1 D IY0 @CODY\n",3,1f);
            if(longWords==null&&nameOnly==null)throw new ArgumentException("Choose a wake phrase.");
            Reset();string folder=Arg("--test-folder");
            if(folder.Length>0){foreach(string file in Directory.GetFiles(folder,"*.wav")){
                Reset();var samples=ReadWave(file,out int rate);int length=samples.Length;Array.Resize(ref samples,length+rate);
                string found=null;int step=rate/50;
                for(int i=0;i<samples.Length;i+=step){var part=samples.Skip(i).Take(step).ToArray();found=Decode(longWords,longStream,rate,part)??Decode(nameOnly,nameStream,rate,part);if(found!=null)break;}
                Send(new{type="test",file=Path.GetFileName(file),phrase=found});
            }return 0;}
            using var microphone=new WasapiMicrophoneCapture();microphone.Frame+=Frame;
            microphone.DeviceProvedDead+=message=>Send(new{type="error",message="Wake microphone became unavailable: "+message});
            Send(new{type="ready",detector="keyword",sampleRate=24000});
            string line;while((line=Console.ReadLine())!=null){
                using var command=JsonDocument.Parse(line);string mode=command.RootElement.GetProperty("mode").GetString();int requestedEpoch=command.RootElement.GetProperty("epoch").GetInt32();
                if(mode=="quit")break;
                if(mode=="listen"){
                    lock(gate){epoch=requestedEpoch;listening=false;Reset();firstFrame.Reset();}microphone.Start();lock(gate)listening=true;
                    if(!firstFrame.Wait(3000))throw new InvalidOperationException("The wake microphone is not delivering audio. Check Windows microphone access and the default recording device.");
                    Send(new{type="state",mode="listening",epoch=requestedEpoch});
                }else if(mode=="pause"){
                    microphone.Stop();string audio;
                    lock(gate){audio=detected?Convert.ToBase64String(prefix.SelectMany(x=>x).ToArray()):null;epoch=requestedEpoch;listening=false;prefix.Clear();}
                    Send(new{type="state",mode="paused",epoch=requestedEpoch,audioPrefix=audio});
                }
            }
            lock(gate)listening=false;microphone.Stop();return 0;
        }catch(Exception error){Send(new{type="error",message=error.Message});return 1;}
        finally{longStream?.Dispose();nameStream?.Dispose();longWords?.Dispose();nameOnly?.Dispose();}
    }
}
