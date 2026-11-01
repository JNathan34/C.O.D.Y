using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.App.Cody;

// Owned by the engine UI dispatcher. A decision answers exactly one live request.
public sealed class CodyConsent
{
    public sealed record View(string id, string reason, string command);
    private sealed record Pending(string Key, View View, Action<bool> Answer, Func<bool> Valid, DateTimeOffset? Expires, Action TimedOut);
    private readonly Dictionary<string,Pending> pending=new();
    private readonly Func<DateTimeOffset> now;
    public event Action<View[]> Changed;
    public Func<string,bool?> Policy{get;set;}
    public CodyConsent(Func<DateTimeOffset> clock=null){now=clock??(()=>DateTimeOffset.UtcNow);}
    public View[] Snapshot()=>pending.Values.Select(p=>p.View).ToArray();
    public string Request(string key,string reason,string command,Action<bool> answer,Func<bool> valid=null,TimeSpan? timeout=null,Action timedOut=null)
    {
        Sweep();
        var decision=Policy?.Invoke(key);if(decision.HasValue){if(valid==null||valid())answer(decision.Value);return null;}
        var existing=pending.Values.FirstOrDefault(p=>p.Key==key);
        if(existing!=null)return existing.View.id;
        string id=Guid.NewGuid().ToString("N");
        pending.Add(id,new Pending(key,new View(id,reason,command),answer,valid,timeout.HasValue?now()+timeout.Value:null,timedOut));
        Publish();return id;
    }
    public void Remove(string id){if(id!=null&&pending.Remove(id))Publish();}
    public void ApplyPolicy(){foreach(var item in pending.Values.ToArray()){var decision=Policy?.Invoke(item.Key);if(decision.HasValue&&pending.ContainsKey(item.View.id))Decide(item.View.id,decision.Value?"accept":"decline");}}
    public bool Contains(string id)=>id!=null&&pending.ContainsKey(id);
    public void Decide(string id,string decision)
    {
        if(decision!="accept"&&decision!="decline")throw new ArgumentException("Invalid permission decision.");
        Sweep();
        if(!pending.Remove(id,out var request))throw new InvalidOperationException("This permission request has expired.");
        Publish();request.Answer(decision=="accept");
    }
    public void Sweep()
    {
        foreach(var item in pending.Values.ToArray()){
            if(!pending.ContainsKey(item.View.id))continue;
            if(item.Valid!=null&&!item.Valid()){Remove(item.View.id);continue;}
            if(item.Expires.HasValue&&item.Expires<=now()){
                Remove(item.View.id);if(item.TimedOut!=null)item.TimedOut();else item.Answer(false);
            }
        }
    }
    private void Publish()=>Changed?.Invoke(Snapshot());
}
