using System.Threading;
using System.Threading.Tasks;
namespace HeyClicky.Core.Brain {public record BrainToolCall(string CallId,string Name,string Arguments,bool IsAsync=false);}
namespace HeyClicky.Core.Tools {public record CompanionToolContext(string UserWords,bool Typed,IReadOnlyList<string> AttachedFilePaths);}
namespace HeyClicky.Agents {
 public enum AgentTaskStatus{Starting,Running,WaitingForUser,Finished,Failed,Stopped}
 public record Snapshot(AgentTaskStatus Status);
 public record PendingStep(string Step);
 public record AgentTaskDetail{public string LaunchSource{get;set;}="cody-foreground";public string JobId=>"own-job";public Snapshot Snapshot{get;set;}=new(AgentTaskStatus.Finished);public string StreamingResponse{get;set;}="done";public string Summary{get;set;}="";public string FailureMessage=>null;public PendingStep PendingUserStep=>null;public bool RequiresExtraUsageApproval=>false;}
 public record AgentLaunchRequest{public string Prompt{get;init;}public string DisplayPrompt{get;init;}public string LaunchSource{get;init;}public string LaunchContext{get;init;}public IReadOnlyList<string> AttachedFilePaths{get;init;}}
 public class Jobs {public List<string> Dismissed=new();public void Dismiss(string id)=>Dismissed.Add(id);}
 public class AgentService {public Jobs Jobs=new();public AgentTaskDetail Detail=new();public AgentLaunchRequest Last;public int Launches,Stops,Dismissals;public Task<string> LaunchAsync(AgentLaunchRequest request,CancellationToken ct){ct.ThrowIfCancellationRequested();Last=request;Launches++;return Task.FromResult("own-task");}public AgentTaskDetail GetTaskDetail(string id)=>Detail;public Task StopAsync(string id){Stops++;Detail.Snapshot=new(AgentTaskStatus.Stopped);return Task.CompletedTask;}public void DismissTask(string id)=>Dismissals++;}
}
namespace HeyClicky.App.Drive {public class ClickyTakeOverController {public static ClickyTakeOverController Current=new();public bool IsDriving;public int Calls;public string Goal;public Task<string> HandleToolAsync(string name,string json){Calls++;Goal=json;return Task.FromResult("{\"status\":\"offered\"}");}}}
