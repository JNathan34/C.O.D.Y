param([Parameter(Mandatory=$true)][string]$InputPath)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Speech
    $job = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($job.action -eq 'status') {
        $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object {
            @{ id = $_.Id; language = $_.Culture.Name; name = $_.Name }
        })
        $result = @{ recognizers = $recognizers }
    } else {
        Add-Type -ReferencedAssemblies @('System.Speech','System.Core') -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Recognition;
using System.Threading;
public static class CodyRecordedSpeech {
    public static string Text = "";
    public static double Confidence;
    public static void Recognize(string file, string language) {
        using (var engine = new SpeechRecognitionEngine(new System.Globalization.CultureInfo(language)))
        using (var completed = new ManualResetEventSlim(false)) {
            var words = new List<string>();
            double confidenceTotal = 0;
            Exception error = null;
            engine.LoadGrammar(new DictationGrammar());
            // Keep free dictation, while also giving common assistant phrases a precise grammar.
            // Priority only resolves identical matches; no forced low-confidence command guessing.
            if (engine.RecognizerInfo.Culture.TwoLetterISOLanguageName == "en") {
                var phrases = new Choices(new string[] {
                    "what's the time", "what is the time", "what time is it", "tell me the time",
                    "what's the date", "what is today's date", "what day is it",
                    "what's the weather", "what is the weather like", "weather near me",
                    "what's playing", "what is playing", "cancel the timer", "stop the alarm"
                });
                var builder = new GrammarBuilder();
                builder.Culture = engine.RecognizerInfo.Culture;
                builder.Append(new Choices("Cody", "hey Cody"), 0, 1);
                builder.Append("please", 0, 1);
                builder.Append(phrases);
                builder.Append("please", 0, 1);
                var commands = new Grammar(builder);
                commands.Name = "CODY common requests";
                commands.Priority = 1;
                engine.LoadGrammar(commands);
            }
            engine.InitialSilenceTimeout = TimeSpan.FromSeconds(30);
            engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(500);
            engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(750);
            engine.SetInputToWaveFile(file);
            engine.SpeechRecognized += (sender, args) => {
                words.Add(args.Result.Text);
                confidenceTotal += args.Result.Confidence;
            };
            engine.RecognizeCompleted += (sender, args) => { error = args.Error; completed.Set(); };
            engine.RecognizeAsync(RecognizeMode.Multiple);
            if (!completed.Wait(45000)) {
                engine.RecognizeAsyncCancel();
                completed.Wait(2000);
                throw new TimeoutException("Windows speech recognition timed out.");
            }
            if (error != null) throw error;
            Text = string.Join(" ", words);
            Confidence = words.Count == 0 ? 0 : confidenceTotal / words.Count;
        }
    }
}
'@
        [CodyRecordedSpeech]::Recognize([string]$job.audioPath, [string]$job.language)
        $result = @{ text = [CodyRecordedSpeech]::Text; confidence = [CodyRecordedSpeech]::Confidence }
    }
    $json = $result | ConvertTo-Json -Depth 5 -Compress
    [System.IO.File]::WriteAllText([string]$job.resultPath, $json, [System.Text.UTF8Encoding]::new($false))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
