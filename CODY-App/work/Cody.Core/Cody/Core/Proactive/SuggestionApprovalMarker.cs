using System;
using System.Linq;

namespace HeyClicky.Core.Proactive;

public static class SuggestionApprovalMarker
{
	private const string HeaderPrefix = "[Suggested task \"";

	private const string HeaderSuffix = "\" approved]";

	public static string Compose(string title, string description, string agentBrief)
	{
		string text = title.Replace("\n", " ").Replace("\"", "'");
		string text2 = string.Join(" ", from l in description.Split('\n')
			select l.Trim() into l
			where l.Length > 0
			select l);
		_003C_003Ey__InlineArray4<string> buffer = default;
		buffer[0] = "[Suggested task \"" + text + "\" approved]";
		buffer[1] = text2;
		buffer[2] = "";
		buffer[3] = agentBrief;
		return string.Join("\n", (ReadOnlySpan<string?>)buffer);
	}

	public static (string Title, string Description)? Parse(string message)
	{
		string text = message.Trim();
		if (!text.StartsWith("[Suggested task \"", StringComparison.Ordinal))
		{
			return null;
		}
		string[] array = text.Split('\n');
		if (!array[0].EndsWith("\" approved]", StringComparison.Ordinal))
		{
			return null;
		}
		string text2 = array[0];
		int length = "[Suggested task \"".Length;
		int length2 = "\" approved]".Length;
		string item = text2.Substring(length, text2.Length - length2 - length);
		string item2 = string.Join(" ", (from l in array.Skip(1)
			select l.Trim()).TakeWhile((string l) => l.Length > 0));
		return (item, item2);
	}
}
