param([string]$Phrases = 'hey cody|ok cody|okay cody|cody', [switch]$Probe, [string]$TestAudioPath = '')
$ErrorActionPreference = 'Stop'
try {
 Add-Type -AssemblyName System.Speech
 Add-Type -ReferencedAssemblies @('System.Speech','System.Core','System.Web.Extensions') -TypeDefinition @'
using System;
using System.Linq;
using System.Collections.Generic;
using System.Speech.Recognition;
using System.Threading;
using System.Web.Script.Serialization;
public static class CodyWakeListener {
 static readonly object output = new object();
 static SpeechRecognitionEngine engine;
 static Grammar wake, command, common, followup;
 static volatile bool paused = true;
 static bool running;
 static readonly ManualResetEventSlim complete = new ManualResetEventSlim(false);
 static string[] phrases;
 static void Send(object value) { lock(output) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); Console.Out.Flush(); } }
 static GrammarBuilder Prefix() { var b = new GrammarBuilder(); b.Culture=engine.RecognizerInfo.Culture; b.Append(new Choices(phrases)); return b; }
 static void Mode(bool armed) { wake.Enabled=!armed; command.Enabled=!armed; common.Enabled=!armed; followup.Enabled=armed; }
 static void Listen() {
  if(running && !paused)return;
  Mode(false); engine.SetInputToDefaultAudioDevice(); paused=false; running=true;
  engine.RecognizeAsync(RecognizeMode.Multiple); Send(new { type="state", mode="listening" });
 }
 static void Pause() {
  paused=true;
  if(running) { complete.Reset(); engine.RecognizeAsyncCancel(); if(!complete.Wait(1500))throw new TimeoutException("Microphone recognition did not pause."); running=false; }
  engine.SetInputToNull(); Send(new { type="state", mode="paused" });
 }
 static void Result(RecognitionResult result) {
  if(paused || result==null)return;
  var text=result.Text; var count=0;
  if(result.Grammar.Name!="followup") {
   var prefix=phrases.OrderByDescending(p=>p.Length).FirstOrDefault(p=>text.Equals(p,StringComparison.OrdinalIgnoreCase)||text.StartsWith(p+" ",StringComparison.OrdinalIgnoreCase));
   if(prefix==null)return; count=prefix.Split(' ').Length;
  }
  float wakeConfidence=count>0?result.Words.Take(count).Average(w=>w.Confidence):result.Confidence;
  float nameConfidence=count>0?result.Words[count-1].Confidence:result.Confidence;
  Send(new { type="speech", text=text, confidence=result.Confidence, wakeConfidence=wakeConfidence, nameConfidence=nameConfidence, followup=result.Grammar.Name=="followup" });
 }
 public static void Run(string requested, bool probe, string audio) {
  phrases=requested.Split('|').Where(p=>new[]{"hey cody","ok cody","okay cody","cody"}.Contains(p)).Distinct().ToArray();
  if(phrases.Length==0)throw new InvalidOperationException("Choose at least one wake phrase.");
  var recognizer=SpeechRecognitionEngine.InstalledRecognizers().OrderByDescending(r=>r.Culture.Name=="en-GB").FirstOrDefault(r=>r.Culture.TwoLetterISOLanguageName=="en");
  if(recognizer==null)throw new InvalidOperationException("Install an English Windows speech recognition language to use wake phrases.");
  using(engine=new SpeechRecognitionEngine(recognizer)) {
   wake=new Grammar(Prefix()); wake.Name="wake-only"; wake.Priority=2;
   var full=Prefix(); full.AppendDictation(); command=new Grammar(full); command.Name="wake-command";
   var exact=Prefix(); exact.Append(new Choices(new[]{"what is the time","what's the time","what time is it","tell me the time","what is the date","what's the date","what day is it","open firefox","stop","cancel"}));
   common=new Grammar(exact); common.Name="wake-common"; common.Priority=1;
   followup=new DictationGrammar(); followup.Name="followup"; followup.Enabled=false;
   engine.LoadGrammar(wake);engine.LoadGrammar(command);engine.LoadGrammar(common);engine.LoadGrammar(followup);
   engine.EndSilenceTimeout=TimeSpan.FromMilliseconds(650);engine.EndSilenceTimeoutAmbiguous=TimeSpan.FromMilliseconds(950);
   engine.RecognizeCompleted+=(s,e)=>{if(e.Error!=null)Send(new{type="error",message=e.Error.Message});complete.Set();};
   Send(new {type="ready", culture=recognizer.Culture.Name, phrases=phrases});
   if(probe) { Send(new {type="probe",available=true,grammars=engine.Grammars.Count});return; }
   if(!String.IsNullOrEmpty(audio)) {
    engine.SetInputToWaveFile(audio);var r=engine.Recognize(TimeSpan.FromSeconds(15));
    var prefix=r==null?null:phrases.OrderByDescending(p=>p.Length).FirstOrDefault(p=>r.Text.Equals(p,StringComparison.OrdinalIgnoreCase)||r.Text.StartsWith(p+" ",StringComparison.OrdinalIgnoreCase));
    int count=prefix==null?0:prefix.Split(' ').Length;
    Send(new{type="test",text=r==null?null:r.Text,confidence=r==null?0:r.Confidence,wakeConfidence=count==0?0:r.Words.Take(count).Average(w=>w.Confidence),nameConfidence=count==0?0:r.Words[count-1].Confidence,followup=false});return;
   }
   // Partial guesses must never activate the wake indicator. Only extend an
   // already confirmed follow-up while the user is speaking their request.
   engine.SpeechHypothesized+=(s,e)=>{
    if(!paused && followup.Enabled)Send(new{type="activity",followup=true});
   };
   engine.SpeechRecognized+=(s,e)=>Result(e.Result);
   try {
    string instruction;
    while((instruction=Console.ReadLine())!=null) {
     if(instruction=="quit")break;
     if(instruction=="listen")Listen();
     else if(instruction=="pause")Pause();
     else if(instruction=="arm" && running && !paused) { Mode(true);Send(new{type="state",mode="armed"}); }
     else if(instruction=="wake" && running && !paused) { Mode(false);Send(new{type="state",mode="listening"}); }
    }
   } finally { Pause(); }
  }
 }
}
'@
 [CodyWakeListener]::Run($Phrases, $Probe.IsPresent, $TestAudioPath)
} catch {
 $payload = @{ type='error'; message=$_.Exception.Message } | ConvertTo-Json -Compress
 [Console]::Out.WriteLine($payload); [Console]::Out.Flush()
 exit 1
}
