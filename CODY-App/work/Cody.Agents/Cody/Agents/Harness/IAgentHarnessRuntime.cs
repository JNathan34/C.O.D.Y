using System;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.Agents.Harness;

public interface IAgentHarnessRuntime
{
	Task RunTurnAsync(AgentHarnessTurn turn, Action<AgentHarnessEvent> emit, CancellationToken ct);

	Task SteerAsync(string harnessThreadId, string text, CancellationToken ct);

	Task InterruptAsync(string harnessThreadId);
}
