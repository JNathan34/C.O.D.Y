using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using HeyClicky.Agents;

namespace HeyClicky.App.Cody;

internal static class CodyAgentUsage
{
    internal const string DisabledMessage = "Agent usage is off. Turn it on in Settings → Agents to use this feature.";
    private static volatile bool disabled;
    private static bool changing;
    private static string Marker => Path.Combine(CodyPaths.StateRoot, "agent-usage-disabled");

    internal static bool Enabled => !disabled;

    internal static void Load() => disabled = File.Exists(Marker);

    internal static void CheckWorkerRequest(HttpRequestMessage request)
    {
        if (Enabled || request.Method != HttpMethod.Post)
            return;

        // Block new usage at the worker boundary. Status, stop, completion and
        // refunds must still work for jobs that already have a lease.
        string path = request.RequestUri!.AbsolutePath.TrimEnd('/');
        if (path is "/agent/record-agent-launch" or "/codex-thread-launch" or "/proactive-agents/jobs"
            || path.StartsWith("/agent/turn-lease/", StringComparison.Ordinal)
                && (path.EndsWith("/continue", StringComparison.Ordinal)
                    || path.EndsWith("/continue-after-computer-use-consent", StringComparison.Ordinal)))
            throw new InvalidOperationException(DisabledMessage);
    }

    internal static async Task ConfigureAsync(AppHost host, bool enabled)
    {
        if (changing)
            throw new InvalidOperationException("Wait for C.O.D.Y. to finish changing agent usage.");

        changing = true;
        try
        {
            if (enabled)
            {
                if (Enabled)
                    return;
                File.Delete(Marker);
                disabled = false;
                if (host.Services.Auth.IsSignedIn)
                    host.Real.PrewarmAgents();
                return;
            }

            File.WriteAllText(Marker, "disabled");
            disabled = true;
            var agents = host.Real.Agents;
            agents.Routines.Stop();
            CodyIndependentInput.End();
            host.ClickyDrive?.HandleEscape();
            var active = agents.Tasks
                .Where(task => task.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser)
                .Select(task => task.TaskId)
                .ToArray();
            await Task.WhenAll(active.Select(agents.StopAsync));
        }
        finally
        {
            changing = false;
        }
    }
}
