using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents;
using HeyClicky.Core.Brain;
using HeyClicky.Core.Tools;
namespace HeyClicky.App.Cody;
internal static class CodyQuickActions
{
    internal static bool IsForeground(AgentTaskDetail detail)=>detail?.LaunchSource==CodyActionRouting.ForegroundSource;
    internal static async Task<string> Handle(BrainToolCall call,CompanionToolContext context,CancellationToken ct,Func<BrainToolCall,CompanionToolContext,CancellationToken,Task<string>> normal,AgentService agents,Func<string[]> connected){
        var selected = context.Capability;
        bool selectedAgent = selected?.UsesAgent == true;
        if (selectedAgent && call.Name != "sessions_spawn")
            return ToolResults.Status("blocked", "The user selected a capability for this request. Use that capability or explain why it is unavailable.");
        if (selected?.Kind == "computer" && call.Name == "sessions_spawn")
            return await Drive(ControlRequest(context), ct);
        if(!CodyAgentUsage.Enabled&&call.Name is ("sessions_spawn" or "sessions_send" or "sessions_answer_request" or "routines"))
            return ToolResults.Status("blocked",CodyAgentUsage.DisabledMessage);
        if(call.Name!="sessions_spawn"||(!selectedAgent&&!CodyActionRouting.Immediate(context.UserWords)))return await normal(call,context,ct);
        ct.ThrowIfCancellationRequested();
        string request=context.UserWords;string controlRequest=ControlRequest(context);
        string plugin=selectedAgent ? selected.Target : CodyActionRouting.ConnectedApp(request,connected());
        if(plugin==null)return await Drive(controlRequest,ct);
        string instruction = selected?.Kind == "skill"
            ? $"The user selected the {JsonSerializer.Serialize(selected.Name)} skill. Read the installed skill {JsonSerializer.Serialize(selected.Target)} first and follow its workflow, limited to the user's request."
            : $"Use the connected {JsonSerializer.Serialize(plugin)} plugin directly, with the fewest necessary calls.";
        string scope = selectedAgent
            ? "This is an explicit capability selection. Use that capability for the requested operation. Never silently switch to another capability."
            : "This is a short foreground app action, not a background assignment. No plan, research or new helpers.";
        string control = selected?.Kind == "skill" ? "" : "No GUI control.";
        string task=null,job=null;
        try{
            task=await agents.LaunchAsync(new AgentLaunchRequest{Prompt=request,DisplayPrompt=request,AttachedFilePaths=context.AttachedFilePaths,LaunchSource=CodyActionRouting.ForegroundSource,LaunchContext=$"{scope} {instruction} {control} Do not create unrelated files or delegate the request. Use user-attached files only as explicitly requested. Preserve the exact recipient, message text and requested scope. Obey all existing approvals and usage limits. If the capability cannot perform the operation, take no action and return only JSON {{\"outcome\":\"unsupported\",\"did_act\":false,\"summary\":\"short reason\"}}. When done return only JSON {{\"outcome\":\"completed\",\"did_act\":true,\"summary\":\"short verified result\"}}. For missing details or approval return outcome needs_input; never invent success."},ct);
            job=agents.GetTaskDetail(task)?.JobId;if(job!=null)agents.Jobs.Dismiss(job);
            while(true){
                ct.ThrowIfCancellationRequested();var detail=agents.GetTaskDetail(task)??throw new InvalidOperationException("The foreground action ended without a result.");
                if(detail.Snapshot.Status==AgentTaskStatus.Finished){
                    string reply=!string.IsNullOrWhiteSpace(detail.StreamingResponse)?detail.StreamingResponse:detail.Summary??"";
                    if(!selectedAgent&&TryUnsupported(reply))return await Drive(controlRequest,ct);
                    return JsonSerializer.Serialize(new{status="foreground_result",message="No background task card was created. Report only what the result actually confirms, briefly; ask for missing approval or details if needed.",result=reply});
                }
                if(detail.Snapshot.Status is AgentTaskStatus.Failed or AgentTaskStatus.Stopped)return JsonSerializer.Serialize(new{status="failed",message=detail.FailureMessage??"The action stopped before completion. Do not claim it succeeded."});
                if(detail.Snapshot.Status==AgentTaskStatus.WaitingForUser||detail.RequiresExtraUsageApproval){
                    _=agents.StopAsync(task);return JsonSerializer.Serialize(new{status="needs_input",message=detail.RequiresExtraUsageApproval?"This action needs extra usage approval; it was stopped without approving extra usage.":detail.PendingUserStep?.Step??detail.Summary??"This action needs clarification or approval before it can finish."});
                }
                await Task.Delay(100,ct);
            }
        }catch(OperationCanceledException){if(task!=null)_=agents.StopAsync(task);throw;}
        catch(Exception){if(task!=null)_=agents.StopAsync(task);return JsonSerializer.Serialize(new{status="failed",message="The plugin action could not be confirmed. Do not claim success or repeat it through the UI without checking whether any part already ran."});}
        finally{if(job!=null)agents.Jobs.Dismiss(job);if(task!=null)agents.DismissTask(task);}
    }
    private static string ControlRequest(CompanionToolContext context) => context.UserWords +
        (context.AttachedFilePaths.Count == 0 ? "" : "\nUser-attached files (use only as requested):\n" + string.Join("\n", context.AttachedFilePaths));
    private static bool TryUnsupported(string result){try{using var json=JsonDocument.Parse(result.Trim().Trim('`').Trim().Replace("json\n",""));return json.RootElement.GetProperty("outcome").GetString()=="unsupported"&&json.RootElement.TryGetProperty("did_act",out var acted)&&acted.ValueKind==JsonValueKind.False;}catch{return false;}}
    private static async Task<string> Drive(string request,CancellationToken ct){
        ct.ThrowIfCancellationRequested();var drive=HeyClicky.App.Drive.ClickyTakeOverController.Current;
        if(drive==null)return JsonSerializer.Serialize(new{status="unavailable",message="Computer control is not ready. No job or app action was started."});
        if(drive.IsDriving)return JsonSerializer.Serialize(new{status="foreground_active",message="Cody is already controlling the computer. Do not start a second job or repeat the action."});
        string result=await drive.HandleUserToolAsync("offer_screen_takeover",JsonSerializer.Serialize(new{goal=request,line="I'll do that now."}),request);
        return JsonSerializer.Serialize(new{status="foreground_control",message="No background job was created. Computer control or its existing permission card handles this action now. Follow that result; do not launch a helper or claim completion yet.",result});
    }
}
