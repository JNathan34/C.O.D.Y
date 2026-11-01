using System;

namespace HeyClicky.Core.Connectors;

public sealed class McpOAuthException(McpOAuthFailure failure, string message) : Exception(message)
{
	public McpOAuthFailure Failure { get; } = failure;
}
