using System;
using System.Collections.Generic;

namespace HeyClicky.Agents.Harness;

public sealed record AgentHarnessTurnContext
{
	public required string Instructions { get; init; }

	public IReadOnlyList<AgentHarnessMcpServer> McpServers { get; init; } = Array.Empty<AgentHarnessMcpServer>();

	public IReadOnlyList<string> SkillDirectories { get; init; } = Array.Empty<string>();

	public required string WorkerBaseUrl { get; init; }

	public required string SessionToken { get; init; }

	public string? NotePath { get; init; }

	public bool IsKeptThing { get; init; }

	public bool WritesNoteWithTools { get; init; }

	public bool UsesPlanTool { get; init; }
}
