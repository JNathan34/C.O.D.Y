namespace HeyClicky.Core.Worker;

public sealed record AppRemoteLinks(string FeatureRequest, string CommunityReddit, string CommunityWhatsApp, string Changelog)
{
	public static readonly AppRemoteLinks BakedInDefaults = new AppRemoteLinks("https://heyclicky.canny.io/feature-requests", "https://www.reddit.com/r/heyclicky_", "https://chat.whatsapp.com/KNyXe8etUWmFCdym6OWW8C?mode=gi_t", "https://heyclicky.com/changelog");
}
