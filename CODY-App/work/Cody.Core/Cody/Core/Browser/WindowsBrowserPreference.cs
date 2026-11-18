using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using Windows.Management.Deployment;

namespace HeyClicky.Core.Browser;

public sealed class WindowsBrowserPreference
{
    private sealed record Browser(string Id, string Name, string Executable);
    private sealed record Choice(string Id, string Name);
    private const string SystemDefault = "system";
    private const string FirefoxPackage = "Mozilla.Firefox_n80bbvh6b1yt2";
    private const uint ProtocolAssociation = 0x1000;
    private static readonly Choice DefaultChoice = new(SystemDefault, "Windows default");
    private readonly string path;
    private readonly object gate = new();
    private Choice choice;
    private Browser[] browsers = [];
    private DateTime refreshAfter;

    public static WindowsBrowserPreference? Current { get; private set; }

    public static void Initialize(string stateDirectory) =>
        Current = new WindowsBrowserPreference(Path.Combine(stateDirectory, "preferred-browser.json"));

    private WindowsBrowserPreference(string path)
    {
        this.path = path;
        try { choice = JsonSerializer.Deserialize<Choice>(File.ReadAllText(path)) ?? DefaultChoice; }
        catch (IOException) { choice = DefaultChoice; }
        catch (JsonException) { choice = DefaultChoice; }
    }

    public object Select(string browserId)
    {
        lock (gate)
        {
            Refresh(force: true);
            Browser? browser = Find(browserId);
            Choice selected = browserId == SystemDefault ? DefaultChoice : browser is not null
                ? new Choice(browser.Id, browser.Name)
                : throw new InvalidOperationException("That browser is unavailable. Choose an installed browser.");
            string temporary = path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(selected));
            File.Move(temporary, path, overwrite: true);
            choice = selected;
            return Describe();
        }
    }

    public object Snapshot()
    {
        lock (gate)
        {
            Refresh(force: true);
            return Describe();
        }
    }

    private object Describe() => new
    {
        selectedId = choice.Id,
        selectedName = choice.Name,
        effectiveBrowser = EffectiveBrowser()?.Name,
        message = MissingMessage(),
        browsers = browsers.Select(browser => new { id = browser.Id, name = browser.Name, executable = browser.Executable }).ToArray()
    };

    private Browser? Find(string id) => browsers.FirstOrDefault(browser =>
        browser.Id == id && File.Exists(browser.Executable));

    private string? MissingMessage() => choice.Id != SystemDefault && Find(choice.Id) is null
        ? $"{choice.Name} is unavailable. Choose another browser in C.O.D.Y. Settings > General."
        : null;

    public (string? Name, string? Error) AutomationTarget()
    {
        lock (gate)
        {
            Refresh();
            return (EffectiveBrowser()?.Name, MissingMessage());
        }
    }

    private Browser? EffectiveBrowser()
    {
        if (choice.Id != SystemDefault) return Find(choice.Id);
        string executable = QueryHttpsAssociation(2); // ASSOCSTR_EXECUTABLE
        Browser? browser = browsers.FirstOrDefault(entry => PathsMatch(entry.Executable, executable));
        if (browser is not null) return browser;
        string name = QueryHttpsAssociation(4); // ASSOCSTR_FRIENDLYAPPNAME
        return browsers.FirstOrDefault(entry => string.Equals(entry.Name, name, StringComparison.OrdinalIgnoreCase) ||
            (entry.Id == "edge" && name == "Microsoft Edge") ||
            (entry.Id == "chrome" && name == "Google Chrome") ||
            (entry.Id == "firefox" && name == "Mozilla Firefox"));
    }

    public static bool IsWebUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out Uri? uri) &&
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && !string.IsNullOrEmpty(uri.Host);

    public bool TryOpenOverride(string url)
    {
        lock (gate)
        {
            if (!IsWebUrl(url) || choice.Id == SystemDefault) return false;
            Refresh();
            Browser? browser = Find(choice.Id);
            if (browser is null)
            {
                // A browser update may have moved the executable since discovery.
                Refresh(force: true);
                browser = Find(choice.Id);
            }
            if (browser is null) throw new InvalidOperationException(MissingMessage());
            var launch = new ProcessStartInfo(browser.Executable) { UseShellExecute = false };
            launch.ArgumentList.Add(new Uri(url).AbsoluteUri);
            using var process = Process.Start(launch);
            return true;
        }
    }

    private void Refresh(bool force = false)
    {
        if (!force && DateTime.UtcNow < refreshAfter) return;
        browsers = Discover().OrderBy(browser => browser.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
        refreshAfter = DateTime.UtcNow.AddSeconds(5);
    }

    private static IEnumerable<Browser> Discover()
    {
        var installed = new List<Browser>();
        void Add(string id, string name, string? executable)
        {
            if (string.IsNullOrWhiteSpace(executable) || !Path.IsPathFullyQualified(executable) ||
                !executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(executable) ||
                installed.Any(browser => browser.Id == id || PathsMatch(browser.Executable, executable))) return;
            installed.Add(new Browser(id, name, executable));
        }
        foreach (ChromiumBrowser browser in ChromiumBrowsers.All)
            Add(browser.Name.ToLowerInvariant().Replace(' ', '-'), browser.Name, ChromiumBrowsers.ExecutablePath(browser));

        foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using var appPath = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe");
            Add("firefox", "Firefox", CommandExecutable(appPath?.GetValue(null) as string));
        }
        foreach (var folder in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
            Add("firefox", "Firefox", Path.Combine(Environment.GetFolderPath(folder), @"Mozilla Firefox\firefox.exe"));
        if (!installed.Any(browser => browser.Id == "firefox"))
        {
            try
            {
                foreach (var package in new PackageManager().FindPackagesForUser("", FirefoxPackage))
                    Add("firefox", "Firefox", Path.Combine(package.InstalledLocation.Path, @"VFS\ProgramFiles\Firefox Package Root\firefox.exe"));
            }
            catch (Exception error) when (error is COMException or UnauthorizedAccessException) { }
        }

        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var root = RegistryKey.OpenBaseKey(hive, view);
            using var clients = root.OpenSubKey(@"Software\Clients\StartMenuInternet");
            if (clients is null) continue;
            foreach (string key in clients.GetSubKeyNames())
            {
                using var client = clients.OpenSubKey(key);
                using var command = client?.OpenSubKey(@"shell\open\command");
                string? executable = CommandExecutable(command?.GetValue(null) as string);
                if (executable is null || Path.GetFileName(executable).Equals("iexplore.exe", StringComparison.OrdinalIgnoreCase)) continue;
                string? name = client?.GetValue(null) as string;
                if (string.IsNullOrWhiteSpace(name) || name.StartsWith('@')) continue;
                bool firefox = Path.GetFileName(executable).Equals("firefox.exe", StringComparison.OrdinalIgnoreCase) &&
                    (name.Equals("Firefox", StringComparison.OrdinalIgnoreCase) || name.Equals("Mozilla Firefox", StringComparison.OrdinalIgnoreCase));
                Add(firefox ? "firefox" : "registered:" + key.ToLowerInvariant(), firefox ? "Firefox" : name, executable);
            }
        }
        return installed;
    }

    private static string? CommandExecutable(string? command)
    {
        command = command?.Trim();
        if (string.IsNullOrEmpty(command)) return null;
        if (command.StartsWith('"'))
        {
            int quote = command.IndexOf('"', 1);
            return quote > 1 ? command[1..quote] : null;
        }
        int extension = command.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        return extension > 0 ? command[..(extension + 4)] : null;
    }

    private static bool PathsMatch(string candidate, string other) =>
        string.Equals(candidate, other, StringComparison.OrdinalIgnoreCase);

    private static string QueryHttpsAssociation(uint type)
    {
        uint length = 32768;
        var result = new StringBuilder((int)length);
        return AssocQueryString(ProtocolAssociation, type, "https", null, result, ref length) == 0 ? result.ToString() : "";
    }

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode, EntryPoint = "AssocQueryStringW")]
    private static extern int AssocQueryString(uint flags, uint type, string association, string? extra,
        StringBuilder result, ref uint length);
}
