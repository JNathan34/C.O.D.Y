using System;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Text.Json;
using HeyClicky.Agents;

namespace HeyClicky.App.Cody;
internal static class CodyJobReports
{
    private static readonly ConcurrentDictionary<string,string> turns=new();
    private static volatile bool dirty=true;
    private static string previous="";
    private static string Clip(string value,int limit)=>string.IsNullOrEmpty(value)?"":value.Length>limit?value[..limit]:value;
    private static string First(params string[] values)=>values.FirstOrDefault(value=>!string.IsNullOrWhiteSpace(value))??"";
    private static AgentTaskDetail History(HeyClicky.Agents.Jobs.ClickyJob job){
        var status=job.Outcome==HeyClicky.Agents.Jobs.ClickyJobOutcome.Done?AgentTaskStatus.Finished:job.Outcome==HeyClicky.Agents.Jobs.ClickyJobOutcome.Failed?AgentTaskStatus.Failed:AgentTaskStatus.Stopped;
        var snapshot=new AgentTaskSnapshot("job:"+job.Id,job.ThreadId,job.Title,status,"",job.ReplyText,job.Runs?.OrderByDescending(run=>run.StartedAt).FirstOrDefault()?.StartedAt??job.CreatedAt);
        return new AgentTaskDetail(snapshot,null,null,job.FolderPath,null,"Saved result",null,job.ReplyText??job.Summary??"","",Array.Empty<AgentActivityItem>(),new[]{job.Prompt},job.Summary,job.Title,Array.Empty<string>(),job.LatestReplyArtifactEntries??job.ArtifactEntries,status==AgentTaskStatus.Failed?job.Summary:null,null,false,false,null,0,0,0,false,JobId:job.Id,Answer:job.ResultCard);
    }
    private static System.Collections.Generic.IEnumerable<AgentTaskDetail> NativeDetails(AppHost host){
        var ids=new System.Collections.Generic.HashSet<string>();
        foreach(var task in host.Real.Agents.Tasks){var detail=host.Real.Agents.GetTaskDetail(task.TaskId);if(detail==null)continue;if(detail.JobId!=null)ids.Add(detail.JobId);if(CodyQuickActions.IsForeground(detail))continue;yield return detail;}
        foreach(var job in host.Real.Agents.Jobs.Jobs.Where(job=>!job.IsDismissed&&job.IsArchived!=true&&!job.IsWaitingToStart&&!ids.Contains(job.Id)))yield return History(job);
    }
    internal static string CancellationTarget(AppHost host,string driveThread,string turn,bool fallback)=>CodyCancellationTarget.Select(host.Real.Agents.Tasks.Where(task=>task.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser).Select(task=>{turns.TryGetValue(task.TaskId,out var owner);return new CodyCancellationTarget.Work(task.TaskId,task.ThreadId,owner,task.StartedAt);}),driveThread,turn,fallback);
    internal static object Snapshot(AppHost host)=>new{tasks=CodyTaskLibrary.Merge(NativeDetails(host)).OrderBy(detail=>detail.Snapshot.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser?0:1).ThenByDescending(detail=>detail.Snapshot.StartedAt).Select(detail=>{
        var task=detail.Snapshot;turns.TryGetValue(task.TaskId,out var owner);
        return new{id=CodyTaskLibrary.Key(detail),title=Clip(task.Title,240),status=task.Status.ToString(),statusLabel=task.TaskId.StartsWith("job:")&&task.Status==AgentTaskStatus.Stopped?"Saved task":null,progress=Clip(First(detail.PendingUserStep?.Step,detail.ProgressSummary,detail.ThinkingHeading,task.LatestCommentary),1600),preview=Clip(First(detail.StreamingResponse,detail.Summary,detail.ProgressSummary),1200),stepsDone=detail.Plan?.Count(step=>step.IsDone)??0,stepsTotal=detail.Plan?.Count??0,startedAt=task.StartedAt,turn=owner,requiresApproval=detail.RequiresExtraUsageApproval};
    }).ToArray()};
    internal static void Tick(AppHost host){if(!dirty)return;dirty=false;string json=JsonSerializer.Serialize(Snapshot(host));if(json==previous)return;previous=json;CodyEngineBridge.PublishTasks(JsonSerializer.Deserialize<JsonElement>(json));}
    private static AgentTaskDetail Find(AppHost host,string id){
        if(string.IsNullOrWhiteSpace(id)||id.Length>200)throw new InvalidOperationException("That background task is no longer available.");
        var live=NativeDetails(host).FirstOrDefault(value=>CodyTaskLibrary.Key(value)==id||value.Snapshot.TaskId==id);if(live!=null)return live;var saved=CodyTaskLibrary.Find(id);if(saved!=null)return saved;
        if(id.StartsWith("job:")){var job=host.Real.Agents.Jobs.Job(id[4..]);if(job!=null&&!job.IsDismissed&&job.IsArchived!=true)return History(job);}
        return host.Real.Agents.GetTaskDetail(id)??throw new InvalidOperationException("That background task is no longer available.");
    }
    internal static object Detail(AppHost host,string id){var detail=Find(host,id);return new{id,title=Clip(detail.Snapshot.Title,240),status=detail.Snapshot.Status.ToString(),progress=Clip(detail.ProgressSummary,4000),response=Clip(detail.StreamingResponse,180000),summary=Clip(detail.Summary,16000),failure=Clip(detail.FailureMessage,4000),question=Clip(detail.PendingUserStep?.Step,8000),requiresApproval=detail.RequiresExtraUsageApproval,activity=detail.Activity.TakeLast(15).Select(item=>new{kind=item.Kind.ToString(),text=Clip(item.Text,2000),running=item.IsRunning,at=item.At}).ToArray()};}
    internal static object Preview(AppHost host,string id)=>CodyTaskOutputs.Preview(Find(host,id));
    internal static object OpenOutput(AppHost host,string id,string outputId)=>CodyTaskOutputs.Open(Find(host,id),outputId);
    internal static async System.Threading.Tasks.Task<object> Act(AppHost host,string id,string action,string text){if(action=="message"&&!CodyAgentUsage.Enabled)throw new InvalidOperationException(CodyAgentUsage.DisabledMessage);var detail=Find(host,id);if(detail.Snapshot.Status is not (AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser))throw new InvalidOperationException("That background task has finished.");if(action=="message"&&detail.RequiresExtraUsageApproval)throw new InvalidOperationException("This task is waiting for extra usage approval. A message does not grant that permission.");if(action=="stop")await host.Real.Agents.StopAsync(detail.Snapshot.TaskId);else if(action=="message"&&!string.IsNullOrWhiteSpace(text)&&text.Length<=12000)await host.Real.Agents.SteerAsync(detail.Snapshot.TaskId,text);else throw new ArgumentException("Invalid background task action.");dirty=true;return new{accepted=true};}
    internal static object Clear(AppHost host,string id){var detail=Find(host,id);if(detail.Snapshot.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser)throw new InvalidOperationException("Stop the task before clearing it.");CodyTaskLibrary.Merge(NativeDetails(host));CodyTaskLibrary.Clear(CodyTaskLibrary.Key(detail));dirty=true;return new{cleared=true};}
    internal static object ClearFinished(AppHost host){var values=CodyTaskLibrary.Merge(NativeDetails(host));CodyTaskLibrary.ClearMany(values.Where(detail=>detail.Snapshot.Status is AgentTaskStatus.Finished or AgentTaskStatus.Failed or AgentTaskStatus.Stopped).Select(CodyTaskLibrary.Key));dirty=true;return new{cleared=true};}
    private static string MapPath=>Path.Combine(CodyPaths.StateRoot,"job-turns.json");
    internal static void Bind(AppHost host,Func<string> currentTurn)
    {
        try{foreach(var item in JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string,string>>(File.ReadAllText(MapPath)))turns[item.Key]=item.Value;}catch{}
        host.Real.Agents.TasksChanged+=(_,_)=>dirty=true;
        host.Real.Agents.Jobs.Changed+=(_,_)=>dirty=true;
        host.Real.Agents.TaskEvent+=(_,item)=>{
            dirty=true;
            if(item.Kind==AgentTaskEventKind.StatusChanged&&item.Text=="Starting"){
                string turn=currentTurn();if(!string.IsNullOrEmpty(turn)&&turns.TryAdd(item.TaskId,turn)){
                    try{File.WriteAllText(MapPath,JsonSerializer.Serialize(turns.ToArray().TakeLast(512).ToDictionary(pair=>pair.Key,pair=>pair.Value)));}catch{}
                }
            }
            if(item.Kind!=AgentTaskEventKind.Finished&&item.Kind!=AgentTaskEventKind.Failed&&item.Kind!=AgentTaskEventKind.Stopped)return;
            if(CodyQuickActions.IsForeground(host.Real.Agents.GetTaskDetail(item.TaskId)))return;
            CodyTaskLibrary.Merge(NativeDetails(host));CodyTaskLibrary.Flush();
            if(!turns.TryGetValue(item.TaskId,out var owner))return;
            var detail=host.Real.Agents.GetTaskDetail(item.TaskId);if(detail==null)return;
            string text=!string.IsNullOrWhiteSpace(detail.StreamingResponse)?detail.StreamingResponse:detail.Summary??detail.FailureMessage;
            if(string.IsNullOrWhiteSpace(text))return;
            if(text.Length>180000)text=text.Substring(0,180000);
            CodyEngineBridge.PublishJobReport(new {turn=owner,taskId=item.TaskId,text});
        };
    }
}
