using HeyClicky.App.Cody;
var now=DateTimeOffset.UtcNow;
var work=new[]{new CodyCancellationTarget.Work("drive-job","drive-thread","older-chat",now.AddMinutes(-5)),new CodyCancellationTarget.Work("parallel-job","parallel-thread","other-chat",now),new CodyCancellationTarget.Work("chat-job","chat-thread","current-chat",now.AddMinutes(-1))};
int checks=0;
void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS "+message);checks++;}
Check(CodyCancellationTarget.Select(work,"drive-thread","current-chat")=="drive-job","Escape cancels the drive owner before a newer parallel job");
Check(CodyCancellationTarget.Select(work,"missing-drive-thread","current-chat")==null,"Missing drive owner never cancels an unrelated job");
Check(CodyCancellationTarget.Select(work,null,"current-chat")=="chat-job","Current conversation takes precedence over unrelated work");
Check(CodyCancellationTarget.Select(work,null,"new-chat")=="parallel-job","Idle background cancellation selects the latest active task");
Check(CodyCancellationTarget.Select(work,null,"new-chat",false)==null,"Cancelling a foreground reply leaves unrelated background tasks running");
Check(CodyCancellationTarget.Select(Array.Empty<CodyCancellationTarget.Work>(),null,null)==null,"Idle Escape has no task to cancel");
Check(CodyEscapeTakeBack.ShouldTakeBack(27,true,0),"Physical Esc down requests cancellation");
Check(!CodyEscapeTakeBack.ShouldTakeBack(27,false,0),"Esc release does not trigger another cancellation");
Check(!CodyEscapeTakeBack.ShouldTakeBack(65,true,0),"Other keys do not cancel tasks");
Check(!CodyEscapeTakeBack.ShouldTakeBack(27,true,1212369995),"Cody's own injected Escape does not cancel its task");

var keys=new CodyEscapeTakeBack.KeyState();int stops=0;bool busy=false;
Check(!keys.Handle(27,true,false,0,()=>busy,()=>stops++),"Idle Escape passes through to the user's app");
busy=true;keys.Handle(27,true,false,0,()=>busy,()=>stops++);keys.Handle(27,true,false,0,()=>busy,()=>stops++);
Check(stops==1,"Holding Escape triggers one cancellation, not several parallel tasks");
busy=false;Check(keys.Handle(27,false,true,0,()=>busy,()=>stops++),"Escape release resets the latch even after the task stops");
busy=true;keys.Handle(27,true,false,0,()=>busy,()=>stops++);Check(stops==2,"A new press can cancel subsequent work");

Console.WriteLine($"{checks} checks passed");
