using HeyClicky;
using HeyClicky.Agents;
using HeyClicky.App.Cody;
using System.Diagnostics;
class Program{
 static AgentTaskDetail Task(string id,AgentTaskStatus status=AgentTaskStatus.Finished,string job=null)=>new(new(id,null,"Saved task",status,"","Result",DateTimeOffset.UtcNow),null,null,"C:/fixture",null,"Progress",null,"Result","",Array.Empty<AgentActivityItem>(),Array.Empty<string>(),"Summary","Done",Array.Empty<string>(),Array.Empty<string>(),null,null,false,false,null,0,0,0,false,job);
 static void Main(string[] args){CodyPaths.StateRoot=args.Length>1?args[1]:Path.Combine(Path.GetTempPath(),"cody-library-test-"+Guid.NewGuid().ToString("N"));if(args.Length>0&&args[0]=="read"){Console.WriteLine(CodyTaskLibrary.Merge(Array.Empty<AgentTaskDetail>()).Length);return;}
 int checks=0;void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);checks++;}
 int Reload(){CodyTaskLibrary.Flush();var start=new ProcessStartInfo(Environment.ProcessPath){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};start.ArgumentList.Add("read");start.ArgumentList.Add(CodyPaths.StateRoot);using var p=Process.Start(start);var text=p.StandardOutput.ReadToEnd();p.WaitForExit();if(p.ExitCode!=0)throw new Exception(text);return int.Parse(text.Trim());}
 try{
 var item=Task("live-one",AgentTaskStatus.Finished,"job-one");CodyTaskLibrary.Merge(new[]{item});Check(CodyTaskLibrary.Merge(Array.Empty<AgentTaskDetail>()).Length==1,"missing live snapshot does not remove a task");Check(Reload()==1,"task survives a separate process restart");
 CodyTaskLibrary.Clear("job:job-one");Check(CodyTaskLibrary.Merge(new[]{item}).Length==0,"cleared task stays cleared when backend still reports it");Check(Reload()==0,"clear choice survives a restart");
 var early=Task("migrating",AgentTaskStatus.Running);CodyTaskLibrary.Merge(new[]{early});CodyTaskLibrary.Merge(new[]{early with{JobId="assigned"}});Check(CodyTaskLibrary.Merge(Array.Empty<AgentTaskDetail>()).Count(x=>x.Snapshot.TaskId=="migrating")==1,"assigning a job ID does not create duplicate saved tasks");CodyTaskLibrary.Clear("job:assigned");
 var running=Task("running",AgentTaskStatus.Running);CodyTaskLibrary.Merge(new[]{running});var retained=CodyTaskLibrary.Merge(Array.Empty<AgentTaskDetail>());Check(retained.Length==1&&retained[0].Snapshot.Status==AgentTaskStatus.Stopped,"disconnected session stays saved without falsely claiming it is running");
 var many=Enumerable.Range(0,70).Select(i=>Task("bulk-"+i)).ToArray();var all=CodyTaskLibrary.Merge(many);Check(all.Count(x=>x.Snapshot.TaskId.StartsWith("bulk-"))==70,"library does not silently discard tasks after fifty entries");
 CodyTaskLibrary.ClearMany(all.Select(CodyTaskLibrary.Key));Check(CodyTaskLibrary.Merge(many).Length==0&&Reload()==0,"explicit bulk clear is durable");
 Check(CodyTaskLibrary.Merge(new[]{Task("new-run",AgentTaskStatus.Running,"job-one")}).Length==1,"starting new work for a cleared job makes its new run visible");Console.WriteLine(checks+" checks passed");
 }finally{foreach(var file in Directory.GetFiles(CodyPaths.StateRoot))File.Delete(file);Directory.Delete(CodyPaths.StateRoot);}}
}
namespace HeyClicky{public enum AgentTaskStatus{Starting,Running,WaitingForUser,Finished,Failed,Stopped}public sealed record AgentTaskSnapshot(string TaskId,string ThreadId,string Title,AgentTaskStatus Status,string LatestCommentary,string FinalResponseMarkdown,DateTimeOffset StartedAt);public static class Log{public static void Warn(string area,string text)=>Console.Error.WriteLine(text);}}
namespace HeyClicky.App.Cody{internal static class CodyPaths{internal static string StateRoot;}}
namespace HeyClicky.Agents{public sealed record AgentActivityItem();public sealed record AgentTaskDetail(AgentTaskSnapshot Snapshot,string ClickySlug,string ClickyName,string WorkspacePath,string TurnId,string ProgressSummary,string ThinkingHeading,string StreamingResponse,string StreamingCommentary,IReadOnlyList<AgentActivityItem> Activity,IReadOnlyList<string> UserPrompts,string Summary,string DoneTitle,IReadOnlyList<string> NextActions,IReadOnlyList<string> Artifacts,string FailureMessage,object Error,bool RequiresExtraUsageApproval,bool DidRefundEarlyStop,object Lease,long InputTokens,long CachedInputTokens,long OutputTokens,bool IsRoutineRun,string JobId=null);}
