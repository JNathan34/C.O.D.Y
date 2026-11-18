using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.App.Services;
using HeyClicky.App.Settings;
using HeyClicky.Core.Browser;
using HeyClicky.Core.Tools;

namespace HeyClicky.App.Cody;

internal static class CodyMentions
{
    private sealed record Entry(string Id, string Name, string Kind, string Description, string Icon, string Target, string Logo = null);

    private static bool CanUseAgent(AppHost host) =>
        host.Services.Auth.IsSignedIn && !CodyMemoryPolicy.LocalOnly && CodyAgentUsage.Enabled;

    private static async Task RefreshPlugins(AppHost host)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var catalog = await host.Real.Agents.ListIntegrationsAsync(timeout.Token);
        ConnectedApps.SetCatalog(catalog);
    }

    internal static async Task<object> List(AppHost host)
    {
        if (CanUseAgent(host) && ConnectedApps.Catalog == null)
        {
            try { await RefreshPlugins(host); }
            catch { /* Local and installed capabilities remain available. */ }
        }
        return Available(host).Select(entry => new
        {
            id = entry.Id, name = entry.Name, kind = entry.Kind == "computer" ? "tool" : entry.Kind,
            description = entry.Description, icon = entry.Icon, logo = entry.Logo
        }).ToArray();
    }

    internal static async Task<CompanionCapability> Resolve(AppHost host, string id, bool refresh = false)
    {
        if (id.Length > 300) throw new ArgumentException("Invalid capability selection.");
        if ((id.StartsWith("plugin:", StringComparison.Ordinal) || id.StartsWith("skill:", StringComparison.Ordinal)) &&
            !CodyAgentUsage.Enabled)
            throw new InvalidOperationException(CodyAgentUsage.DisabledMessage);
        if (refresh && CanUseAgent(host) && id.StartsWith("plugin:", StringComparison.Ordinal) &&
            !id.StartsWith("plugin:custom:", StringComparison.Ordinal) && id != "plugin:obsidian")
        {
            try { await RefreshPlugins(host); }
            catch { throw new InvalidOperationException("Could not verify this plugin’s connection. Try again or reconnect it in Settings → Plugins."); }
        }
        var entry = Available(host).FirstOrDefault(entry => entry.Id == id)
            ?? throw new InvalidOperationException(id == "tool:computer-use"
                ? "Computer Use is unavailable. Check Settings → Permissions."
                : "This capability is unavailable. Check its connection or permissions in Settings, or remove the mention.");
        return new CompanionCapability(entry.Kind, entry.Name, entry.Target);
    }

    private static IEnumerable<Entry> Available(AppHost host)
    {
        if (CodyMemoryPolicy.LocalOnly || !host.Services.Auth.IsSignedIn)
            yield break;
        if (CodyPermissions.CanUseComputer && host.ClickyDrive?.OffersDrive == true)
            yield return new Entry("tool:computer-use", "Computer Use", "computer", "Use your mouse and keyboard with Windows apps.", "mouse-pointer-2", "");
        if (!CanUseAgent(host))
            yield break;
        var plugins = ConnectedApps.Connected().Where(IsReady).ToArray();
        foreach (var plugin in plugins)
            yield return new Entry("plugin:" + plugin.Id, plugin.DisplayName, "plugin", plugin.Description, "plug",
                plugin.ToolkitSlug ?? plugin.Id, plugin.LogoUrl);

        string bundled = Path.Combine(AppContext.BaseDirectory, "BundledResources");
        string browser = WindowsBrowserPreference.Current?.AutomationTarget().Name;
        if (browser != null && ClickyBrowserBridge.Shared.ConnectedBrowserNames.Contains(browser) &&
            File.Exists(Path.Combine(bundled, "skills", "clicky-browser", "SKILL.md")))
            yield return new Entry("skill:browser", "Browser Control", "skill", "Work in tabs through the connected browser extension.",
                "globe", "clicky-browser");
        if (File.Exists(Path.Combine(bundled, "skills", "vercel-deploy", "SKILL.md")))
            yield return new Entry("skill:vercel-deploy", "Vercel Deploy", "skill", "Deploy an application or website to Vercel.", "cloud", "vercel-deploy");
        foreach (var plugin in plugins)
        {
            string slug = plugin.ToolkitSlug;
            if (!SkillSlug(slug))
                continue;
            if (File.Exists(Path.Combine(bundled, "integration-skills", slug, "SKILL.md")))
                yield return new Entry("skill:" + slug, plugin.DisplayName + " Skill", "skill", "Use the installed workflow for " + plugin.DisplayName + ".",
                    "file-text", slug, plugin.LogoUrl);
        }
        foreach (var skill in PowerUpSkills(host.Real.Agents.CodexHome))
            yield return skill;
    }

    private static bool SkillSlug(string slug) => !string.IsNullOrWhiteSpace(slug) && slug.Length <= 100 &&
        slug.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-');

    private static IReadOnlyList<Entry> PowerUpSkills(string codexHome)
    {
        string root = Path.Combine(codexHome, "power-up-skills");
        if (!Directory.Exists(root)) return Array.Empty<Entry>();
        var skills = new List<Entry>();
        try
        {
            foreach (string directory in Directory.EnumerateDirectories(root))
            {
                string slug = Path.GetFileName(directory);
                if (!SkillSlug(slug)) continue;
                var file = new FileInfo(Path.Combine(directory, "SKILL.md"));
                if (!file.Exists || file.Length > 128_000) continue;
                string name = slug.Replace('-', ' '), description = "Use this installed agent skill.";
                using var reader = file.OpenText();
                if (reader.ReadLine()?.Trim() == "---")
                {
                    for (int i = 0; i < 30 && reader.ReadLine() is string line && line.Trim() != "---"; i++)
                    {
                        int colon = line.IndexOf(':');
                        if (colon <= 0) continue;
                        string value = line[(colon + 1)..].Trim().Trim('"', '\'');
                        if (value.Length == 0 || value is ">" or "|") continue;
                        if (line[..colon] == "name") name = value;
                        if (line[..colon] == "description") description = value;
                    }
                }
                skills.Add(new Entry("skill:power-up:" + slug, name, "skill", description, "file-text", slug));
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return skills;
    }

    private static bool IsReady(AppEntry plugin) =>
        !plugin.Id.StartsWith("custom:", StringComparison.Ordinal) ||
        ConnectorAuth.StateFor(plugin.Id[7..]).Kind is ConnectorSignInKind.SignedIn or ConnectorSignInKind.NotNeeded;
}
