namespace HeyClicky.Core.Connectors;

public enum McpOAuthFailure
{
	ServerDoesNotRequireOAuth,
	DiscoveryFailed,
	CallbackPortUnavailable,
	AuthorizationDenied,
	StateMismatch,
	RegistrationFailed,
	TokenExchangeFailed,
	TimedOut
}
