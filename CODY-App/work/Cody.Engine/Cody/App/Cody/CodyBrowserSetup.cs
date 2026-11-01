using System;
using System.IO;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Text.Json;
using HeyClicky.App.Browser;
using HeyClicky.Core.Browser;

namespace HeyClicky.App.Cody;
internal static class CodyBrowserSetup
{
    private static string previous="";
    private static string Key(ChromeSetupFlow.Target target)=>target==null?"":JsonSerializer.Serialize(new[]{target.JobId,target.ThreadId});
    internal static object Snapshot(){var flow=ChromeSetupFlow.Shared;var target=flow.TargetFor(null);return new{connected=ClickyBrowserBridge.Shared.IsConnected,connectedBrowsers=ClickyBrowserBridge.Shared.ConnectedBrowserNames,pending=target!=null,targetId=Key(target),busy=flow.IsBusy,showingHow=flow.IsShowingHow,canInstall=flow.CanDoItForThem,fromStore=ClickyBrowserBridge.Shared.StoreListingUrl!=null};}
    internal static void Tick(){string json=JsonSerializer.Serialize(Snapshot());if(previous==json)return;previous=json;CodyEngineBridge.PublishBrowserSetup(JsonSerializer.Deserialize<JsonElement>(json));}
    internal static async Task<object> Choose(string choice,string targetId,string browser=""){
        if(browser.Length>0){
            if(browser!="Chrome"&&browser!="Edge")throw new ArgumentException("Invalid browser.");
            if(choice=="not_now")return Snapshot();
            if(choice!="show_me_how")throw new ArgumentException("Choose Show me how to connect this browser.");
            await ClickyBrowserBridge.Shared.ConnectAsync(revealingFolder:false,browserName:browser);
            return Snapshot();
        }
        var flow=ChromeSetupFlow.Shared;var target=flow.TargetFor(null);
        if(Key(target)!=targetId)throw new InvalidOperationException("The browser setup request changed. Please choose again.");
        var parsed=ChromeSetupFlow.Parse(choice)??throw new ArgumentException("Invalid browser setup choice.");
        if(flow.IsBusy&&!(flow.IsShowingHow&&parsed==ChromeSetupFlow.Choice.NotNow))throw new InvalidOperationException("Browser setup is already in progress.");
        if(ClickyBrowserBridge.Shared.IsConnected)return Snapshot();
        if(parsed==ChromeSetupFlow.Choice.DoItForMe&&!flow.CanDoItForThem)throw new InvalidOperationException("Automatic installation is unavailable. Choose Show me how.");
        flow.Choose(parsed,target??ChromeSetupFlow.Target.None);return Snapshot();
    }
    internal static object Folder(){string folder=ClickyBrowserBridge.Shared.SyncInstalledExtensionFolder();if(string.IsNullOrEmpty(folder)||!Directory.Exists(folder))throw new InvalidOperationException("The bundled browser extension folder is unavailable.");Process.Start(new ProcessStartInfo{FileName=folder,UseShellExecute=true});return new{opened=true,path=folder};}
}
