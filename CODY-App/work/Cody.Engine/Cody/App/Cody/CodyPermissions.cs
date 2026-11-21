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
    public static bool CanUseComputer=>Enabled&&Current.computerUse;
    public static bool CanUseAgentComputer=>CanUseComputer&&(Current.level!="custom"||Current.backgroundTasks);
    public static bool Automatic=>CanUseComputer&&(Current.level=="full"||Current.level=="custom");
    public static string Context => !CanUseComputer
        ? "Computer Use is disabled. For tasks that require native mouse and keyboard control, explain how to enable it in Settings > Plugins."
        : "C.O.D.Y. computer control uses the real Windows mouse and keyboard for foreground actions. Use the computer tool directly and verify results on screen. " + (Current.level == "custom"
            ? $"The user selected custom access. Background task computer use is {(CanUseAgentComputer ? "allowed" : "blocked")}. Use only enabled capabilities."
            : Automatic
                ? "The user has enabled automatic computer control in C.O.D.Y. Settings. Use the native control tools without requesting approval again. Extra paid usage and service and Windows security prompts still require separate authorization."
                : "Ask for the user's approval before taking control of the computer, using C.O.D.Y.'s approval card.");
    public static void Load(string path){file=path;try{var value=JsonSerializer.Deserialize<Policy>(File.ReadAllText(path));Current=Valid(value)?value:new();}catch{Current=new();}}
    private static bool Valid(Policy policy)=>policy!=null&&(policy.level=="ask"||policy.level=="approve-safe"||policy.level=="full"||policy.level=="custom");
    public static Policy Configure(bool? enabled=null,string level=null,bool? computerUse=null,bool? backgroundTasks=null){
        var next=new Policy(enabled??Current.enabled,level??Current.level,computerUse??Current.computerUse,backgroundTasks??Current.backgroundTasks);if(!Valid(next))throw new ArgumentException("Invalid permission level.");
        if(file!=null){Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllText(file+".tmp",JsonSerializer.Serialize(next));File.Move(file+".tmp",file,true);}Current=next;return next;
    }
    public static bool? Decision(string key)
    {
        if (key != "takeover-card" && !key.StartsWith("job:", StringComparison.Ordinal)) return null;
        if (!(key == "takeover-card" ? CanUseComputer : CanUseAgentComputer)) return false;
        return Automatic ? true : null;
    }
}
