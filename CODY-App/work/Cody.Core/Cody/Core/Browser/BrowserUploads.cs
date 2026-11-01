using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace HeyClicky.Core.Browser;

public static class BrowserUploads
{
	public static readonly string[] RefusedFolders = new string[26]
	{
		".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config\\gcloud", ".config\\gh", ".codex", "AppData\\Roaming\\Microsoft\\Credentials",
		"AppData\\Local\\Microsoft\\Credentials", "AppData\\Local\\Microsoft\\Vault", "AppData\\Roaming\\Microsoft\\Vault", "AppData\\Roaming\\Microsoft\\Protect", "AppData\\Roaming\\Microsoft\\Crypto", "AppData\\Local\\Microsoft\\Windows\\INetCookies", "AppData\\Local\\Google", "AppData\\Local\\Chromium", "AppData\\Local\\BraveSoftware", "AppData\\Local\\Microsoft\\Edge",
		"AppData\\Local\\Vivaldi", "AppData\\Local\\Packages\\TheBrowserCompany.Arc", "AppData\\Roaming\\Mozilla", "AppData\\Local\\Mozilla", "AppData\\Local\\HeyClicky", "AppData\\Roaming\\HeyClicky"
	};

	public static readonly string[] AllowedInsideRefused = new string[2] { "AppData\\Local\\HeyClicky\\Clickys", "AppData\\Local\\HeyClicky\\projects" };

	public const int MaxFiles = 10;

	public const long MaxBytes = 104857600L;

	private static string NeedsPaths => $"upload needs paths: 1 to {10} absolute file paths.";

	public static bool IsSecretFileName(string name)
	{
		string text = name.ToLowerInvariant();
		bool flag = text.StartsWith(".env", StringComparison.Ordinal) || text.EndsWith(".pem", StringComparison.Ordinal) || text.EndsWith(".key", StringComparison.Ordinal);
		if (!flag)
		{
			bool flag2;
			switch (text)
			{
			case ".netrc":
			case "_netrc":
			case ".git-credentials":
			case ".npmrc":
			case ".pypirc":
			case ".pgpass":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			flag = flag2;
		}
		return flag;
	}

	public static (IReadOnlyList<string>? Paths, string? Error) ValidatedPaths(JsonNode? raw, string? home = null, string? dataRoot = null)
	{
		if (!(raw is JsonArray { Count: not 0, Count: <=10 } jsonArray) || jsonArray.Any((JsonNode i) => !(i is JsonValue jsonValue) || jsonValue.GetValueKind() != JsonValueKind.String))
		{
			return (Paths: null, Error: NeedsPaths);
		}
		home = Normalize(home ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
		List<string> list = RefusedFolders.Select((string f) => Path.Combine(home, f)).ToList();
		List<string> list2 = AllowedInsideRefused.Select((string f) => Path.Combine(home, f)).ToList();
		if (dataRoot != null)
		{
			dataRoot = Normalize(dataRoot);
			list.Add(dataRoot);
			list2.Add(Path.Combine(dataRoot, "Clickys"));
		}
		List<string> list3 = new List<string>();
		foreach (JsonNode item in jsonArray)
		{
			string value = item.GetValue<string>();
			string text;
			if (!value.StartsWith("~/", StringComparison.Ordinal) && !value.StartsWith("~\\", StringComparison.Ordinal))
			{
				text = value;
			}
			else
			{
				string? text2 = home;
				string text3 = value;
				text = text2 + "\\" + text3.Substring(2, text3.Length - 2);
			}
			string path = text;
			if (!Path.IsPathFullyQualified(path))
			{
				return (Paths: null, Error: NeedsPaths);
			}
			string path2;
			try
			{
				path2 = Resolve(Normalize(path));
			}
			catch
			{
				return (Paths: null, Error: "No file at " + value + ".");
			}
			if ((list.Any((string r) => IsInside(path2, r)) && !list2.Any((string a) => IsInside(path2, a))) || IsSecretFileName(Path.GetFileName(path2)))
			{
				return (Paths: null, Error: value + " is in a private place (keys, credentials, browser profiles or app settings), so it is never uploaded.");
			}
			if (Directory.Exists(path2))
			{
				return (Paths: null, Error: value + " is not a regular file; upload takes files.");
			}
			FileInfo fileInfo = new FileInfo(path2);
			if (!fileInfo.Exists)
			{
				return (Paths: null, Error: "No file at " + value + ".");
			}
			if ((fileInfo.Attributes & (FileAttributes.Directory | FileAttributes.Device)) != 0)
			{
				return (Paths: null, Error: value + " is not a regular file; upload takes files.");
			}
			try
			{
				using (File.Open(path2, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
				{
				}
			}
			catch
			{
				return (Paths: null, Error: "HeyClicky can't read " + value + ".");
			}
			if (fileInfo.Length > 104857600)
			{
				return (Paths: null, Error: fileInfo.Name + " is larger than 100 MB.");
			}
			list3.Add(path2);
		}
		return (Paths: list3, Error: null);
		static bool IsInside(string text4, string root)
		{
			if (!text4.Equals(root, StringComparison.OrdinalIgnoreCase))
			{
				return text4.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
			}
			return true;
		}
	}

	private static string Normalize(string path)
	{
		return Path.GetFullPath(path).TrimEnd(new char[2] { '\\', '/' });
	}

	private static string Resolve(string path)
	{
		string path2 = new FileInfo(path).ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? path;
		string directoryName = Path.GetDirectoryName(path2);
		if (directoryName != null)
		{
			FileSystemInfo fileSystemInfo = new DirectoryInfo(directoryName).ResolveLinkTarget(returnFinalTarget: true);
			if (fileSystemInfo != null)
			{
				path2 = Path.Combine(fileSystemInfo.FullName, Path.GetFileName(path2));
			}
		}
		return Normalize(path2);
	}

	public static (JsonObject Arguments, string? Error) Validating(JsonObject arguments, string operation, string? home = null, string? dataRoot = null)
	{
		if (operation == "upload")
		{
			var (readOnlyList, item) = ValidatedPaths(arguments["paths"], home, dataRoot);
			if (readOnlyList == null)
			{
				return (Arguments: arguments, Error: item);
			}
			arguments["paths"] = new JsonArray(((IEnumerable<string>)readOnlyList).Select((Func<string, JsonNode>)((string p) => p)).ToArray());
		}
		if (operation == "batch" && arguments["steps"] is JsonArray jsonArray)
		{
			for (int num = 0; num < jsonArray.Count; num++)
			{
				if (jsonArray[num] is JsonObject jsonObject && !(jsonObject["operation"]?.ToString() != "upload"))
				{
					var (readOnlyList2, text) = ValidatedPaths(jsonObject["paths"], home, dataRoot);
					if (readOnlyList2 == null)
					{
						return (Arguments: arguments, Error: $"Step {num + 1}: {text ?? ""} Nothing ran.");
					}
					jsonObject["paths"] = new JsonArray(((IEnumerable<string>)readOnlyList2).Select((Func<string, JsonNode>)((string p) => p)).ToArray());
				}
			}
		}
		return (Arguments: arguments, Error: null);
	}
}
