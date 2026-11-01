namespace HeyClicky.App.Settings;

public sealed record ConnectorSignInState(ConnectorSignInKind Kind, string? Text = null)
{
	public static readonly ConnectorSignInState Unknown = new ConnectorSignInState(ConnectorSignInKind.Unknown);
}
