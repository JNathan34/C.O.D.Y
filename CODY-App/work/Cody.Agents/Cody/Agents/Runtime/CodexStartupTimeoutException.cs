using System;

namespace HeyClicky.Agents.Runtime;

public sealed class CodexStartupTimeoutException(string method) : TimeoutException((method == "initialize") ? "The agent took too long to connect. Your message wasn't sent. Please try again." : "Opening this conversation and its tools took too long. Your message wasn't sent. Please try again.")
{
	public string Method { get; } = method;
}
