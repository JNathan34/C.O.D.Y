using HeyClicky;
using HeyClicky.App.Cody;
using HeyClicky.Core.Dictation;
var scheduler=new Scheduler();bool active=false;int begins=0,ends=0,locks=0,cancels=0;
var state=new DictationHotkeyStateMachine(scheduler,()=>active,()=>{active=true;begins++;},()=>{active=false;ends++;},()=>locks++);
var keys=new CodyDictationShortcuts.KeyState();var actions=new List<ShortcutAction>();
void Send(ShortcutAction action){actions.Add(action);switch(action){case ShortcutAction.DictationDown:state.Pressed();break;case ShortcutAction.DictationUp:state.Released();break;case ShortcutAction.DictationCancel:active=false;state.Reset();break;}}
bool Key(uint key,bool down,nuint tag=0)=>keys.Handle(key,down,!down,tag,true,Send,()=>{if(!active)return false;active=false;cancels++;state.Reset();return true;});
void Press(){Key(162,true);Key(91,true);}void Release(){Key(91,false);Key(162,false);}
Press();scheduler.Advance(600);Release();if(begins!=1||ends!=1||active)throw new Exception("Hold/release dictation failed");
Press();scheduler.Advance(100);Release();scheduler.Advance(100);Press();Release();if(state.Engagement!=DictationEngagement.HandsFreeLocked||locks!=1||!active)throw new Exception("Double-tap did not lock dictation");
Press();Release();if(active||ends!=2)throw new Exception("Hands-free finish failed");
Press();if(!Key(27,true)||!Key(27,false)||cancels!=1)throw new Exception("Escape did not cancel dictation");Release();
int count=actions.Count;Key(162,true);Key(164,true);Key(164,false);Key(162,false);if(actions.Count!=count)throw new Exception("Ctrl+Alt was intercepted");
Key(162,true,1212369995);Key(91,true,1212369995);Key(91,false,1212369995);Key(162,false,1212369995);if(actions.Count!=count)throw new Exception("AI-injected keys triggered dictation");
Press();Key(68,true);Key(68,false);Release();if(active||actions[^2]!=ShortcutAction.DictationCancel)throw new Exception("Windows shortcut did not cancel accidental dictation");
Console.WriteLine("PASS: hold/release, double-tap hands-free, finish, Escape, Ctrl+Alt passthrough, injected-key isolation, Windows shortcut cancellation");
sealed class Scheduler:IDictationScheduler{
 public DateTimeOffset Now{get;private set;}=DateTimeOffset.UtcNow;
 private readonly List<(DateTimeOffset At,Job Job)> jobs=new();
 public IDisposable Schedule(TimeSpan delay,Action action){var job=new Job(action);jobs.Add((Now+delay,job));return job;}
 public void Advance(int ms){Now=Now.AddMilliseconds(ms);foreach(var job in jobs.Where(j=>j.At<=Now).ToArray()){jobs.Remove(job);if(!job.Job.Cancelled)job.Job.Action();}}
 private sealed class Job(Action action):IDisposable{public Action Action=action;public bool Cancelled;public void Dispose()=>Cancelled=true;}
}
namespace HeyClicky.App.Cody{internal static class CodyIndependentInput{internal static bool Active=>false;}}
namespace HeyClicky.Core.Dictation{public sealed class DictationController{public bool HasDedicatedHandsFreeShortcut{get;set;}public void HandleShortcut(ShortcutAction action){}public bool CancelActiveSession()=>false;}}
