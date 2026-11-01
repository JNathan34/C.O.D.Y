using System;

namespace HeyClicky.Agents.Harness;

public sealed class AgentHarnessException(string message, bool notAvailable = false) : Exception(message)
{
	public bool IsNotAvailable { get; } = notAvailable;
}
