using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using HeyClicky.Agents;
namespace HeyClicky.App.Cody;
internal static class CodyTaskLibrary
{
    internal sealed record Saved(string Key,string ActualId,string JobId,string Title,string Status,string Progress,string Response,string Summary,string Failure,string Workspace,string[] Artifacts,DateTimeOffset StartedAt);
    private sealed record Library(Saved[] Tasks,string[] Cleared);
    private static readonly object gate=new();
    private static readonly Dictionary<string,Saved> saved=new();
    private static readonly HashSet<string> cleared=new();
    private static bool loaded,changed;
    private static DateTime lastWrite;
    private static string FilePath=>Path.Combine(CodyPaths.StateRoot,"task-library.json");
    internal static string Key(AgentTaskDetail detail)=>detail.JobId!=null?"job:"+detail.JobId:detail.Snapshot.TaskId;
    private static string Clip(string text,int max)=>text==null?"":text[..Math.Min(max,text.Length)];
    private static void Load(){if(loaded)return;loaded=true;try{var data=JsonSerializer.Deserialize<Library>(File.ReadAllText(FilePath));foreach(var task in data.Tasks)saved[task.Key]=task;foreach(var id in data.Cleared)cleared.Add(id);}catch{}}
    private static void Save(bool force=false){if(!changed||!force&&DateTime.UtcNow-lastWrite<TimeSpan.FromSeconds(2))return;try{Directory.CreateDirectory(CodyPaths.StateRoot);File.WriteAllText(FilePath+".tmp",JsonSerializer.Serialize(new Library(saved.Values.ToArray(),cleared.ToArray())));File.Move(FilePath+".tmp",FilePath,true);lastWrite=DateTime.UtcNow;changed=false;}catch(Exception ex){Log.Warn("cody-tasks","Could not save task library: "+ex.Message);}}
    internal static AgentTaskDetail[] Merge(IEnumerable<AgentTaskDetail> source){lock(gate){
        Load();var current=source.ToArray();var keys=new HashSet<string>();var result=new List<AgentTaskDetail>();
        foreach(var detail in current){var key=Key(detail);if(detail.JobId!=null&&detail.Snapshot.TaskId!=key&&saved.Remove(detail.Snapshot.TaskId))changed=true;if(cleared.Contains(key)&&detail.Snapshot.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser){cleared.Remove(key);changed=true;}if(!keys.Add(key)||cleared.Contains(key))continue;
            var task=detail.Snapshot;var item=new Saved(key,task.TaskId,detail.JobId,Clip(task.Title,240),task.Status.ToString(),Clip(detail.ProgressSummary,4000),Clip(detail.StreamingResponse,180000),Clip(detail.Summary,16000),Clip(detail.FailureMessage,4000),detail.WorkspacePath,detail.Artifacts.Take(100).ToArray(),task.StartedAt);
            if(!saved.TryGetValue(key,out var old)||!(old with{Artifacts=item.Artifacts}).Equals(item)||!old.Artifacts.SequenceEqual(item.Artifacts)){saved[key]=item;changed=true;}
            result.Add(detail);
        }
        foreach(var item in saved.Values)if(!keys.Contains(item.Key)&&!cleared.Contains(item.Key))result.Add(Restore(item));
        Save();return result.ToArray();
    }}
    private static AgentTaskDetail Restore(Saved item){
        var status=Enum.TryParse<AgentTaskStatus>(item.Status,out var parsed)&&parsed is AgentTaskStatus.Finished or AgentTaskStatus.Failed or AgentTaskStatus.Stopped?parsed:AgentTaskStatus.Stopped;
        var snapshot=new AgentTaskSnapshot(item.ActualId,null,item.Title,status,"",item.Response,item.StartedAt);
        return new AgentTaskDetail(snapshot,null,null,item.Workspace,null,item.Progress,null,item.Response,"",Array.Empty<AgentActivityItem>(),Array.Empty<string>(),item.Summary,item.Title,Array.Empty<string>(),item.Artifacts,item.Failure,null,false,false,null,0,0,0,false,JobId:item.JobId);
    }
    internal static AgentTaskDetail Find(string id){lock(gate){Load();return !cleared.Contains(id)&&saved.TryGetValue(id,out var item)?Restore(item):null;}}
    internal static void Clear(string id){lock(gate){Load();if(!saved.ContainsKey(id))throw new InvalidOperationException("That saved task is no longer available.");cleared.Add(id);saved.Remove(id);changed=true;Save(true);}}
    internal static void ClearMany(IEnumerable<string> ids){lock(gate){Load();foreach(var id in ids){cleared.Add(id);saved.Remove(id);}changed=true;Save(true);}}
    internal static void Flush(){lock(gate){Save(true);}}
}
