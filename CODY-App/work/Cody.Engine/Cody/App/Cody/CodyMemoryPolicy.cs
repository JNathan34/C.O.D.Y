using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using HeyClicky.Agents;
using HeyClicky.Core.Voice;

namespace HeyClicky.App.Cody;

internal static class CodyMemoryPolicy
{
    internal const string BlockedMessage = "Claude through HeyClicky is paused while Local memory only is on.";
    private static readonly string Marker = Path.Combine(CodyPaths.StateRoot, "local-memory-only");
    internal static bool LocalOnly => File.Exists(Marker);

    internal static void CheckWorkerRequest(HttpRequestMessage request)
    {
        if (!LocalOnly)
            return;

        string path = Uri.UnescapeDataString(request.RequestUri!.AbsolutePath).TrimEnd('/');
        // The service can attach account memory to a normal assistant turn, so
        // blocking the dedicated memory endpoints alone would not isolate it.
        if (InRoute(path, "/me/memory") || InRoute(path, "/brain") || InRoute(path, "/proactive-agents")
            || InRoute(path, "/agent-messages") || InRoute(path, "/codex-thread-launch")
            || (InRoute(path, "/agent") && !InRoute(path, "/agent/integrations")))
            throw new InvalidOperationException(BlockedMessage);
    }

    private static bool InRoute(string path, string root) =>
        path.Equals(root, StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase);

    internal static void Configure(AppHost host, bool localOnly)
    {
        if (localOnly == LocalOnly)
            return;
        if (host.Services.Companion.State != VoiceState.Idle || host.ClickyDrive?.IsDriving == true ||
            host.Real.Agents.Tasks.Any(task => task.Status is AgentTaskStatus.Starting or AgentTaskStatus.Running or AgentTaskStatus.WaitingForUser))
            throw new InvalidOperationException("Finish or stop the current Claude work before changing memory mode.");

        if (localOnly)
        {
            File.WriteAllText(Marker, "local");
            host.Real.Agents.Routines.Stop();
            host.Real.Core.BrainSession.StartFreshSession(host.Real.Core.Auth.UserId, submitPrevious: false);
        }
        else
        {
            File.Delete(Marker);
            if (host.Services.Auth.IsSignedIn)
                host.Real.PrewarmAgents();
        }
    }
}
