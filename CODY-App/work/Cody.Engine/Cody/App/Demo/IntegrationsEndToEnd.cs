using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using HeyClicky.Agents.Backend;
using HeyClicky.Agents.Runtime;
using HeyClicky.App.Interop;
using HeyClicky.App.Notch.Peek;
using HeyClicky.App.Services;
using HeyClicky.App.Settings;
using HeyClicky.App.UI;
using HeyClicky.App.Wiring;
using HeyClicky.Core.Connectors;
using HeyClicky.Core.Documents;
using HeyClicky.Core.Notch;
using HeyClicky.Core.Settings;
using HeyClicky.Core.Voice;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace HeyClicky.App.Demo;

public sealed class IntegrationsEndToEnd(AppHost host, string outDir, Action<string> say)
{
	private delegate bool EnumProc(nint h, nint l);

	private readonly string mock = Environment.GetEnvironmentVariable("HEYCLICKY_E2E_MOCK_MCP") ?? "http://127.0.0.1:8790";

	private readonly string plainMock = Environment.GetEnvironmentVariable("HEYCLICKY_E2E_PLAIN_MCP") ?? "http://127.0.0.1:8791";

	private readonly HttpClient http = new HttpClient
	{
		Timeout = TimeSpan.FromSeconds(30L)
	};

	private readonly List<Process> browsers = new List<Process>();

	private string urlFile = "";

	private int urlLinesSeen;

	private int passed;

	private int failed;

	private SettingsContent View => NotchSettingsTab.ShownContent;

	private void Check(string name, bool ok, string detail = "")
	{
		if (ok)
		{
			passed++;
		}
		else
		{
			failed++;
		}
		say($"integrations: {(ok ? "PASS" : "FAIL")} {name}{((detail.Length > 0) ? (" (" + detail + ")") : "")}");
	}

	private static Task Wait(int ms)
	{
		return Task.Delay(ms);
	}

	private static async Task<bool> Until(Func<bool> condition, double seconds)
	{
		Stopwatch sw = Stopwatch.StartNew();
		while (sw.Elapsed.TotalSeconds < seconds)
		{
			if (condition())
			{
				return true;
			}
			await Task.Delay(250);
		}
		return condition();
	}

	private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
	{
		int n = VisualTreeHelper.GetChildrenCount(root);
		for (int i = 0; i < n; i++)
		{
			DependencyObject child = VisualTreeHelper.GetChild(root, i);
			yield return child;
			foreach (DependencyObject item in Descendants(child))
			{
				yield return item;
			}
		}
	}

	private TextBlock? FindText(string text, DependencyObject? within = null)
	{
		return Descendants(within ?? View).OfType<TextBlock>().FirstOrDefault((TextBlock t) => t.Text == text);
	}

	private async Task<T?> Find<T>(Func<T?> find) where T : class
	{
		for (int attempt = 0; attempt < 15; attempt++)
		{
			View.UpdateLayout();
			T val = find();
			if (val != null)
			{
				return val;
			}
			await Task.Delay(200);
		}
		return null;
	}

	private async Task<bool> Click(string text, DependencyObject? within = null)
	{
		DependencyObject dependencyObject = await Find(() => FindText(text, within));
		if ((object)dependencyObject == null)
		{
			say($"integrations: no \"{text}\" on screen ({Descendants(within ?? View).OfType<TextBlock>().Count()} texts)");
			return false;
		}
		while ((object)dependencyObject != null)
		{
			if (dependencyObject is Pressable pressable)
			{
				pressable.RaiseClick();
				return true;
			}
			dependencyObject = VisualTreeHelper.GetParent(dependencyObject);
		}
		return false;
	}

	private async Task<bool> ClickInRow(string name, string button)
	{
		Grid grid = await Find(() => Descendants(View).OfType<Grid>().FirstOrDefault((Grid g) => g.Tag is string text && text.StartsWith("connector:", StringComparison.Ordinal) && Descendants(g).OfType<TextBlock>().Any((TextBlock t) => t.Text == name)));
		if ((object)grid == null)
		{
			say($"integrations: no row for {name} ({Descendants(View).OfType<Grid>().Count((Grid g) => g.Tag is string text && text.StartsWith("connector:", StringComparison.Ordinal))} connector rows)");
			return false;
		}
		return await Click(button, grid);
	}

	private async Task Type(string placeholder, string text)
	{
		Control control = await Find(() => (Control?)(((object)Descendants(View).OfType<TextBox>().FirstOrDefault((TextBox b) => b.PlaceholderText == placeholder)) ?? ((object)Descendants(View).OfType<PasswordBox>().FirstOrDefault((PasswordBox b) => b.PlaceholderText == placeholder))));
		if (control is TextBox textBox)
		{
			textBox.Text = text;
		}
		else if (control is PasswordBox passwordBox)
		{
			passwordBox.Password = text;
			List<PasswordBox> list = Descendants(View).OfType<PasswordBox>().ToList();
			say($"integrations: typed into a password box ({list.Count} on screen, loaded={passwordBox.IsLoaded}, same={(object)list.FirstOrDefault() == passwordBox})");
		}
		else
		{
			say("integrations: no field \"" + placeholder + "\"");
		}
	}

	private async Task<JsonObject?> MockState()
	{
		try
		{
			return JsonNode.Parse(await http.GetStringAsync(mock + "/__state")) as JsonObject;
		}
		catch (Exception ex)
		{
			say("integrations: mock state: " + ex.Message);
			return null;
		}
	}

	private static int Int(JsonObject? o, string key)
	{
		if (!(o?[key] is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out var value))
		{
			return 0;
		}
		return value;
	}

	private async Task<int> OpenPendingAuthorizationUrlsAsync()
	{
		if (!File.Exists(urlFile))
		{
			return 0;
		}
		List<string> lines = (from l in File.ReadAllLines(urlFile)
			where l.Trim().Length > 0
			select l).ToList();
		int opened = 0;
		while (urlLinesSeen < lines.Count)
		{
			string url = lines[urlLinesSeen].Trim();
			opened++;
			if (Environment.GetEnvironmentVariable("HEYCLICKY_E2E_BROWSER") == "edge")
			{
				string text = new string[2] { "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" }.FirstOrDefault(File.Exists);
				if (text == null)
				{
					say("integrations: no msedge.exe");
				}
				else
				{
					string text2 = Path.Combine(Path.GetTempPath(), "heyclicky-e2e-edge-" + Guid.NewGuid().ToString("N").Substring(0, 8));
					ProcessStartInfo processStartInfo = new ProcessStartInfo(text)
					{
						UseShellExecute = false
					};
					string[] array = new string[6]
					{
						"--user-data-dir=" + text2,
						"--guest",
						"--no-first-run",
						"--no-default-browser-check",
						"--new-window",
						url
					};
					foreach (string item in array)
					{
						processStartInfo.ArgumentList.Add(item);
					}
					Process process = Process.Start(processStartInfo);
					if (process != null)
					{
						browsers.Add(process);
						say($"integrations: opened the sign-in in msedge --guest (pid {process.Id})");
					}
				}
			}
			else
			{
				try
				{
					using HttpClient browser = new HttpClient(new HttpClientHandler
					{
						AllowAutoRedirect = true
					})
					{
						Timeout = TimeSpan.FromSeconds(30L)
					};
					string text3 = await browser.GetStringAsync(url);
					say($"integrations: followed the sign-in ({new Uri(url).Host}:{new Uri(url).Port}) → {((text3.Contains("Signed in", StringComparison.Ordinal) || text3.Contains("Authentication complete", StringComparison.OrdinalIgnoreCase)) ? "callback page" : (text3.Length + " chars"))}");
				}
				catch (Exception ex)
				{
					say("integrations: browser step: " + ex.Message);
				}
			}
			urlLinesSeen++;
		}
		return opened;
	}

	private async Task<bool> SignInFlowAsync(string id, double seconds)
	{
		Stopwatch sw = Stopwatch.StartNew();
		while (sw.Elapsed.TotalSeconds < seconds)
		{
			await OpenPendingAuthorizationUrlsAsync();
			ConnectorSignInKind kind = ConnectorAuth.StateFor(id).Kind;
			bool flag;
			switch (kind)
			{
			case ConnectorSignInKind.SignedIn:
				return true;
			case ConnectorSignInKind.SignInUnavailable:
			case ConnectorSignInKind.Failed:
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag)
			{
				say($"integrations: sign-in ended {kind}: {ConnectorAuth.StateFor(id).Text}");
				return false;
			}
			await Task.Delay(300);
		}
		return false;
	}

	private void CloseBrowsers()
	{
		foreach (Process browser in browsers)
		{
			try
			{
				if (!browser.HasExited)
				{
					browser.Kill(entireProcessTree: true);
					say($"integrations: closed msedge (pid {browser.Id})");
				}
			}
			catch (Exception ex)
			{
				say($"integrations: close msedge {browser.Id}: {ex.Message}");
			}
		}
		browsers.Clear();
	}

	private CustomConnector? Connector(string name)
	{
		return CustomConnectorStore.Load().FirstOrDefault((CustomConnector c) => c.Name == name);
	}

	private async Task<CustomConnector?> AddThroughEditorAsync(string name, string url, string auth, string? apiKey = null, string? clientId = null, string? headers = null)
	{
		await Click("Add custom connector");
		await Wait(400);
		await Type("e.g. Meta Ads", name);
		await Type("e.g. https://mcp.example.com/mcp", url);
		await Click(auth);
		await Wait(200);
		if (apiKey != null)
		{
			await Type("Paste your key", apiKey);
		}
		if (clientId != null || headers != null)
		{
			await Click("Advanced");
			await Wait(250);
			if (clientId != null)
			{
				await Type("e.g. 123456789012345", clientId);
			}
			if (headers != null)
			{
				await Type("e.g. X-Api-Key: …", headers);
			}
		}
		await Snapshot.SaveAsync(View, "integrations-editor-" + name.Replace(' ', '-').ToLowerInvariant());
		await Click("Add connector");
		await Wait(600);
		return Connector(name);
	}

	public async Task<bool> RunAsync()
	{
		RealStack real = host.Real;
		urlFile = Path.Combine(outDir, "auth-urls.txt");
		File.WriteAllText(urlFile, "");
		Environment.SetEnvironmentVariable("HEYCLICKY_DEV_AUTH_URL_FILE", urlFile);
		Environment.SetEnvironmentVariable("HEYCLICKY_E2E_NO_BROWSER", "1");
		JsonObject jsonObject = await MockState();
		Check("mock MCP/OAuth server is up", jsonObject != null, mock);
		if (jsonObject == null)
		{
			return false;
		}
		foreach (CustomConnector item in from c in CustomConnectorStore.Load()
			where c.Name.StartsWith("Mock ", StringComparison.Ordinal)
			select c)
		{
			CustomConnectorStore.Remove(item.Id);
			ConnectorAuth.Removed(item.Id);
		}
		string originalVault = real.Core.Settings.Current.ObsidianVaultPath;
		host.OpenSettings(NotchSettingsSection.Integrations);
		await Wait(2500);
		await Snapshot.SaveAsync(View, "integrations-page");
		IntegrationsEndToEnd integrationsEndToEnd = this;
		AgentIntegrationCatalog? catalog = ConnectedApps.Catalog;
		integrationsEndToEnd.Check("catalog loaded with remote logos", (object)catalog != null && catalog.Integrations.Count > 0, $"{ConnectedApps.Catalog?.Integrations.Count ?? 0} apps");
		string cache = AppPaths.Combine("logo-cache");
		await Until(() => Directory.Exists(cache) && Directory.GetFiles(cache).Length != 0, 15.0);
		Check("remote catalog logos cached on disk", Directory.Exists(cache) && Directory.GetFiles(cache).Length != 0, $"{(Directory.Exists(cache) ? Directory.GetFiles(cache).Length : 0)} files");
		JsonObject before = await MockState();
		CustomConnector oauth = await AddThroughEditorAsync("Mock Tasks", mock + "/mcp", "Sign in with browser");
		Check("editor saved the browser sign-in connector", (object)oauth != null && oauth.IsRemote && !oauth.HasApiKey);
		if ((object)oauth != null)
		{
			bool signedIn = await SignInFlowAsync(oauth.Id, 120.0);
			JsonObject jsonObject2 = await MockState();
			Check("codex browser sign-in completed", signedIn, ConnectorAuth.StateFor(oauth.Id).ToString());
			Check("the server registered a client dynamically", Int(jsonObject2, "registrations") > Int(before, "registrations"));
			Check("sign-in asked only for the resource's scopes", jsonObject2?["lastScope"]?.ToString() == "mcp:read mcp:write", jsonObject2?["lastScope"]?.ToString() ?? "none");
			string path = Path.Combine(real.Agents.CodexHome, ".credentials.json");
			Check("codex stored the token (file store)", File.Exists(path) && File.ReadAllText(path).Contains("/mcp", StringComparison.Ordinal));
			await Until(() => Connector("Mock Tasks")?.DerivedCapabilityDescription != null, 20.0);
			Check("capability one-liner from tools/list", (Connector("Mock Tasks")?.DerivedCapabilityDescription)?.StartsWith("Mock Tasks: find, create, and update", StringComparison.Ordinal) ?? false, Connector("Mock Tasks")?.DerivedCapabilityDescription ?? "none");
			IReadOnlyDictionary<string, string> dictionary = await real.Agents.ListMcpServerAuthStatusesAsync();
			Check("app-server reports the server as signed in", dictionary.GetValueOrDefault(oauth.ServerKey) == "oAuth", dictionary.GetValueOrDefault(oauth.ServerKey) ?? "missing");
			await Wait(800);
			await Snapshot.SaveAsync(View, "integrations-signed-in");
			CloseBrowsers();
		}
		CustomConnector keyed = await AddThroughEditorAsync("Mock Key", mock + "/mcp-key", "API key", "mock-api-key-123");
		Check("editor saved the API-key connector", (object)keyed != null && keyed.HasApiKey && keyed.UsesPlainBearerToken);
		if ((object)keyed != null)
		{
			await Until(() => ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.NotNeeded, 20.0);
			Check("API key verified by the server", ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.NotNeeded, ConnectorAuth.StateFor(keyed.Id).ToString());
			await ClickInRow("Mock Key", "Edit");
			await Wait(500);
			await Type("Paste your key", "wrong-key");
			await Wait(300);
			await Click("Save changes");
			await Until(() => ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.TokenRejected, 20.0);
			bool flag = ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.TokenRejected;
			if (flag)
			{
				flag = (object)(await Find(() => FindText("Edit token"))) != null;
			}
			Check("a refused key reads Token rejected with Edit token", flag);
			await Snapshot.SaveAsync(View, "integrations-token-rejected");
		}
		CustomConnector headered = await AddThroughEditorAsync("Mock Header", plainMock + "/mcp-header", "None", null, null, "X-Api-Key: mock-header-secret");
		IntegrationsEndToEnd integrationsEndToEnd2 = this;
		int ok;
		if ((object)headered != null)
		{
			IReadOnlyList<string> headerNames = headered.HeaderNames;
			if (headerNames != null && headerNames.Count == 1)
			{
				ok = ((CustomConnectorStore.ReadSecrets(headered.Id).Headers.GetValueOrDefault("X-Api-Key") == "mock-header-secret") ? 1 : 0);
				goto IL_1035;
			}
		}
		ok = 0;
		goto IL_1035;
		IL_121c:
		IntegrationsEndToEnd integrationsEndToEnd3;
		int ok2;
		integrationsEndToEnd3.Check("header goes to the runtime as an env var reference", (byte)ok2 != 0);
		goto IL_129f;
		IL_129f:
		CustomConnector client = await AddThroughEditorAsync("Mock Client", mock + "/mcp", "Sign in with browser", null, "preregistered-client");
		Check("editor saved the client-id connector", client?.UsesAppSideOAuth ?? false);
		if ((object)client != null)
		{
			Check("app-side sign-in (client id, PKCE, loopback 48611) completed", await SignInFlowAsync(client.Id, 90.0), ConnectorAuth.StateFor(client.Id).ToString());
			CustomConnectorSecrets secrets = CustomConnectorStore.ReadSecrets(client.Id);
			Check("tokens stored encrypted with refresh bookkeeping", (secrets.BearerToken?.StartsWith("at-", StringComparison.Ordinal) ?? false) && secrets.RefreshToken != null && secrets.TokenEndpoint != null);
			byte[] bytes = File.ReadAllBytes(AppPaths.Combine("connectors.secrets"));
			IntegrationsEndToEnd integrationsEndToEnd4 = this;
			string bearerToken = secrets.BearerToken;
			integrationsEndToEnd4.Check("secrets file is DPAPI ciphertext", bearerToken != null && !Encoding.UTF8.GetString(bytes).Contains(bearerToken, StringComparison.Ordinal));
			await http.GetStringAsync(mock + "/__expire");
			CustomConnectorStore.StoreSignInTokens(client.Id, new McpOAuthTokens(secrets.BearerToken, secrets.RefreshToken, DateTimeOffset.UtcNow.AddMinutes(1.0)), new Uri(secrets.TokenEndpoint), null);
			int refreshesBefore = Int(await MockState(), "refreshes");
			await real.Agents.EnsureRuntimeReadyAsync();
			CustomConnectorSecrets refreshed = CustomConnectorStore.ReadSecrets(client.Id);
			Check("an expiring token is refreshed before the runtime uses it", Int(await MockState(), "refreshes") > refreshesBefore && refreshed.BearerToken != secrets.BearerToken && refreshed.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(30.0));
			CloseBrowsers();
		}
		if ((object)keyed != null)
		{
			await ClickInRow("Mock Key", "Edit");
			await Wait(500);
			await Type("Paste your key", "mock-api-key-123");
			await Wait(300);
			await Click("Save changes");
			await Until(() => ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.NotNeeded, 20.0);
			Check("a fixed key is accepted again", ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.NotNeeded, ConnectorAuth.StateFor(keyed.Id).ToString());
			ConnectorAuth.Removed(keyed.Id);
			int refreshesBefore = Int(await MockState(), "calls");
			await ConnectorAuth.OnLaunchAsync();
			await Until(() => ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.NotNeeded, 15.0);
			bool flag = ConnectorAuth.StateFor(keyed.Id).Kind == ConnectorSignInKind.NotNeeded;
			if (flag)
			{
				flag = Int(await MockState(), "calls") > refreshesBefore;
			}
			Check("launch-time token check asks the server", flag);
		}
		string vault = Path.Combine(outDir, "Test Vault");
		Directory.CreateDirectory(Path.Combine(vault, ".obsidian"));
		File.WriteAllText(Path.Combine(vault, "Welcome.md"), "# Welcome\n");
		Task.Run(async () =>
		{
			await Task.Delay(2500);
			nint num2 = OwnDialog((string t) => t == "Select Obsidian Vault");
			if (num2 != 0)
			{
				CaptureDesktop("obsidian-picker");
				PostMessage(num2, 16u, 0, 0);
			}
			say("integrations: vault picker " + ((num2 != 0) ? "was open and was closed" : "not found"));
		});
		AgentIntegration agentIntegration = ObsidianVault.Row();
		Check("Obsidian row before a vault", agentIntegration.Status == "not_connected");
		bool flag2 = ObsidianVault.Configure(Native.GetForegroundWindow());
		Check("picker cancelled leaves Obsidian unset", !flag2 && ObsidianVault.PersistedPath == null);
		real.Core.Settings.Update((AppSettings s) =>
		{
			s.ObsidianVaultPath = vault;
		});
		await Wait(500);
		await real.Agents.EnsureRuntimeReadyAsync();
		string text = File.ReadAllText(Path.Combine(real.Agents.CodexHome, "config.toml"));
		Check("vault reaches the runtime (trusted project + brief)", text.Contains(vault.Replace("\\", "\\\\"), StringComparison.OrdinalIgnoreCase) || text.Contains(vault, StringComparison.OrdinalIgnoreCase));
		View.Show(SettingsWindow.Page.Integrations);
		await Wait(1200);
		Check("Obsidian shows as connected", ObsidianVault.Row().Status == "connected" && (object)FindText("Obsidian") != null);
		BrainUserContext brainUserContext = BrainContext.WithLocalApps(BrainUserContext.Empty);
		Check("user_context.custom_connectors filled", brainUserContext.CustomConnectors.Any((CustomConnectorDescription c) => c.Name == "Mock Tasks" && c.Description.Length > 0) && brainUserContext.CustomConnectors.Count >= 4, string.Join("; ", brainUserContext.CustomConnectors.Select((CustomConnectorDescription c) => c.Name)));
		Check("user_context.connected_apps has connectors and obsidian", brainUserContext.ConnectedApps.Contains("obsidian") && brainUserContext.ConnectedApps.Any((string a) => a.StartsWith("custom:", StringComparison.Ordinal)), string.Join(", ", brainUserContext.ConnectedApps));
		if ((object)headered != null)
		{
			await ClickInRow("Mock Header", "Remove");
			await Wait(250);
			await ClickInRow("Mock Header", "Remove");
			await Wait(300);
			bool signedIn = (object)(await Find(() => Descendants(View).OfType<Grid>().FirstOrDefault((Grid g) => g.Tag is string text2 && text2 == "departed:" + headered.IntegrationId))) != null && (object)FindText("HeyClicky no longer has access.") != null;
			await Snapshot.SaveAsync(View, "integrations-departure");
			Check("removed connector shows the departure row", signedIn);
			await Wait(1900);
			Check("departure row leaves after the beat", !Descendants(View).OfType<Grid>().Any((Grid g) => g.Tag is string text2 && text2 == "departed:" + headered.IntegrationId));
		}
		NotchPresenter presenter = host.Services.Presenter as NotchPresenter;
		presenter?.Tabs.Select(NotchTab.Home);
		await Wait(1200);
		Grid root = host.NotchUi.Window.Root;
		Pressable capsule = Descendants(root).OfType<Pressable>().FirstOrDefault((Pressable p) => p.Tag as string == "notch-apps");
		int num = (((object)capsule != null) ? Descendants(capsule).OfType<FrameworkElement>().Count((FrameworkElement e) => e.Tag is string text2 && text2.StartsWith("app:", StringComparison.Ordinal)) : 0);
		Check("Apps pill shows connected logos", num == Math.Min(3, ConnectedApps.Connected().Count) && num > 0, $"{num} logos, {ConnectedApps.Connected().Count} connected");
		await Snapshot.SaveAsync(root, "notch-home-apps-pill");
		capsule?.RaiseClick();
		await Wait(900);
		Check("the pill opens Settings → Integrations", presenter != null && presenter.Tabs.Selected == NotchTab.Settings && View.CurrentPage == SettingsWindow.Page.Integrations);
		string denied = Path.Combine(outDir, "denied-notes.txt");
		File.WriteAllText(denied, "secret");
		RunIcacls($"\"{denied}\" /deny \"{Environment.UserName}\":(R)");
		PageContext pageContext = DocumentText.Extract(denied);
		Check("a file the account can't open reads as access denied", pageContext.AccessDenied);
		real.Core.Settings.Update((AppSettings s) =>
		{
			s.DocumentAccessNoticeSuppressed = false;
		});
		bool raised = real.RaiseDocumentAccessCardForTests(denied);
		await Wait(1200);
		Check("the folder-access card is raised", raised && real.Core.Notch.HasLiveEvent(typeof(NotchLiveEvent.DocumentFolderAccessDenied)));
		CaptureDesktop("folder-access-card");
		Grid root2 = host.NotchUi.Window.Root;
		Task.Run(async () =>
		{
			await Task.Delay(2000);
			nint num2 = OwnDialog((string t) => t.StartsWith("denied-notes", StringComparison.Ordinal) && t.EndsWith("Properties", StringComparison.Ordinal));
			if (num2 != 0)
			{
				CaptureDesktop("folder-access-security-tab");
				PostMessage(num2, 16u, 0, 0);
			}
			say("integrations: Security properties " + ((num2 != 0) ? "opened and closed" : "not found"));
		});
		Check("Give permission is on the card", await Click("Give permission", root2));
		await Wait(3500);
		Check("the card dismissed after the action", !real.Core.Notch.HasLiveEvent(typeof(NotchLiveEvent.DocumentFolderAccessDenied)));
		RunIcacls($"\"{denied}\" /remove:d \"{Environment.UserName}\"");
		try
		{
			File.Delete(denied);
		}
		catch
		{
		}
		foreach (CustomConnector item2 in from c in CustomConnectorStore.Load()
			where c.Name.StartsWith("Mock ", StringComparison.Ordinal)
			select c)
		{
			CustomConnectorStore.Remove(item2.Id);
			ConnectorAuth.Removed(item2.Id);
		}
		real.Core.Settings.Update((AppSettings s) =>
		{
			s.ObsidianVaultPath = originalVault;
		});
		CloseBrowsers();
		Environment.SetEnvironmentVariable("HEYCLICKY_DEV_AUTH_URL_FILE", null);
		presenter?.DismissNotchAgentPeek();
		say($"integrations: {passed} passed, {failed} failed");
		return failed == 0;
		IL_1035:
		integrationsEndToEnd2.Check("editor saved the custom-header connector", (byte)ok != 0);
		if ((object)headered != null)
		{
			await Until(() => Connector("Mock Header")?.DerivedCapabilityDescription != null, 20.0);
			Check("header connector reached with its header", Connector("Mock Header")?.DerivedCapabilityDescription != null);
			await Until(() => ConnectorAuth.StateFor(headered.Id).Kind == ConnectorSignInKind.NotNeeded, 40.0);
			Check("a server without OAuth needs no sign-in (probe)", ConnectorAuth.StateFor(headered.Id).Kind == ConnectorSignInKind.NotNeeded, ConnectorAuth.StateFor(headered.Id).ToString());
			CustomConnectorRegistration customConnectorRegistration = CustomConnectorStore.Registrations().FirstOrDefault((CustomConnectorRegistration r) => r.ServerKey == headered.ServerKey);
			integrationsEndToEnd3 = this;
			if (customConnectorRegistration?.Transport is CustomConnectorTransport.Remote remote)
			{
				IReadOnlyDictionary<string, string> headerEnvironmentVariables = remote.HeaderEnvironmentVariables;
				if (headerEnvironmentVariables != null && headerEnvironmentVariables.Count == 1)
				{
					ok2 = (customConnectorRegistration.Environment.Values.Contains("mock-header-secret") ? 1 : 0);
					goto IL_121c;
				}
			}
			ok2 = 0;
			goto IL_121c;
		}
		goto IL_129f;
	}

	private static void RunIcacls(string args)
	{
		using Process process = Process.Start(new ProcessStartInfo("icacls.exe", args)
		{
			CreateNoWindow = true,
			UseShellExecute = false,
			RedirectStandardOutput = true
		});
		process?.WaitForExit(10000);
	}

	private void CaptureDesktop(string name)
	{
		string environmentVariable = Environment.GetEnvironmentVariable("HEYCLICKY_E2E_SCREENSHOT");
		if (environmentVariable == null || environmentVariable.Length <= 0 || !File.Exists(environmentVariable))
		{
			return;
		}
		string value = Path.Combine(outDir, "desktop-" + name + ".png");
		using Process process = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File \"{environmentVariable}\" -Path \"{value}\"")
		{
			CreateNoWindow = true,
			UseShellExecute = false
		});
		process?.WaitForExit(15000);
	}

	[DllImport("user32.dll")]
	private static extern bool EnumWindows(EnumProc cb, nint l);

	[DllImport("user32.dll")]
	private static extern uint GetWindowThreadProcessId(nint h, out uint pid);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern int GetWindowText(nint h, StringBuilder s, int n);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern int GetClassName(nint h, StringBuilder s, int n);

	private static nint OwnDialog(Func<string, bool> title)
	{
		nint found = 0;
		EnumWindows((nint h, nint _) =>
		{
			GetWindowThreadProcessId(h, out var pid);
			if (pid != Environment.ProcessId)
			{
				return true;
			}
			StringBuilder stringBuilder = new StringBuilder(64);
			StringBuilder stringBuilder2 = new StringBuilder(256);
			GetClassName(h, stringBuilder, 64);
			GetWindowText(h, stringBuilder2, 256);
			if (stringBuilder.ToString() == "#32770" && title(stringBuilder2.ToString()))
			{
				found = h;
				return false;
			}
			return true;
		}, 0);
		return found;
	}

	[DllImport("user32.dll")]
	private static extern bool PostMessage(nint hwnd, uint msg, nint w, nint l);
}
