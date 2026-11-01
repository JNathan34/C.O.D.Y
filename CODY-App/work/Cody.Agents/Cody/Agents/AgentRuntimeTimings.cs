namespace HeyClicky.Agents;

public sealed record AgentRuntimeTimings(long AppServerSpawnToInitializedMs, long RuntimeReadyMs, long LastLaunchToTurnStartedMs, long LastLaunchToFirstTokenMs, long LastLaunchToFinishedMs);
