using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace HeyClicky.Core.Browser;

public static class ChromiumBrowsers
{
	public const string NativeHostName = "com.cody.browser";

	private static string LocalAppData => Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

	private static string ProgramFiles => Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);

	private static string ProgramFilesX86 => Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

	public static IReadOnlyList<ChromiumBrowser> All { get; } = new _003C_003Ez__ReadOnlyArray<ChromiumBrowser>(new ChromiumBrowser[9]
	{
		new ChromiumBrowser("Chrome", "Google\\Chrome", "Google\\Chrome\\User Data", Installs("Google\\Chrome\\Application\\chrome.exe"), "chrome.exe"),
		new ChromiumBrowser("Chrome Beta", "Google\\Chrome Beta", "Google\\Chrome Beta\\User Data", Installs("Google\\Chrome Beta\\Application\\chrome.exe")),
		new ChromiumBrowser("Chrome Dev", "Google\\Chrome Dev", "Google\\Chrome Dev\\User Data", Installs("Google\\Chrome Dev\\Application\\chrome.exe")),
		new ChromiumBrowser("Chrome Canary", "Google\\Chrome SxS", "Google\\Chrome SxS\\User Data", Installs("Google\\Chrome SxS\\Application\\chrome.exe", userLevel: true, machineLevel: false)),
		new ChromiumBrowser("Chromium", "Chromium", "Chromium\\User Data", Installs("Chromium\\Application\\chrome.exe")),
		new ChromiumBrowser("Brave", "BraveSoftware\\Brave-Browser", "BraveSoftware\\Brave-Browser\\User Data", Installs("BraveSoftware\\Brave-Browser\\Application\\brave.exe"), "brave.exe"),
		new ChromiumBrowser("Edge", "Microsoft\\Edge", "Microsoft\\Edge\\User Data", Installs("Microsoft\\Edge\\Application\\msedge.exe"), "msedge.exe"),
		new ChromiumBrowser("Arc", null, "Packages", Array.Empty<string>(), null, "TheBrowserCompany.Arc_"),
		new ChromiumBrowser("Vivaldi", "Vivaldi", "Vivaldi\\User Data", Installs("Vivaldi\\Application\\vivaldi.exe"), "vivaldi.exe")
	});

	public static IReadOnlyList<string> InstalledNames => (from b in All
		where ExecutablePath(b) != null
		select b.Name).ToList();

	private static IReadOnlyList<string> Installs(string relative, bool userLevel = true, bool machineLevel = true)
	{
		List<string> list = new List<string>();
		if (machineLevel)
		{
			list.Add(Path.Combine(ProgramFiles, relative));
			list.Add(Path.Combine(ProgramFilesX86, relative));
		}
		if (userLevel)
		{
			list.Add(Path.Combine(LocalAppData, relative));
		}
		return list;
	}

	public static string? ExecutablePath(ChromiumBrowser browser)
	{
		foreach (string executable in browser.Executables)
		{
			if (File.Exists(executable))
			{
				return executable;
			}
		}
		string appPathsName = browser.AppPathsName;
		if (appPathsName != null)
		{
			RegistryKey[] array = new RegistryKey[2]
			{
				Registry.CurrentUser,
				Registry.LocalMachine
			};
			foreach (RegistryKey registryKey in array)
			{
				try
				{
					using RegistryKey registryKey2 = registryKey.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + appPathsName);
					object obj = registryKey2?.GetValue(null);
					string path = obj as string;
					if (path != null && File.Exists(path.Trim('"')) && browser.Executables.Any((string e) =>
					{
						string fileName = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(e)));
						return fileName != null && path.Contains(fileName, StringComparison.OrdinalIgnoreCase);
					}))
					{
						return path.Trim('"');
					}
				}
				catch
				{
				}
			}
		}
		string packageFamilyPrefix = browser.PackageFamilyPrefix;
		if (packageFamilyPrefix != null)
		{
			try
			{
				if (Directory.EnumerateDirectories(Path.Combine(LocalAppData, "Packages"), packageFamilyPrefix + "*").Any())
				{
					string text = Path.Combine(LocalAppData, "Microsoft\\WindowsApps\\Arc.exe");
					return File.Exists(text) ? text : "";
				}
			}
			catch
			{
			}
		}
		return null;
	}

	public static IReadOnlyList<ChromiumBrowser> InstalledOrUsed()
	{
		return All.Where((ChromiumBrowser b) => ExecutablePath(b) != null || (b.PackageFamilyPrefix == null && Directory.Exists(Path.Combine(LocalAppData, b.UserDataFolder)))).ToList();
	}

	public static (string Name, string Executable)? Preferred()
	{
		foreach (ChromiumBrowser item in All)
		{
			string text = ExecutablePath(item);
			if (text != null && text.Length > 0)
			{
				return (item.Name, text);
			}
		}
		return null;
	}

	public static JsonObject Manifest(string helperPath, IReadOnlyList<string> extensionIds)
	{
		return new JsonObject
		{
			["name"] = "com.cody.browser",
			["description"] = "CODY browser connection",
			["path"] = helperPath,
			["type"] = "stdio",
			["allowed_origins"] = new JsonArray(((IEnumerable<string>)extensionIds).Select((Func<string, JsonNode>)((string id) => "chrome-extension://" + id + "/")).ToArray())
		};
	}

	public static void Register(string manifestPath, string helperPath, IReadOnlyList<string> extensionIds, RegistryKey? registryRoot = null)
	{
		Directory.CreateDirectory(Path.GetDirectoryName(manifestPath));
		string contents = Manifest(helperPath, extensionIds).ToJsonString(new JsonSerializerOptions
		{
			WriteIndented = true
		});
		string text = manifestPath + ".tmp";
		File.WriteAllText(text, contents);
		File.Move(text, manifestPath, overwrite: true);
		List<ChromiumBrowser> list = InstalledOrUsed().ToList();
		if (!list.Contains(All[0]))
		{
			list.Insert(0, All[0]);
		}
		using RegistryKey registryKey = ((registryRoot == null) ? Registry.CurrentUser.CreateSubKey("Software") : null);
		RegistryKey registryKey2 = registryRoot ?? registryKey;
		foreach (ChromiumBrowser item in list)
		{
			string registryPath = item.RegistryPath;
			if (registryPath != null)
			{
				using RegistryKey registryKey3 = registryKey2.CreateSubKey(registryPath + "\\NativeMessagingHosts\\com.cody.browser");
				registryKey3.SetValue(null, manifestPath, RegistryValueKind.String);
			}
		}
	}

	public static void Unregister(string manifestPath, RegistryKey? registryRoot = null)
	{
		using RegistryKey registryKey = ((registryRoot == null) ? Registry.CurrentUser.OpenSubKey("Software", writable: true) : null);
		RegistryKey registryKey2 = registryRoot ?? registryKey;
		if (registryKey2 != null)
		{
			foreach (ChromiumBrowser item in All)
			{
				string registryPath = item.RegistryPath;
				if (registryPath != null)
				{
					try
					{
						registryKey2.DeleteSubKeyTree(registryPath + "\\NativeMessagingHosts\\com.cody.browser", throwOnMissingSubKey: false);
					}
					catch
					{
					}
				}
			}
		}
		try
		{
			File.Delete(manifestPath);
		}
		catch
		{
		}
	}

	public static bool IsRegistered(string manifestPath, RegistryKey? registryRoot = null)
	{
		try
		{
			using RegistryKey registryKey = ((registryRoot == null) ? Registry.CurrentUser.OpenSubKey("Software") : null);
			using RegistryKey registryKey2 = (registryRoot ?? registryKey)?.OpenSubKey(All[0].RegistryPath + "\\NativeMessagingHosts\\com.cody.browser");
			return string.Equals(registryKey2?.GetValue(null) as string, manifestPath, StringComparison.OrdinalIgnoreCase);
		}
		catch
		{
			return false;
		}
	}
}
