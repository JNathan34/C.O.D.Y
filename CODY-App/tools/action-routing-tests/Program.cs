using HeyClicky.App.Cody;
using HeyClicky.Core.Brain;
using HeyClicky.Core.Tools;
using HeyClicky.Agents;
int checks=0,normal=0;void Check(bool ok,string name){if(!ok)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
Task<string> Normal(BrainToolCall call,CompanionToolContext context,CancellationToken ct){normal++;return Task.FromResult("background");}
var call=new BrainToolCall("test","sessions_spawn","{}");
foreach(var request in new[]{"message notes on WhatsApp hello","Can you please mute Discord","send Sam hello on Slack","pause Plezy","skip two minutes in Plex","open Firefox","join the call in Teams","tell Alex on WhatsApp build a website","go into Discord and deafen me"})Check(CodyActionRouting.Immediate(request),"Immediate: "+request);
foreach(var request in new[]{"Build a website","Write a report about Discord","Research headphones","Schedule a message tomorrow","Monitor my email","message Sam hello in the background","Add Discord integration to my codebase"})Check(!CodyActionRouting.Immediate(request),"Background: "+request);
var service=new AgentService();var drive=HeyClicky.App.Drive.ClickyTakeOverController.Current;
string ask="message Notes on WhatsApp: Hi, keep This EXACT text!";
await CodyQuickActions.Handle(call,new(ask,true,Array.Empty<string>()),default,Normal,service,()=>Array.Empty<string>());
Check(service.Launches==0&&normal==0&&drive.Calls==1&&drive.Goal.Contains("EXACT text"),"Unconnected app goes directly to computer control without a worker");
service.Detail.StreamingResponse="{\"outcome\":\"completed\",\"did_act\":true,\"summary\":\"Sent.\"}";
var result=await CodyQuickActions.Handle(call,new(ask,true,new[]{"C:/test/attached.png"}),default,Normal,service,()=>new[]{"whatsapp"});
Check(service.Launches==1&&service.Last.Prompt==ask&&service.Last.AttachedFilePaths.Count==1&&drive.Calls==1&&result.Contains("foreground_result"),"Connected plugin runs inline and preserves exact request and attachments");
Check(service.Jobs.Dismissed.All(x=>x=="own-job")&&service.Dismissals==1,"Only the foreground action's own SDK bookkeeping is dismissed");
service.Detail.StreamingResponse="{\"outcome\":\"unsupported\",\"did_act\":false,\"summary\":\"No local deafen control.\"}";
await CodyQuickActions.Handle(call,new("deafen Discord",true,Array.Empty<string>()),default,Normal,service,()=>new[]{"discord"});Check(drive.Calls==2,"Unsupported plugin operation falls back to computer control");
service.Detail.StreamingResponse="{\"outcome\":\"unsupported\",\"did_act\":true,\"summary\":\"Partial result\"}";
await CodyQuickActions.Handle(call,new("send Sam hi on Slack",true,Array.Empty<string>()),default,Normal,service,()=>new[]{"slack"});Check(drive.Calls==2,"Partial plugin actions are never blindly repeated through the UI");
await CodyQuickActions.Handle(call,new("Build a website",true,Array.Empty<string>()),default,Normal,service,()=>new[]{"discord"});Check(normal==1,"Substantial work retains the original background launcher");
Check(CodyActionRouting.ConnectedApp("join Teams",new[]{"microsoftteams"})=="microsoftteams","Connected app matching supports vendor-prefixed plugin ids");
service.Detail.Snapshot=new(AgentTaskStatus.Running);using var cancellation=new CancellationTokenSource(20);bool cancelled=false;try{await CodyQuickActions.Handle(call,new("mute Discord",true,Array.Empty<string>()),cancellation.Token,Normal,service,()=>new[]{"discord"});}catch(OperationCanceledException){cancelled=true;}Check(cancelled&&service.Stops==1,"Cancelling a foreground request stops its plugin action");


Check(!CodyActionRouting.Immediate("send Sam hello tomorrow"),"Future actions retain scheduling instead of being sent now");
Check(CodyActionRouting.Immediate("message Notes on WhatsApp \"tomorrow plans\""),"Dates inside quoted message content do not schedule the action");
Check(CodyActionRouting.ConnectedApp("play Iron Man in Plex",new[]{"plex"})==null,"Plex requests stay with Plezy instead of using the Plex plugin");
Console.WriteLine($"{checks} routing checks passed");
