namespace HeyClicky.Core.Tools;

public sealed record CompanionCapability(string Kind, string Name, string Target)
{
	public bool UsesAgent => Kind is "plugin" or "skill";
}
