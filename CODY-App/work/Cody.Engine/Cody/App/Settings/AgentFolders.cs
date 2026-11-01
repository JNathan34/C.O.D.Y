using System;
using System.IO;

namespace HeyClicky.App.Settings;

public static class AgentFolders
{
	public static string Default => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CODY","Agents");

	internal static string PreviousDefault => AppPaths.Combine("Clickys");

	public static string LegacyDocuments => AppPaths.DocumentsRoot;

	public static string Abbreviate(string path)
	{
		string folderPath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
		if (!path.StartsWith(folderPath, StringComparison.OrdinalIgnoreCase))
		{
			return path;
		}
		int length = folderPath.Length;
		return "~" + path.Substring(length, path.Length - length);
	}
}
