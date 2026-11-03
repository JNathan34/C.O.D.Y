using System;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Voice;
using Microsoft.UI.Dispatching;

namespace HeyClicky.App.Cody;

// Local, same-Windows-user IPC. Account credentials stay inside the original engine.
public static class CodyEngineBridge
{
    public static bool EngineMode => Program.Args.Contains("--cody-engine");
    public static bool AutomaticUpdatesEnabled => false;
    public static bool IsRunning { get; private set; }
    internal static bool MicrophoneMuted { get; private set; }
    internal static readonly CodyConsent Consent=new();
    private static AppHost host;
    private static CodyEscapeTakeBack escapeCancellation;
    private static CodyDictationShortcuts dictationShortcuts;
    private static volatile bool escapeWork;
    internal static bool EscapeCancellationAvailable=>escapeCancellation!=null;
    internal static void CancelCurrent(){
        CodyIndependentInput.End();
        string target=CodyJobReports.CancellationTarget(host,host.ClickyDrive?.CodyOwningThread,turn,host.ClickyDrive?.ClaimsEscape!=true&&host.Services.Companion.State==VoiceState.Idle);
        if(target!=null)_=StopTask(target);
        host.ClickyDrive?.HandleEscape();
        CodyProofread.Cancel();StopSpeech();host.Services.Companion.Cancel();
        Emit("operation-cancelled",new{taskId=target,turn});
        escapeWork=false;
    }
    private static async Task StopTask(string task){try{await host.Real.Agents.StopAsync(task);}catch(Exception error){Log.Warn("cody-cancel","Could not stop task: "+error.Message);Emit("failure",new{Code="task_stop_failed",Message="Cody could not confirm that the task stopped. Use its Stop button.",turn});}}

    private static StreamWriter output;
    private static readonly SemaphoreSlim writes = new(1, 1);
    private static string turn = "";
    private static CancellationTokenSource speechCancellation;
    private static bool customSpeech;
    private static bool cachedSpeaking;
    private static int cachedPlaybacks;
    private static bool zoomFixture;
    private static bool voiceEnding;
    private static bool voiceControlStopped;
    private static bool utilityOnly;
    private static string lastTranscript;
    private static string routedUtility;
    private static TaskCompletionSource<bool> utilityDecision;
    private static DispatcherQueueTimer meter;
    private static string RecognitionLanguage="en";
    private static string RecognitionLanguagePath => Path.Combine(CodyPaths.StateRoot,"recognition-language.txt");

    private static void ConfigureRecognition(string language,bool save)
    {
        if(language!="en"&&language!="multi")throw new ArgumentException("Choose English or Automatic recognition.");
        RecognitionLanguage=language;
        host.Real.Core.Settings.Update(settings=>{
            settings.DictationLanguageCode=language;settings.DictationSpecificLanguageCode="en";
            settings.DictationCustomWords??=new System.Collections.Generic.List<string>();
            foreach(string word in new[]{"CPU","GPU","RAM","Wi-Fi","Plezy","C.O.D.Y.","Derby","weather"})
                if(settings.DictationCustomWords.Count<100&&!settings.DictationCustomWords.Contains(word,StringComparer.OrdinalIgnoreCase))settings.DictationCustomWords.Add(word);
        });
        if(save)File.WriteAllText(RecognitionLanguagePath,language);
    }

    public static void Start(AppHost app)
    {
        if (!EngineMode || IsRunning) return;
        host = app;
        MicrophoneMuted=File.Exists(Path.Combine(CodyPaths.StateRoot,"microphone-muted"));
        if(Program.Args.Contains("--verify-control-handoff")){
            string report=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../reports/control-handoff-live.txt"));
            try{
                using var writer=new StringWriter();var previous=Console.Out;Console.SetOut(writer);
                try{var fixture=System.Reflection.Assembly.LoadFrom(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../tools/control-handoff-tests/bin/Debug/net9.0-windows10.0.22621.0/ControlHandoffTests.dll")));fixture.EntryPoint.Invoke(null,new object[]{new[]{"--firefox"}});}
                finally{Console.SetOut(previous);File.WriteAllText(report,writer.ToString());}
            }catch(Exception error){File.AppendAllText(report,"FAIL: "+error.GetBaseException());}
        }
        CodyPermissions.Load(Path.Combine(CodyPaths.StateRoot,"permissions.json"));Consent.Policy=CodyPermissions.Decision;
        string language=File.Exists(RecognitionLanguagePath)?File.ReadAllText(RecognitionLanguagePath).Trim():"en";
        ConfigureRecognition(language=="multi"?"multi":"en",false);
        IsRunning = true;
        CodyProofread.Start();
        CodyDriveVisuals.Start(host.DispatcherQueue);
        CodyModelZoom.Start(host.Real.Canvas);
        CodyJobReports.Bind(host,()=>turn);
        try{escapeCancellation=new CodyEscapeTakeBack(()=>{CodyIndependentInput.End();host.DispatcherQueue.TryEnqueue(CancelCurrent);},()=>escapeWork);}catch(Exception error){Log.Warn("cody-cancel","Esc listener unavailable: "+error.Message);}
        Consent.Changed+=requests=>Emit("computer-approvals",requests);
        host.NotchUi.EnterEngineMode();
        host.Services.Shortcuts.Stop();
        try{dictationShortcuts=new CodyDictationShortcuts(host.Real.Dictation);}catch(Exception error){Log.Warn("cody-dictation",error.Message); }
        var session = host.Services.Companion;
        session.StateChanged += (_, _) => {if(session.State!=VoiceState.Listening)CodyVoiceActivity.End();Emit("phase", new { state = session.State.ToString(), turn });};
        session.UserTranscriptUpdated += (_, text) => { lastTranscript = text; Emit("transcript", new { text, turn }); };
        session.ResponseTextUpdated += (_, text) => Emit("response", new { text, turn });
        session.Failed += (_, error) => Emit("failure", new { error.Code, error.Message, turn });
        meter = host.DispatcherQueue.CreateTimer();
        meter.Interval = TimeSpan.FromMilliseconds(100);
        int consentTicks=0;
        bool? captureUi=null;
        meter.Tick += (_, _) => {
            CodyDrawingControls.Tick(host);
            if(CodyIndependentInput.Active)CodyMouseGuard.Pulse();
            escapeWork=CodyIndependentInput.Active||host.ClickyDrive?.ClaimsEscape==true||session.State!=VoiceState.Idle||host.Real.Agents.Tasks.Any(task=>task.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser);
            bool yielding=HeyClicky.Platform.Win32.ScreenCaptureYield.IsYielding;
            if(captureUi!=yielding){captureUi=yielding;Emit("screen-capture-ui",new{active=yielding});}
            CodyCursorVisuals.Tick(cachedSpeaking?VoiceState.Responding:session.State,session.State==VoiceState.Listening?host.Services.Microphone.Level:host.Services.Audio.Level);
            Emit("meter", new { dictationActive=host.Real.Dictation.IsSessionActive,voiceActive=CodyVoiceActivity.Speaking,level = session.State == VoiceState.Listening ? host.Services.Microphone.Level : host.Services.Audio.Level, state = session.State.ToString() });
            if(++consentTicks%10==0){host.ClickyDriveConsent?.SyncCodyApprovals();Consent.Sweep();CodyBrowserSetup.Tick();}
            if(consentTicks%5==0){CodyJobReports.Tick(host);CodyModelZoom.Refresh();CodyOverlayOrder.Refresh();}
        };
        CodyOverlayOrder.Start(host.DispatcherQueue);
        meter.Start();
        _ = Task.Run(Listen);
        Log.Info("cody-engine", "same-user named pipe ready; C.O.D.Y. owns the visible interface");
    }

    private static async Task Listen()
    {
        while (IsRunning)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(CodyPaths.PipeName, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync();
                using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true);
                using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
                output = writer;
                Emit("connected", new { protocol = 1 });
                string line;
                while ((line = await reader.ReadLineAsync()) != null)
                {
                    if (line.Length > 1048576) throw new InvalidDataException("IPC request exceeds limit");
                    _ = Handle(line);
                }
            }
            catch (Exception error) { Log.Warn("cody-engine", "pipe closed: " + error.GetType().Name); }
            finally { output = null;CodyIndependentInput.End();host.DispatcherQueue.TryEnqueue(()=>host.ClickyDrive?.HandleEscape()); }
        }
    }

    private static async Task Handle(string line)
    {
        string id = "";
        try
        {
            using var document = JsonDocument.Parse(line);
            var request = document.RootElement.Clone();
            id = request.GetProperty("id").GetString() ?? "";
            string command = request.GetProperty("command").GetString() ?? "";
            if(command == "utility-route")
            {
                bool accepted = request.GetProperty("turn").GetString() == turn && utilityDecision?.TrySetResult(request.GetProperty("handled").GetBoolean()) == true;
                await Send(new { id, result = new { accepted } });
                return;
            }
            object result = await OnUi(async () =>
            {
                var session = (CompanionSession)host.Services.Companion;
                string Text(string name, string fallback = "") => request.TryGetProperty(name, out var p) ? p.GetString() ?? fallback : fallback;
                switch (command)
                {
                    case "browser-setup-state":return CodyBrowserSetup.Snapshot();
                    case "browser-setup-choice":return await CodyBrowserSetup.Choose(Text("choice"),Text("targetId"),Text("browser"));
                    case "browser-setup-folder":return CodyBrowserSetup.Folder();
                    case "tasks-state":return CodyJobReports.Snapshot(host);
                    case "task-clear":return CodyJobReports.Clear(host,Text("taskId"));
                    case "tasks-clear-finished":return CodyJobReports.ClearFinished(host);
                    case "task-preview":return CodyJobReports.Preview(host,Text("taskId"));
                    case "task-open-output":return CodyJobReports.OpenOutput(host,Text("taskId"),Text("outputId"));
                    case "task-detail":return CodyJobReports.Detail(host,Text("taskId"));
                    case "task-action":return await CodyJobReports.Act(host,Text("taskId"),Text("action"),Text("text"));
                    case "deployment-state":return new{modules=System.Diagnostics.Process.GetCurrentProcess().Modules.Cast<System.Diagnostics.ProcessModule>().Where(module=>new[]{"coreclr.dll","Microsoft.UI.Xaml.dll","Microsoft.WindowsAppRuntime.dll","hostfxr.dll"}.Contains(module.ModuleName,StringComparer.OrdinalIgnoreCase)).Select(module=>new{name=module.ModuleName,path=module.FileName}).ToArray()};
                    case "deep-link":
                        string link=Text("url");if(link.Length>25000||!Uri.TryCreate(link,UriKind.Absolute,out var uri)||uri.Scheme!="heyclicky")throw new ArgumentException("Invalid sign-in link.");host.HandleForwardedArgs(new[]{link});return new{accepted=true};
                    case "input-routing-checks":return await CodyIndependentInput.CheckRouting(request.TryGetProperty("clickSearch",out var clickSearch)&&clickSearch.GetBoolean());
                    case "input-target-diagnostics":return CodyIndependentInput.Diagnose();
                    case "control-overlay-order":return CodyOverlayOrder.Register((uint)request.GetProperty("clientPid").GetInt32(),request.GetProperty("handles").EnumerateArray().Select(h=>h.GetString()).ToArray(),Text("islandHandle"));
                    case "control-overlay-order-state":return CodyOverlayOrder.Snapshot();
                    case "control-overlay-order-contender":return CodyOverlayOrder.TestContender(request.GetProperty("show").GetBoolean());
                    case "drive-state": return CodyDriveVisuals.Snapshot();
                    case "independent-input-probe":return await CodyIndependentInput.Probe(Text("handle"),request.GetProperty("x").GetDouble(),request.GetProperty("y").GetDouble(),Text("text"),Text("gesture","click"),Text("key"),request.TryGetProperty("systemInput",out var probeSystem)&&probeSystem.GetBoolean());
                    case "control-fixtures-create":return CodyControlFixtures.Create();
                    case "control-fixtures-focus":return CodyControlFixtures.Focus(Text("family"));
                    case "control-fixtures-state":return CodyControlFixtures.State();
                    case "control-fixtures-restore":return CodyControlFixtures.RestoreNative();
                    case "control-fixtures-close":CodyControlFixtures.Close();return new{closed=true};
                    case "permissions-state":return PermissionState();
                    case "plugins-list":return await CodyPlugins.List(host);
                    case "agents-state":return CodyAgents.State(host);
                    case "heyclicky-usage":return await CodyAgents.Usage(host);
                    case "agents-configure":return CodyAgents.Configure(host,request);
                    case "agents-privacy":return CodyAgents.OpenPrivacy(host,Text("capability"));
                    case "plugins-action":return await CodyPlugins.Act(host,Text("pluginId"),Text("action"),Text("accountId"));
                    case "plugins-add":return CodyPlugins.Add(host,Text("name"),Text("url"),Text("apiKey"));
                    case "model-zoom-state":return await CodyModelZoom.Snapshot();
                    case "model-drag-state":return await CodyModelDrag.Snapshot();
                    case "model-drag-test":if(!zoomFixture&&!CodyModelDrag.Active)throw new InvalidOperationException("Create the local model fixture first.");return new{accepted=CodyModelZoom.DragForTest(Text("action"),request.GetProperty("x").GetInt32(),request.GetProperty("y").GetInt32(),request.TryGetProperty("ctrl",out var ctrl)&&ctrl.ValueKind==JsonValueKind.True)};
                    case "drawing-controls-state":return await CodyDrawingControls.Snapshot(host);
                    case "drawing-controls-test-close":if(!zoomFixture)throw new InvalidOperationException("Create the local model fixture first.");CodyDrawingControls.CloseForTest(host);return new{closed=true};
                    case "drawing-controls-test-screen-change":if(!zoomFixture)throw new InvalidOperationException("Create the local drawing fixture first.");var changeReason=Text("reason");if(changeReason is not ("click" or "app switch" or "space change" or "scroll"))throw new InvalidOperationException("Unsupported test reason.");CodyDrawingControls.ScreenChangeForTest(host,changeReason);return new{changed=true};
                    case "drawing-controls-test-finish":if(!zoomFixture)throw new InvalidOperationException("Create the local drawing fixture first.");host.Real.Canvas.Finish();host.Real.Canvas.IsStreamingNarration=false;return new{finished=true};
                    case "drawing-controls-test-card":
                    case "drawing-controls-test-empty":
                        if(host.Real.Canvas.IsShowingDrawing&&!zoomFixture)throw new InvalidOperationException("Keep the existing drawing; this check requires an empty canvas.");
                        var emptyCaptures=await host.Real.Capture.CaptureAllAsync();
                        host.Real.Canvas.BeginProgram(emptyCaptures.First(),host.Services.Settings.CursorColorHex);
                        host.Real.Canvas.IsStreamingNarration=true;
                        bool testCard=command=="drawing-controls-test-card";
                        var testDrawingFeed=host.Real.Canvas.Feed(testCard?"say('A test drawing.');paper(160,120,460,380,{title:'Drawing control test',board:'plain'});ring(220,220,100,100);say('Done.');":"say('No drawing in this response.');",false);
                        for(int testLine=0;testLine<Math.Max(1,testDrawingFeed.Lines.Count);testLine++)host.Real.Canvas.ReleaseLine(testLine);
                        zoomFixture=true;return new{created=true,empty=!testCard};
                    case "model-zoom-test":return new{accepted=CodyModelZoom.WheelForTest(Text("handle"),request.GetProperty("delta").GetInt32())};
                    case "model-zoom-point-test":return new{accepted=CodyModelZoom.WheelAtPointForTest(request.GetProperty("x").GetInt32(),request.GetProperty("y").GetInt32(),request.GetProperty("delta").GetInt32())};
                    case "model-zoom-image":return new{png=Convert.ToBase64String(host.Real.Canvas.RenderDrawingPng(overScreenshot:false)??Array.Empty<byte>())};
                    case "model-zoom-demo":
                        if(host.Real.Canvas.IsShowing&&host.Real.Canvas.InkedMarkCount>0)throw new InvalidOperationException("Keep the existing drawing; zoom verification requires an empty canvas.");
                        var captures=await host.Real.Capture.CaptureAllAsync();var capture=captures.First();host.Real.Canvas.BeginProgram(capture,host.Services.Settings.CursorColorHex);
                        bool streaming=request.TryGetProperty("streaming",out var streamingValue)&&streamingValue.ValueKind==JsonValueKind.True;host.Real.Canvas.IsStreamingNarration=streaming;
                        var feed=host.Real.Canvas.Feed((streaming?"say('Generating the model.');paper(160,120,460,380,{title:'3D generation',board:'plain'});":"")+"scene3d(180,140,420,340,s=>{s.box({w:1.7,h:1.2,d:1.1});s.camera({spin:0});});"+(streaming?"say('Adding more detail.');":""),!streaming);
                        for(int i=0;i<Math.Max(1,feed.Lines.Count);i++)host.Real.Canvas.ReleaseLine(i);if(!streaming)host.Real.Canvas.Finish();zoomFixture=true;return new{created=true,lines=feed.Lines.Count};
                    case "model-zoom-demo-clear":if(zoomFixture){host.Real.Canvas.Clear(false);host.Real.Canvas.IsStreamingNarration=false;zoomFixture=false;}return new{cleared=true};
                    case "permissions-configure":
                        bool? readAppsValue=request.TryGetProperty("readApps",out var readApps)?readApps.GetBoolean():null,extraUsageValue=request.TryGetProperty("extraUsage",out var extraUsage)?extraUsage.GetBoolean():null;
                        string folderValue=null;if(request.TryGetProperty("workingFolder",out var folder)){folderValue=folder.GetString();if(string.IsNullOrWhiteSpace(folderValue)||!Path.IsPathFullyQualified(folderValue)||!Directory.Exists(folderValue))throw new ArgumentException("Choose an existing working folder.");folderValue=Path.GetFullPath(folderValue);}
                        var policy=CodyPermissions.Configure(request.TryGetProperty("enabled",out var enabled)?enabled.GetBoolean():null,request.TryGetProperty("level",out var level)?level.GetString():null,request.TryGetProperty("computerUse",out var computerUse)?computerUse.GetBoolean():null,request.TryGetProperty("backgroundTasks",out var backgroundTasks)?backgroundTasks.GetBoolean():null);
                        host.Real.Core.Settings.Update(s=>{
                            if(readAppsValue.HasValue)s.OneBrainReadsApps=readAppsValue.Value;
                            if(extraUsageValue.HasValue)s.AgentAutoApproveExtraUsage=extraUsageValue.Value;
                            if(folderValue!=null)s.AgentFolderPath=folderValue;
                        });
                        if(!policy.enabled||policy.level=="custom"&&!policy.computerUse)host.ClickyDrive?.HandleEscape();Consent.ApplyPolicy();Emit("permissions-changed",PermissionState());return PermissionState();
                    case "permissions-probe":
                        var probe=new CodyConsent{Policy=CodyPermissions.Decision};bool? approved=null;string key=Text("kind")=="agent"?"job:permission-probe":"takeover-card";
                        probe.Request(key,"Permission routing check","No computer action is performed",answer=>approved=answer);
                        return new{decided=approved.HasValue,allowed=approved,pending=probe.Snapshot().Length,context=CodyPermissions.Context};
                    case "cursor-style-status":return new{presentation="cody",originalOverlayCreated=host.Real.Cursor.Inner!=null};
                    case "quiet-control-state":return new{instructions=CodyCommunication.Instructions,driveFact=CodyCommunication.DriveFact("Complete the quiz quickly.",null),waitsForNarration=CodyCommunication.WaitForActionNarration(EngineMode)};
                    case "identity-state":return new{displayName="C.O.D.Y.",spokenName="Cody",promptPath=CodyIdentity.PromptPath,instructions=CodyIdentity.Prompt,routingInstructions=CodyActionRouting.Instructions,communicationInstructions=CodyCommunication.Instructions,speechExample=CodyIdentity.ForSpeech("C.O.D.Y. is ready."),backgroundInstructions=File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"BundledResources","clicky-model-instructions.md"))};
                    case "text-client": CodyProofread.Client(request.GetProperty("clientPid").GetInt32());return new{registered=true};
                    case "text-capture":return new{target=await CodyProofread.Capture(request.GetProperty("clientPid").GetInt32())};
                    case "proofread":return await CodyProofread.Run(host,Text("target"));
                    case "drive-stop": CancelCurrent();return new {stopped=true};
                    case "approval-state":
                        host.ClickyDriveConsent?.SyncCodyApprovals();Consent.Sweep();return Consent.Snapshot();
                    case "approval-decision":
                        Consent.Decide(Text("approvalId"),Text("decision"));return new { answered=true };
                    case "status":
                        return new { engineDirectory=AppContext.BaseDirectory,processId=Environment.ProcessId,dataDirectory=AppPaths.Root,stateDirectory=CodyPaths.StateRoot,recognitionLanguage = RecognitionLanguage, automaticUpdatesEnabled = AutomaticUpdatesEnabled, signedIn = host.Services.Auth.IsSignedIn, state = cachedSpeaking ? "Responding" : session.State.ToString(), cachedPlaybacks, customSpeech, voice = host.Real.Core.Settings.Read(s => s.VoiceIdentifier), speed = host.Real.Core.Settings.Read(s => s.SpeechSpeed), voiceReplies = host.Services.Settings.LibraryModeEnabled, audioPlaybackStarts = session.AudioPlaybackBeganCount };
                    case "submit":
                        StopSpeech();
                        if (!host.Services.Auth.IsSignedIn) throw new InvalidOperationException("Sign in to HeyClicky first.");
                        if (session.State != VoiceState.Idle) throw new InvalidOperationException("A native turn is already active.");
                        string text = Text("text").Trim();
                        if (text.Length == 0 || text.Length > 25000) throw new ArgumentException("Enter a message under 25,000 characters.");
                        turn = Text("turn", id);
                        bool speak = request.TryGetProperty("speak", out var speakValue) ? speakValue.GetBoolean() : host.Services.Settings.LibraryModeEnabled;
                        await CodyAttachments.Submit(host,session,text,speak,CodyAttachments.Paths(request));
                        return new { text = session.ResponseText, audioPlaybackStarts = session.AudioPlaybackBeganCount };
                    case "speak":
                        turn = Text("turn", id);
                        return await SpeakFast(Text("text"));
                    case "plezy-play":
                        return await CodyPlezy.Play(Text("title"));
                    case "game-prepare":
                        StopSpeech();
                        return await CodyGameAudio.Prepare(host,Text("move"));
                    case "game-play":
                        string cueText=Text("text");
                        return await CodyGameAudio.Play(host,cueText,()=>Emit("game-cue",new {text=cueText,turn}));
                    case "microphone-mute":
                        bool microphoneMuted=request.GetProperty("muted").GetBoolean();
                        string muteFile=Path.Combine(CodyPaths.StateRoot,"microphone-muted");
                        if(microphoneMuted)File.WriteAllText(muteFile,"muted");else if(File.Exists(muteFile))File.Delete(muteFile);
                        MicrophoneMuted=microphoneMuted;
                        if(microphoneMuted){
                            host.Real.Dictation.CancelActiveSession();
                            if(session.State==VoiceState.Listening)session.Cancel();
                            CodyVoiceActivity.End();
                        }
                        return new { muted=MicrophoneMuted };
                    case "begin":
                        if(MicrophoneMuted)throw new InvalidOperationException("C.O.D.Y. microphone is muted. Press Ctrl + Alt + M to unmute.");
                        StopSpeech(request.TryGetProperty("gameDuplex", out var duplex) && duplex.GetBoolean());
                        string textTarget=request.TryGetProperty("captureText",out var captureText)&&captureText.GetBoolean()?await CodyProofread.Capture(request.GetProperty("clientPid").GetInt32()):null;
                        turn = Text("turn", id);
                        utilityOnly = request.TryGetProperty("utilityOnly", out var onlyUtility) && onlyUtility.GetBoolean();
                        lastTranscript = routedUtility = null;
                        byte[] audioPrefix=Array.Empty<byte>();
                        if(request.TryGetProperty("audioPrefix",out var prefixAudio)){
                            string encoded=prefixAudio.GetString();if(encoded==null||encoded.Length>128000)throw new ArgumentException("Invalid wake audio prefix.");
                            audioPrefix=Convert.FromBase64String(encoded);if(audioPrefix.Length%2!=0)throw new ArgumentException("Invalid wake audio samples.");
                        }
                        if(MicrophoneMuted)throw new InvalidOperationException("C.O.D.Y. microphone is muted. Press Ctrl + Alt + M to unmute.");
                        CodyVoiceActivity.Begin(host.Services.Microphone,request.TryGetProperty("wake",out var wakeCapture)&&wakeCapture.GetBoolean());
                        await ((CompanionSession)session).BeginPushToTalkWithPrefixAsync(audioPrefix);
                        if(MicrophoneMuted){session.Cancel();CodyVoiceActivity.End();return new { listening=false,textTarget };}
                        return new { listening = session.State == VoiceState.Listening, textTarget };
                    case "end":
                        voiceEnding = true; routedUtility = null;voiceControlStopped=false;
                        try { await session.EndPushToTalkAsync(); }
                        catch(OperationCanceledException) when(routedUtility != null||voiceControlStopped) { }
                        finally { voiceEnding = false; }
                        return new { text = session.ResponseText, utilityText = routedUtility, transcript = lastTranscript,controlStopped=voiceControlStopped };
                    case "cancel": CodyIndependentInput.End();host.ClickyDrive?.HandleEscape();CodyProofread.Cancel();StopSpeech(); session.Cancel(); return new { cancelled = true };
                    case "fresh": session.StartFreshSession(); return new { fresh = true };
                    case "clear": host.Real.Canvas.Clear(); return new { cleared = true };
                    case "audio-state": return JsonSerializer.Deserialize<JsonElement>(NativeAudioControl.State());
                    case "audio-set":
                        NativeAudioControl.SetVolume(Math.Clamp(request.GetProperty("level").GetInt32(), 0, 100));
                        return JsonSerializer.Deserialize<JsonElement>(NativeAudioControl.State());
                    case "audio-mute":
                        NativeAudioControl.SetMute(request.GetProperty("muted").GetBoolean());
                        return JsonSerializer.Deserialize<JsonElement>(NativeAudioControl.State());
                    case "configure":
                        if(request.TryGetProperty("systemInput",out var systemInputSetting))CodyIndependentInput.SystemInputEnabled=systemInputSetting.GetBoolean();
                        if(request.TryGetProperty("screenHighlight",out var highlightSetting))host.Services.Settings.ScreenHighlightEnabled=highlightSetting.GetBoolean();
                        if(request.TryGetProperty("cursorColor",out var cursorColorSetting)){
                            string color=cursorColorSetting.GetString()??"";
                            if(System.Text.RegularExpressions.Regex.IsMatch(color,"^#[0-9a-fA-F]{6}$")){CodySystemCursor.Color(color);host.Real.Core.Settings.Update(s=>s.CursorColorHex=color);}
                        }
                        if(request.TryGetProperty("recognitionLanguage",out var recognition))ConfigureRecognition(recognition.GetString(),true);
                        host.Real.Core.Settings.Update(s =>
                        {
                            if (request.TryGetProperty("speak", out var speakSetting)) s.TypedTurnsRespondWithVoice = speakSetting.GetBoolean();
                            if (request.TryGetProperty("speed", out var speed)) s.SpeechSpeed = Math.Clamp(speed.GetDouble(), .7, 1.4);
                            if (request.TryGetProperty("voice", out var voice))
                            {
                                string value = voice.GetString();
                                if (new[] { "cedar", "marin", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse" }.Contains(value)) s.VoiceIdentifier = value;
                            }
                        });
                        return new { configured = true };
                    case "wake-cue":host.Services.Audio.PlayEarcon("textOpen");return new{played=true};
                    case "dictation-shortcuts":return new{installed=dictationShortcuts?.Installed==true,hold="Ctrl + Win",handsFree="Ctrl + Win, pressed twice",cancel="Esc",recording=host.Real.Dictation.IsCapturingAudio};
                    case "cursor-preferences":return new{controlInputMode=CodyIndependentInput.SystemInputEnabled?"system":"independent",screenHighlight=host.Services.Settings.ScreenHighlightEnabled,cursorColor=host.Real.Core.Settings.Read(s=>s.CursorColorHex),highlightActive=host.Real.Highlight.IsEnabled};
                    case "signOut": await host.Real.Agents.SignOutAsync(); await host.Services.Auth.SignOutAsync(); return new { signedIn = false };
                    case "signIn": host.SignIn(); return new { started = true };
                    case "quit": CodyOverlayOrder.Stop();CodyIndependentInput.End();CodyTaskLibrary.Flush();host.Quit(); return new { stopping = true };
                    default: throw new ArgumentException("Unknown engine command.");
                }
            });
            await Send(new { id, result });
        }
        catch (Exception error) { await Send(new { id, error = error.Message }); }
    }

    private static object PermissionState()=>host.Real.Core.Settings.Read(s=>new{enabled=CodyPermissions.Enabled,level=CodyPermissions.Current.level,computerUse=CodyPermissions.Current.computerUse,backgroundTasks=CodyPermissions.Current.backgroundTasks,readApps=s.OneBrainReadsApps,extraUsage=s.AgentAutoApproveExtraUsage,workingFolder=s.AgentFolderPath});
    public static System.Text.Json.Nodes.JsonObject RouteVoiceUtility()
    {
        if(!IsRunning || !voiceEnding || string.IsNullOrWhiteSpace(lastTranscript)) return null;
        if(CodyControlCommands.IsStop(lastTranscript)){
            voiceControlStopped=true;CodyIndependentInput.End();host.DispatcherQueue.TryEnqueue(()=>host.ClickyDrive?.HandleEscape());
            ((CompanionSession)host.Services.Companion).InterruptForDrive();return null;
        }
        var decision = utilityDecision = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        string text = lastTranscript;
        Emit("classify-utility", new { text, turn });
        try
        {
            if(utilityOnly || (decision.Task.Wait(500) && decision.Task.Result))
            {
                routedUtility = text;
                ((CompanionSession)host.Services.Companion).InterruptForDrive();
                Log.Info("cody-speed", "voice utility routed locally before AI request");
            }
        }
        finally { utilityDecision = null; }
        return null;
    }

    private static void StopSpeech(bool keepGame = false)
    {
        if(!keepGame)CodyGameAudio.Cancel(host);
        speechCancellation?.Cancel();
        if(customSpeech)
        {
            ((CompanionSession)host.Services.Companion).InterruptForDrive();
            host.Services.Audio.Flush();
            customSpeech = cachedSpeaking = false;
            Emit("phase", new { state = "Idle", turn });
        }
    }

    private static async Task<object> SpeakFast(string text)
    {
        text=CodyIdentity.ForSpeech(text);
        StopSpeech();
        if(!host.Services.Auth.IsSignedIn) return new { spoken = false, cached = false };
        var cancellation = speechCancellation = new CancellationTokenSource();
        var token = cancellation.Token;
        customSpeech = true;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var session = (CompanionSession)host.Services.Companion;
        string voice = host.Real.Core.Settings.Read(s => s.VoiceIdentifier);
        double speed = host.Real.Core.Settings.Read(s => s.SpeechSpeed);
        string path = CodyCachedAudio.CachePath(text, voice, speed, host.Services.Audio.SampleRate);
        bool hit = path != null && File.Exists(path) && new FileInfo(path).Length > host.Services.Audio.SampleRate / 2 && new FileInfo(path).Length <= host.Services.Audio.SampleRate * 2 * 15;
        int recording = 0;
        bool spoken = false;
        try
        {
            if(hit)
            {
                byte[] pcm = await File.ReadAllBytesAsync(path, token);
                token.ThrowIfCancellationRequested();
                host.Services.Audio.PrepareForUpcomingAudio();
                host.Services.Audio.Enqueue(pcm);
                cachedSpeaking = true; cachedPlaybacks++;
                Emit("phase", new { state = "Responding", turn });
                Log.Info("cody-speed", $"cached confirmation queued in {clock.ElapsedMilliseconds} ms ({pcm.Length} bytes)");
                while(host.Services.Audio.Buffered > TimeSpan.Zero) await Task.Delay(15, token);
                spoken = true;
            }
            else
            {
                if(path != null) recording = CodyCachedAudio.Current.BeginRecording();
                spoken = await session.AnnounceAsync(text, showAtCursor: false, ct: token);
            }
            return new { spoken, cached = hit, elapsedMs = clock.ElapsedMilliseconds };
        }
        finally
        {
            if(recording != 0) CodyCachedAudio.Current.EndRecording(path, spoken && !token.IsCancellationRequested, recording);
            if(ReferenceEquals(speechCancellation,cancellation))
            {
                customSpeech = cachedSpeaking = false;
                speechCancellation = null;
                Emit("phase", new { state = "Idle", turn });
            }
        }
    }

    private static Task<object> OnUi(Func<Task<object>> action)
    {
        var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!host.DispatcherQueue.TryEnqueue(async () =>
        {
            try { completion.TrySetResult(await action()); }
            catch (Exception error) { completion.TrySetException(error); }
        })) completion.TrySetException(new InvalidOperationException("Engine UI dispatcher is stopping."));
        return completion.Task;
    }

    internal static void PublishDrive(object data)=>Emit("computer-control",data);
    internal static void PublishJobReport(object data)=>Emit("job-report",data);
    internal static void PublishTasks(object data)=>Emit("background-tasks",data);
    internal static void PublishBrowserSetup(object data)=>Emit("browser-setup",data);
    internal static void PublishCursor(object data)=>Emit("cursor-state",data);
    internal static void PublishAgentLaunch(object data)=>Emit("agent-launch",data);
    private static void Emit(string name, object data) => _ = Send(new { @event = name, data });
    private static async Task Send(object value)
    {
        string json = JsonSerializer.Serialize(value);
        await writes.WaitAsync();
        try { if (output != null) await output.WriteLineAsync(json); }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally { writes.Release(); }
    }
}
