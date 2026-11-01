using System;
using System.Collections.Generic;
using System.Linq;

namespace HeyClicky.Core.Auth;

public static class AuthDeepLink
{
	public static readonly string[] Schemes = new string[2] { "clicky", "heyclicky" };

	public static bool IsAuthCallback(Uri uri)
	{
		if (uri.IsAbsoluteUri && Schemes.Contains(uri.Scheme, StringComparer.OrdinalIgnoreCase))
		{
			return string.Equals(uri.Host, "auth-callback", StringComparison.OrdinalIgnoreCase);
		}
		return false;
	}

	public static AuthCallback? Parse(Uri uri)
	{
		if (!IsAuthCallback(uri))
		{
			return null;
		}
		Dictionary<string, string> dictionary = ParseParameters(uri.OriginalString);
		if (!dictionary.TryGetValue("access_token", out var value) || string.IsNullOrEmpty(value))
		{
			return null;
		}
		dictionary.TryGetValue("refresh_token", out var value2);
		int? expiresIn = ((dictionary.TryGetValue("expires_in", out var value3) && int.TryParse(value3, out var result)) ? new int?(result) : ((int?)null));
		dictionary.TryGetValue("referral_code", out var value4);
		return new AuthCallback(value, string.IsNullOrEmpty(value2) ? null : value2, expiresIn, string.IsNullOrEmpty(value4) ? null : value4);
	}

	public static Dictionary<string, string> ParseParameters(string url)
	{
		Dictionary<string, string> dictionary = new Dictionary<string, string>(StringComparer.Ordinal);
		int num = url.IndexOf('?');
		int num2 = url.IndexOf('#');
		if (num >= 0)
		{
			int num3 = ((num2 > num) ? num2 : url.Length);
			AddPairs(url.AsSpan(num + 1, num3 - num - 1), dictionary);
		}
		if (num2 >= 0)
		{
			AddPairs(url.AsSpan(num2 + 1), dictionary);
		}
		return dictionary;
	}

	private static void AddPairs(ReadOnlySpan<char> text, Dictionary<string, string> into)
	{
		MemoryExtensions.SpanSplitEnumerator<char> enumerator = text.Split('&').GetEnumerator();
		while (enumerator.MoveNext())
		{
			Range current = enumerator.Current;
			Range range = current;
			ReadOnlySpan<char> readOnlySpan = text[range.Start..range.End];
			if (!readOnlySpan.IsEmpty)
			{
				int num = readOnlySpan.IndexOf('=');
				ReadOnlySpan<char> readOnlySpan2 = ((num < 0) ? readOnlySpan : readOnlySpan.Slice(0, num));
				ReadOnlySpan<char> readOnlySpan3;
				if (num >= 0)
				{
					int num2 = num + 1;
					readOnlySpan3 = readOnlySpan.Slice(num2, readOnlySpan.Length - num2);
				}
				else
				{
					readOnlySpan3 = ReadOnlySpan<char>.Empty;
				}
				ReadOnlySpan<char> readOnlySpan4 = readOnlySpan3;
				into[Uri.UnescapeDataString(readOnlySpan2.ToString())] = Uri.UnescapeDataString(readOnlySpan4.ToString());
			}
		}
	}
}
