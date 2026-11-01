using System.Reflection;
using System.Runtime.CompilerServices;
using HeyClicky;
using HeyClicky.Core.Voice;
var flags=BindingFlags.Instance|BindingFlags.NonPublic;
var session=(CompanionSession)RuntimeHelpers.GetUninitializedObject(typeof(CompanionSession));
void Set(object target,string name,object value)=>target.GetType().GetField(name,flags)!.SetValue(target,value);
Set(session,"gate",new object());
foreach(var name in new[]{"lineAudioOffsets","lineGeneratedSeconds"}){var field=typeof(CompanionSession).GetField(name,flags)!;field.SetValue(session,Activator.CreateInstance(field.FieldType));}
var audio=new Audio();var mouth=new RealtimeMouth(null,null,audio,null);Set(session,"mouth",mouth);
var queue=(Queue<(string,int)>)typeof(RealtimeMouth).GetField("queuedLines",flags)!.GetValue(mouth)!;queue.Enqueue(("I'll open Firefox.",0));Set(mouth,"responseInFlight",true);
var cancellation=new CancellationTokenSource();Set(session,"turnCancellation",cancellation);
var interrupt=typeof(CompanionSession).GetMethod("InterruptForNewInput",flags)!;
var clock=System.Diagnostics.Stopwatch.StartNew();interrupt.Invoke(session,new object[]{false,true});
if(audio.Flushes!=0||queue.Count!=1||!mouth.IsResponseInFlight)throw new Exception("Control handoff cut off speech");
if(!cancellation.IsCancellationRequested||clock.ElapsedMilliseconds>500)throw new Exception("Control did not start independently of speech");
Console.WriteLine("PASS: handoff cancels previous computation immediately while queued and in-flight speech continue");
interrupt.Invoke(session,new object[]{false,false});
if(audio.Flushes!=1||queue.Count!=0||mouth.IsResponseInFlight)throw new Exception("User interruption did not stop speech");
Console.WriteLine("PASS: new user input still cancels speech and clears queued audio");
var app=Assembly.Load("HeyClicky");
var shell=app.GetType("HeyClicky.App.Cody.CodyTaskbarInput")!;
var nameMethod=shell.GetMethod("AppName",BindingFlags.NonPublic|BindingFlags.Static)!;
if((string)nameMethod.Invoke(null,new object[]{"Firefox pinned"})!="Firefox"||(string)nameMethod.Invoke(null,new object[]{"Firefox - 2 running windows pinned"})!="Firefox")throw new Exception("Taskbar label parsing failed");
if(args.Contains("--firefox")){
 var before=Pointer();
 var input=app.GetType("HeyClicky.App.Cody.CodyAccessibilityInput")!;var taskbar=Native.FindWindow("Shell_TrayWnd",null);
 object Result(Task pending){pending.GetAwaiter().GetResult();return pending.GetType().GetProperty("Result")!.GetValue(pending)!;}
 var position=Result((Task)input.GetMethod("TaskbarPoint",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{taskbar,"Firefox"})!);
 if(!(bool)position.GetType().GetProperty("Handled")!.GetValue(position)!)throw new Exception(System.Text.Json.JsonSerializer.Serialize(position));var location=System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>((string)position.GetType().GetProperty("Text")!.GetValue(position)!);
 var click=Result((Task)input.GetMethod("Click",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{taskbar,new PointD(location.GetProperty("x").GetDouble(),location.GetProperty("y").GetDouble()),1,false,(Func<bool>)(()=>true)})!);
 if((string)click.GetType().GetProperty("Method")!.GetValue(click)!="shell/taskbar")throw new Exception("Taskbar click did not reach the shell activation route: "+System.Text.Json.JsonSerializer.Serialize(click));

 var task=(Task)shell.GetMethod("Activate",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,new object[]{"Firefox pinned",(Func<bool>)(()=>true)})!;
 task.GetAwaiter().GetResult();var result=task.GetType().GetProperty("Result")!.GetValue(task)!;
 if(!(bool)result.GetType().GetProperty("Handled")!.GetValue(result)!)throw new Exception(System.Text.Json.JsonSerializer.Serialize(result));
 for(int i=0;i<30&&System.Diagnostics.Process.GetProcessesByName("firefox").Length==0;i++)Thread.Sleep(100);
 if(System.Diagnostics.Process.GetProcessesByName("firefox").Length==0)throw new Exception("Firefox did not open");
 if(before!=Pointer())throw new Exception("Windows pointer moved");
 Console.WriteLine("PASS: Windows taskbar shell activation opens Firefox with an unchanged physical pointer");
}
static (int,int) Pointer(){Native.GetCursorPos(out var point);return(point.x,point.y);}

sealed class Audio:IAudioOutput{
 public int Flushes;public int SampleRate=>24000;public TimeSpan Buffered=>TimeSpan.FromSeconds(2);public double PlayedSeconds=>0;public float Level=>0;
 public void Enqueue(ReadOnlySpan<byte> bytes){}public void Flush()=>Flushes++;public void PlayEarcon(string name){}public void Dispose(){}
}


static class Native{[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]internal struct Point{public int x,y;}[System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]internal static extern nint FindWindow(string cls,string title);[System.Runtime.InteropServices.DllImport("user32.dll")]internal static extern bool GetCursorPos(out Point point);}


