using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Microsoft.Win32;
using HeyClicky.App.Settings;
namespace HeyClicky.App.Cody;
internal static class CodyAgents
{
    public static async System.Threading.Tasks.Task<object> Usage(AppHost host)
    {
        var billing=host.Real.Core.Billing;
        if(!host.Services.Auth.IsSignedIn)return new{available=false,signedIn=false,error="Sign in to Hey Clicky to see your usage."};
        await billing.RefreshAsync();
        if(!host.Services.Auth.IsSignedIn)return new{available=false,signedIn=false,error="Sign in to Hey Clicky to see your usage."};
        var plan=billing.Plan;
        if(plan==null)return new{available=false,signedIn=host.Services.Auth.IsSignedIn,error="Couldn't load Hey Clicky usage. Try refreshing."};
        object Bucket(HeyClicky.Core.Worker.PlanUsageBucket bucket,bool unlimited=false)=>new{
            used=Math.Max(0,bucket.Used),cap=Math.Max(0,bucket.Cap),remaining=Math.Max(0,bucket.Cap-Math.Max(0,bucket.Used)),unlimited
        };
        return new{
            available=true,signedIn=true,stale=billing.LastFetchError!=null,
            error=billing.LastFetchError!=null?"Couldn't refresh usage. Showing the last available account data.":null,
            plan=billing.CurrentTier=="free"?"Free":billing.CurrentTier=="max"?"Hey Clicky Max":"Hey Clicky Pro",
            agents=Bucket(plan.Usage.Agents),messages=Bucket(billing.DisplayedMessagesUsage??plan.Usage.Messages,billing.IsUnlimited),
            resetsAt=billing.UsageResetsDate,updatedAt=billing.LastPlanAnswerAt
        };
    }
    private static readonly (string id,string name,string uri)[] Privacy = {
        ("broadFileSystemAccess","Files & Folders","ms-settings:privacy-broadfilesystemaccess"),
        ("documentsLibrary","Documents","ms-settings:privacy-documents"),
        ("picturesLibrary","Pictures","ms-settings:privacy-pictures"),
        ("contacts","Contacts","ms-settings:privacy-contacts"),
        ("appointments","Calendar","ms-settings:privacy-calendar"),
        ("microphone","Microphone","ms-settings:privacy-microphone"),
        ("webcam","Camera","ms-settings:privacy-webcam"),
        ("location","Location","ms-settings:privacy-location")
    };
    private static string Status(string id){
        try{
            using var user=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\"+id);
            using var desktop=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\"+id+@"\NonPackaged");
            var a=user?.GetValue("Value") as string;var b=desktop?.GetValue("Value") as string;
            return a=="Deny"||b=="Deny"?"Denied":a=="Allow"?"Granted":"Not granted";
        }catch{return "Unknown";}
    }
    public static object State(AppHost host)=>host.Real.Core.Settings.Read(s=>new{
        folder=s.AgentFolderPath,defaultFolder=AgentFolders.Default,extraUsage=s.AgentAutoApproveExtraUsage,
        voice=s.AgentAnnouncementsVoiceEnabled,cursorUpdates=s.AgentCursorTextAnnouncementsEnabled,
        privacy=Privacy.Select(p=>new{id=p.id,name=p.name,status=Status(p.id)}).ToArray()
    });
    public static object Configure(AppHost host,JsonElement request){
        bool? Bool(string key)=>request.TryGetProperty(key,out var value)?value.GetBoolean():null;
        var extra=Bool("extraUsage");var voice=Bool("voice");var cursor=Bool("cursorUpdates");
        var hasFolder=request.TryGetProperty("folder",out var value);string folder=null;
        if(hasFolder&&value.ValueKind!=JsonValueKind.Null){folder=value.GetString();if(string.IsNullOrWhiteSpace(folder)||!Path.IsPathFullyQualified(folder)||!Directory.Exists(folder))throw new ArgumentException("Choose an existing absolute folder.");}
        host.Real.Core.Settings.Update(s=>{
            if(extra.HasValue)s.AgentAutoApproveExtraUsage=extra.Value;
            if(voice.HasValue)s.AgentAnnouncementsVoiceEnabled=voice.Value;
            if(cursor.HasValue)s.AgentCursorTextAnnouncementsEnabled=cursor.Value;
            if(hasFolder)s.AgentFolderPath=folder;
        });
        return State(host);
    }
    public static object OpenPrivacy(AppHost host,string id){var entry=Privacy.FirstOrDefault(p=>p.id==id);if(entry.id==null)throw new ArgumentException("Unknown privacy setting.");host.OpenUrl(entry.uri);return new{opened=true};}
}
