namespace HeyClicky.Core.Browser;

internal sealed class WindowsBrowserPreference
{
    internal static WindowsBrowserPreference? Current => null;

    internal (string? Name, string? Error) AutomationTarget() => (null, null);
}
