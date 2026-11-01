using System;
using System.IO;
using System.Text.Json;
namespace HeyClicky.App.Cody;
internal static class CodyPermissions
{
    public sealed record Policy(bool enabled=false,string level="ask",bool computerUse=true,bool backgroundTasks=true);
    private static string file;
    public static Policy Current{get;private set;}=new();
    public static bool Enabled=>Current.enabled;
    public static bool CanUseComputer=>Enabled&&(Current.level!="custom"||Current.computerUse);
    public static bool CanUseAgentComputer=>CanUseComputer&&(Current.level!="custom"||Current.backgroundTasks);
    public static bool Automatic=>CanUseComputer&&(Current.level=="full"||Current.level=="custom");
    public static string Context=>(CodyIndependentInput.SystemInputEnabled?"C.O.D.Y. computer control uses the real Windows mouse and keyboard for foreground actions. Use the computer tool directly and verify results on screen. ":"C.O.D.Y. uses an independent software pointer: never move the user\u0027s Windows cursor. Prefer browser-extension and app tools. Independent input supports accessible control actions, clicks, double-clicks, drags, scrolling, text selection and typing, common text shortcuts, and window buttons. Other shortcuts and apps requiring hardware input can refuse it. On refusal use a supported tool and do not claim success. Windows window focus is still shared. ") + (!Enabled?"C.O.D.Y. computer control is disabled. Explain how to enable it in Settings > Permissions if needed.":Current.level=="custom"?("The user selected custom access. Computer use is "+(Current.computerUse?"allowed":"blocked")+". Background task computer use is "+(Current.backgroundTasks&&Current.computerUse?"allowed":"blocked")+". Use only enabled capabilities; do not ask for a blocked permission in an approval card."):Automatic?"The user has enabled automatic computer control in C.O.D.Y. Settings. Do not ask for control permission again; use the native control tools. This does not authorize extra paid usage or bypass service and Windows security prompts.":"Ask for the user's approval before taking control of the computer, using C.O.D.Y.'s approval card.");
    public static void Load(string path){file=path;try{var value=JsonSerializer.Deserialize<Policy>(File.ReadAllText(path));Current=Valid(value)?value:new();}catch{Current=new();}}
    private static bool Valid(Policy policy)=>policy!=null&&(policy.level=="ask"||policy.level=="approve-safe"||policy.level=="full"||policy.level=="custom");
    public static Policy Configure(bool? enabled=null,string level=null,bool? computerUse=null,bool? backgroundTasks=null){
        var next=new Policy(enabled??Current.enabled,level??Current.level,computerUse??Current.computerUse,backgroundTasks??Current.backgroundTasks);if(!Valid(next))throw new ArgumentException("Invalid permission level.");
        if(file!=null){Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllText(file+".tmp",JsonSerializer.Serialize(next));File.Move(file+".tmp",file,true);}Current=next;return next;
    }
    public static bool? Decision(string key){if(key!="takeover-card"&&!key.StartsWith("job:",StringComparison.Ordinal))return null;return !Enabled?false:Current.level=="custom"?(key=="takeover-card"?Current.computerUse:Current.computerUse&&Current.backgroundTasks):Automatic?true:null;}
}
