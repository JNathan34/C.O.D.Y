using System;

namespace HeyClicky.Agents.Runtime;

public sealed class CodexProcessNotRunningException : Exception
{
	public CodexProcessNotRunningException(string? detail = null)
		: base(detail ?? "Codex process is not running")
	{
	}
}
