using System;

namespace HeyClicky.Agents.Runtime;

public sealed class CodexRpcException(int code, string message, string method) : Exception($"Codex server error [{code}] on {method}: {message}")
{
	public int Code { get; } = code;

	public string ServerMessage { get; } = message;

	public string Method { get; } = method;

	public bool IsMissingRollout => ServerMessage.Contains("no rollout found", StringComparison.OrdinalIgnoreCase);
}
