using System;
using System.Collections.Generic;
using HeyClicky.Core.Voice;

namespace HeyClicky.Core.Tools;

public sealed record CompanionToolContext(string? UserWords, bool Typed, IReadOnlyList<string> AttachedFilePaths, byte[]? ScreenshotJpeg = null, string? HighlightGesture = null, PageReference? Page = null, IReadOnlyList<(string Role, string Text)>? RecentConversation = null)
{
	public static readonly CompanionToolContext None = new CompanionToolContext(null, Typed: false, Array.Empty<string>());
}
