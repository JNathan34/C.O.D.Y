using System;
using System.Linq;
using HeyClicky.App.Cody;

DateTimeOffset time=DateTimeOffset.UtcNow;
var consent=new CodyConsent(()=>time);int allowed=0,denied=0,expired=0,changed=0;
consent.Changed+=_=>changed++;
void Check(bool value,string message){if(!value)throw new Exception(message);Console.WriteLine("PASS "+message);}
void Answer(bool value){if(value)allowed++;else denied++;}
string first=consent.Request("one","Reason","Goal",Answer),second=consent.Request("two","Reason two","Goal two",Answer);
Check(consent.Snapshot().Length==2&&allowed==0&&denied==0,"queue never executes on presentation");
Check(consent.Request("one","Reason","Goal",Answer)==first&&consent.Snapshot().Length==2,"duplicate polling preserves the same request id");
consent.Decide(first,"decline");Check(denied==1&&allowed==0&&consent.Snapshot().Single().id==second,"deny answers only its own request");
consent.Decide(second,"accept");Check(allowed==1&&denied==1&&consent.Snapshot().Length==0,"allow once answers only its own request");
try{consent.Decide(second,"accept");throw new Exception("repeat accepted");}catch(InvalidOperationException){}
Check(allowed==1,"repeated clicks cannot run an action twice");
bool valid=true;string stale=consent.Request("stale","Reason","Goal",Answer,()=>valid);valid=false;
try{consent.Decide(stale,"accept");throw new Exception("stale accepted");}catch(InvalidOperationException){}
Check(allowed==1&&denied==1,"changed requests cannot be approved through a stale id");
string invalid=consent.Request("invalid","Reason","Goal",Answer);
try{consent.Decide(invalid,"always");throw new Exception("invalid accepted");}catch(ArgumentException){}
Check(consent.Contains(invalid)&&allowed==1,"invalid decisions leave permission unchanged");consent.Remove(invalid);
consent.Request("timeout","Reason","Goal",Answer,timeout:TimeSpan.FromSeconds(45),timedOut:()=>expired++);time+=TimeSpan.FromSeconds(46);consent.Sweep();
Check(expired==1&&allowed==1&&consent.Snapshot().Length==0,"expiry removes the card without granting access");
string old=consent.Request("replace","Reason","Old goal",Answer,()=>false);
string fresh=consent.Request("replace","Reason","New goal",Answer);
Check(old!=fresh&&consent.Snapshot().Single().command=="New goal","replaced requests get fresh ids");consent.Remove(fresh);
Check(changed>0,"request lifecycle publishes UI updates");
string policyFile=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"cody-permissions-"+Guid.NewGuid().ToString("N"),"permissions.json");
try{
 CodyPermissions.Load(policyFile);Check(!CodyPermissions.Enabled,"new permission profiles start disabled");
 var gated=new CodyConsent{Policy=CodyPermissions.Decision};bool? decision=null;
 gated.Request("takeover-card","Test","No action",v=>decision=v);Check(decision==false&&gated.Snapshot().Length==0,"disabled policy declines control without a prompt");
 CodyPermissions.Configure(true,"ask");decision=null;var ask=gated.Request("job:one","Test","No action",v=>decision=v);Check(decision==null&&gated.Contains(ask),"ask policy leaves background control pending");
 CodyPermissions.Configure(true,"full");gated.ApplyPolicy();Check(decision==true&&gated.Snapshot().Length==0,"automatic policy resolves an existing control request once");
 decision=null;gated.Request("takeover-card","Test","No action",v=>decision=v);Check(decision==true&&gated.Snapshot().Length==0,"automatic main control does not show a duplicate approval");
 decision=null;var unrelated=gated.Request("extra-usage","Test","No action",v=>decision=v);Check(decision==null&&gated.Contains(unrelated),"control approval never grants unrelated paid usage");
 CodyPermissions.Load(policyFile);Check(CodyPermissions.Enabled&&CodyPermissions.Automatic,"permission selection survives engine reload");
 try{CodyPermissions.Configure(true,"invalid");throw new Exception("invalid accepted");}catch(ArgumentException){}Check(CodyPermissions.Automatic,"invalid changes preserve the saved policy");
 CodyPermissions.Configure(false);Check(CodyPermissions.Decision("job:two")==false,"master switch blocks background control even in automatic mode");
}finally{System.IO.File.Delete(policyFile);System.IO.Directory.Delete(System.IO.Path.GetDirectoryName(policyFile));}
Check(CodyEscapeTakeBack.ShouldTakeBack(0x1B,true,0),"physical Esc takes control back");
Check(!CodyEscapeTakeBack.ShouldTakeBack(0x1B,false,0),"Esc release cannot trigger an extra take-back");
Check(!CodyEscapeTakeBack.ShouldTakeBack(0x1B,true,1212369995),"AI-generated Esc is not treated as the user's take-back");
Check(Enumerable.Range(0,256).Where(key=>key!=0x1B).All(key=>!CodyEscapeTakeBack.ShouldTakeBack((uint)key,true,0)),"ordinary keys leave control active");
if(OperatingSystem.IsWindows()){
    using var escape=new CodyEscapeTakeBack(()=>{});
    escape.Dispose();escape.Dispose();
    Check(true,"dedicated global Esc listener installs and disposes cleanly");
}
