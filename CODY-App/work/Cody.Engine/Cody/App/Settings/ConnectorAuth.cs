using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents;
using HeyClicky.Agents.Runtime;
using HeyClicky.Core.Connectors;
using HeyClicky.Core.Telemetry;

namespace HeyClicky.App.Settings;

public static class ConnectorAuth
{
	private static readonly HttpClient Http = new HttpClient(new SocketsHttpHandler
	{
		PooledConnectionLifetime = TimeSpan.FromMinutes(5L),
		ConnectTimeout = TimeSpan.FromSeconds(10L)
	})
	{
		Timeout = TimeSpan.FromSeconds(60L)
	};

	private static readonly ConcurrentDictionary<string, ConnectorSignInState> states = new ConcurrentDictionary<string, ConnectorSignInState>();

	private static readonly ConcurrentDictionary<string, Guid> revisions = new ConcurrentDictionary<string, Guid>();

	private static readonly ConcurrentDictionary<string, byte> probeOnlyServerKeys = new ConcurrentDictionary<string, byte>();

	private static AgentService? agents;

	private static Action<string>? openBrowser;

	private static Action? browserReturned;

	private static bool awaitingReturn;

	private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5L);

	public const string BrowserSignInUnavailableText = "This server only signs in clients it has approved, so HeyClicky can't log in through the browser. Add its client ID or an access token under Edit.";

	public static event Action? Changed;

	public static void Initialize(AgentService service, Action<string> open, Action returned)
	{
		agents = service;
		openBrowser = open;
		browserReturned = returned;
		service.McpOAuthLoginCompleted += OnCodexLoginCompleted;
		service.McpServerStartupStatus += OnServerStartupStatus;
		service.CustomConnectorTokensExpiring = AnyTokenExpiring;
		service.RefreshCustomConnectorTokensAsync = RefreshExpiredTokensAsync;
		CustomConnectorStore.Changed += () =>
		{
			Changed?.Invoke();
		};
		CustomConnectorStore.Updated += () =>
		{
			Changed?.Invoke();
		};
	}

	public static ConnectorSignInState StateFor(string id)
	{
		return states.GetValueOrDefault(id, ConnectorSignInState.Unknown);
	}

	private static void Set(string id, ConnectorSignInState state)
	{
		ConnectorSignInState? valueOrDefault = states.GetValueOrDefault(id);
		states[id] = state;
		if (valueOrDefault != state)
		{
			Log.Info("connectors", $"sign-in {id}: {state.Kind}{((state.Text == null) ? "" : (" — " + state.Text))}");
			Changed?.Invoke();
		}
	}

	public static bool NeedsReconnect(string id)
	{
		switch (StateFor(id).Kind)
		{
		case ConnectorSignInKind.SignInUnavailable:
		case ConnectorSignInKind.NeedsSignIn:
		case ConnectorSignInKind.AwaitingBrowser:
		case ConnectorSignInKind.Failed:
		case ConnectorSignInKind.TokenRejected:
			return true;
		default:
			return false;
		}
	}

	private static bool Current(string id, Guid revision)
	{
		if (revisions.GetValueOrDefault(id) == revision)
		{
			return (object)CustomConnectorStore.Get(id) != null;
		}
		return false;
	}

	private static Uri? ServerUrl(CustomConnector c)
	{
		if (!Uri.TryCreate(c.Url?.Trim(), UriKind.Absolute, out Uri result))
		{
			return null;
		}
		return result;
	}

	public static void AfterSave(string id)
	{
		CustomConnector customConnector = CustomConnectorStore.Get(id);
		if ((object)customConnector == null)
		{
			return;
		}
		revisions[id] = Guid.NewGuid();
		ConnectorSignInState value;
		if (customConnector.HasApiKey)
		{
			if (customConnector.UsesAppSideOAuth)
			{
				states.TryRemove(id, out value);
			}
			else
			{
				VerifyToken(id, userInitiated: true);
			}
		}
		else
		{
			states.TryRemove(id, out value);
		}
		if (customConnector.IsRemote && !customConnector.HasApiKey)
		{
			ProbeAfterSaveAsync(id);
		}
		DeriveCapabilities(id);
		Changed?.Invoke();
	}

	public static void Removed(string id)
	{
		revisions[id] = Guid.NewGuid();
		states.TryRemove(id, out ConnectorSignInState _);
		Changed?.Invoke();
	}

	public static void SignIn(string id, bool probeOnly = false)
	{
		CustomConnector customConnector = CustomConnectorStore.Get(id);
		if ((object)customConnector == null || !customConnector.IsRemote || agents == null || StateFor(id).Kind == ConnectorSignInKind.AwaitingBrowser)
		{
			return;
		}
		if (!probeOnly)
		{
			ClickyAnalytics.TrackProductEvent("custom_connector_action", null, null, new JsonObject
			{
				["action"] = "sign_in",
				["connector_id"] = id
			});
		}
		if (customConnector.UsesAppSideOAuth)
		{
			if (!probeOnly)
			{
				AppSideSignInAsync(customConnector);
			}
		}
		else
		{
			CodexSignInAsync(customConnector, probeOnly);
		}
	}

	private static async Task CodexSignInAsync(CustomConnector c, bool probeOnly)
	{
		string id = c.Id;
		Set(id, new ConnectorSignInState(probeOnly ? ConnectorSignInKind.Checking : ConnectorSignInKind.AwaitingBrowser));
		if (probeOnly)
		{
			probeOnlyServerKeys[c.ServerKey] = 0;
		}
		else
		{
			probeOnlyServerKeys.TryRemove(c.ServerKey, out var _);
		}
		Uri url = ServerUrl(c);
		try
		{
			if (!(await EnsureRuntimeAsync().ConfigureAwait(continueOnCapturedContext: false)))
			{
				if (probeOnly)
				{
					Set(id, ConnectorSignInState.Unknown);
					return;
				}
				Log.Info("connectors", c.Name + ": runtime unavailable, signing in with HeyClicky's own OAuth client");
				states.TryRemove(id, out ConnectorSignInState _);
				await AppSideSignInAsync(c).ConfigureAwait(continueOnCapturedContext: false);
				return;
			}
			IReadOnlyList<string> readOnlyList = ((probeOnly || (object)url == null) ? null : (await McpOAuth.ResourceDeclaredScopesAsync(Http, url).ConfigureAwait(continueOnCapturedContext: false)));
			IReadOnlyList<string> scopes = readOnlyList;
			if ((object)CustomConnectorStore.Get(id) == null)
			{
				return;
			}
			string text = await agents.StartMcpOAuthLoginAsync(c.ServerKey, scopes, probeOnly ? 5 : 300).ConfigureAwait(continueOnCapturedContext: false);
			if ((object)CustomConnectorStore.Get(id) != null)
			{
				CustomConnectorStore.UpdateQuietly(id, (CustomConnector x) => x with
				{
					BrowserSignInSupport = "supported"
				});
				if (probeOnly)
				{
					Set(id, new ConnectorSignInState(ConnectorSignInKind.NeedsSignIn));
				}
				else if (text != null)
				{
					OpenAuthorization(text, c.Name);
				}
				else
				{
					OnCodexLoginCompleted(c.ServerKey, ok: true, null);
				}
			}
		}
		catch (Exception ex)
		{
			if ((object)CustomConnectorStore.Get(id) == null)
			{
				return;
			}
			string text2 = ex.Message.Trim();
			Log.Warn("connectors", $"{c.Name}: codex sign-in {(probeOnly ? "probe " : "")}failed: {text2}");
			if (IsPermanentRefusal(text2))
			{
				CustomConnectorStore.UpdateQuietly(id, (CustomConnector x) => x with
				{
					BrowserSignInSupport = "unsupported"
				});
				Set(id, new ConnectorSignInState(ConnectorSignInKind.SignInUnavailable, UnavailableText(url)));
			}
			else if (probeOnly)
			{
				Set(id, ConnectorSignInState.Unknown);
			}
			else
			{
				Set(id, new ConnectorSignInState(ConnectorSignInKind.Failed, (text2.Length == 0) ? "Couldn't start the sign-in." : text2));
			}
		}
	}

	private static async Task AppSideSignInAsync(CustomConnector c)
	{
		string id = c.Id;
		Uri url = ServerUrl(c);
		if ((object)url == null)
		{
			return;
		}
		Guid revision = revisions.GetOrAdd(id, (string _) => Guid.NewGuid());
		CustomConnectorSecrets customConnectorSecrets = CustomConnectorStore.ReadSecrets(id);
		object obj;
		if (customConnectorSecrets != null)
		{
			string registeredClientId = customConnectorSecrets.RegisteredClientId;
			if (registeredClientId != null && registeredClientId.Length > 0)
			{
				obj = new McpOAuthClientRegistration(registeredClientId, customConnectorSecrets.RegisteredClientSecret);
				goto IL_00de;
			}
		}
		obj = null;
		goto IL_00de;
		IL_00de:
		McpOAuthClientRegistration existingClient = (McpOAuthClientRegistration)obj;
		Set(id, new ConnectorSignInState(ConnectorSignInKind.AwaitingBrowser));
		try
		{
			string clientId = ((c.TrimmedOAuthClientId.Length > 0) ? c.TrimmedOAuthClientId : existingClient?.ClientId);
			McpOAuthSignInResult result = await McpOAuth.SignInAsync(Http, url, clientId, (Uri auth) =>
			{
				if (Current(id, revision))
				{
					OpenAuthorization(auth.AbsoluteUri, c.Name);
				}
			}).ConfigureAwait(continueOnCapturedContext: false);
			if (!Current(id, revision))
			{
				return;
			}
			McpOAuthClientRegistration registered;
			if (result.RegisteredDynamically)
			{
				registered = result.Client;
			}
			else
			{
				registered = ((c.TrimmedOAuthClientId.Length == 0) ? existingClient : null);
			}
			if ((object)registered != null && registered.ClientSecret == null && existingClient?.ClientId == registered.ClientId)
			{
				registered = existingClient;
			}
			string text = await McpOAuth.VerifyBearerTokenAsync(Http, url, result.Tokens.AccessToken).ConfigureAwait(continueOnCapturedContext: false);
			if (Current(id, revision))
			{
				revisions[id] = revision;
				CustomConnectorStore.StoreSignInTokens(id, result.Tokens, result.TokenEndpoint, registered);
				Set(id, (text == null) ? new ConnectorSignInState(ConnectorSignInKind.SignedIn) : new ConnectorSignInState(ConnectorSignInKind.Failed, ServerRefusalText(text, url)));
				if (text == null)
				{
					DeriveCapabilities(id);
				}
			}
		}
		catch (McpOAuthException ex) when (ex.Failure == McpOAuthFailure.ServerDoesNotRequireOAuth)
		{
			if (Current(id, revision))
			{
				Set(id, new ConnectorSignInState(ConnectorSignInKind.NotNeeded));
			}
		}
		catch (Exception ex2)
		{
			if (Current(id, revision))
			{
				Log.Warn("connectors", c.Name + ": app-side sign-in failed: " + ex2.Message);
				Set(id, (ex2 is McpOAuthException { Failure: McpOAuthFailure.RegistrationFailed }) ? new ConnectorSignInState(ConnectorSignInKind.SignInUnavailable, UnavailableText(url)) : new ConnectorSignInState(ConnectorSignInKind.Failed, ex2.Message));
			}
		}
		finally
		{
			FinishBrowserReturn();
		}
	}

	private static void OpenAuthorization(string url, string name)
	{
		Log.Info("connectors", name + ": authorization page → browser");
		awaitingReturn = true;
		openBrowser?.Invoke(url);
	}

	private static void FinishBrowserReturn()
	{
		if (awaitingReturn)
		{
			awaitingReturn = false;
			browserReturned?.Invoke();
		}
	}

	private static async Task ProbeAfterSaveAsync(string id)
	{
		CustomConnector c = CustomConnectorStore.Get(id);
		if ((object)c == null)
		{
			return;
		}
		if (c.UsesAppSideOAuth)
		{
			SignIn(id);
			return;
		}
		Set(id, new ConnectorSignInState(ConnectorSignInKind.Checking));
		if (!(await EnsureRuntimeAsync().ConfigureAwait(continueOnCapturedContext: false)))
		{
			Uri uri = ServerUrl(c);
			if ((object)uri != null)
			{
				try
				{
					await McpOAuth.DiscoverAsync(Http, uri).ConfigureAwait(continueOnCapturedContext: false);
					Set(id, new ConnectorSignInState(ConnectorSignInKind.NeedsSignIn));
					return;
				}
				catch (McpOAuthException ex) when (ex.Failure == McpOAuthFailure.ServerDoesNotRequireOAuth)
				{
					Set(id, new ConnectorSignInState(ConnectorSignInKind.NotNeeded));
					return;
				}
				catch
				{
					Set(id, ConnectorSignInState.Unknown);
					return;
				}
			}
			Set(id, ConnectorSignInState.Unknown);
			return;
		}
		for (int attempt = 0; attempt < 15; attempt++)
		{
			if ((object)CustomConnectorStore.Get(id) == null)
			{
				return;
			}
			try
			{
				switch ((await agents.ListMcpServerAuthStatusesAsync().ConfigureAwait(continueOnCapturedContext: false)).GetValueOrDefault(c.ServerKey))
				{
				case "notLoggedIn":
				{
					states.TryRemove(id, out ConnectorSignInState _);
					SignIn(id);
					return;
				}
				case "unsupported":
				case "bearerToken":
					Set(id, new ConnectorSignInState(ConnectorSignInKind.NotNeeded));
					return;
				case "oAuth":
					Set(id, new ConnectorSignInState(ConnectorSignInKind.SignedIn));
					return;
				}
			}
			catch (Exception ex2)
			{
				Log.Warn("connectors", "mcpServerStatus/list: " + ex2.Message);
			}
			await Task.Delay(2000).ConfigureAwait(continueOnCapturedContext: false);
		}
		Set(id, ConnectorSignInState.Unknown);
	}

	private static void OnCodexLoginCompleted(string serverKey, bool ok, string? error)
	{
		if (probeOnlyServerKeys.TryRemove(serverKey, out var _))
		{
			return;
		}
		CustomConnector customConnector = CustomConnectorStore.Load().FirstOrDefault((CustomConnector c) => c.ServerKey == serverKey);
		if ((object)customConnector == null)
		{
			return;
		}
		if (ok)
		{
			Set(customConnector.Id, new ConnectorSignInState(ConnectorSignInKind.SignedIn));
			CustomConnectorStore.UpdateQuietly(customConnector.Id, (CustomConnector x) => x with
			{
				BrowserSignInSupport = "supported"
			});
			DeriveCapabilities(customConnector.Id);
			Task.Run(async () =>
			{
				try
				{
					await agents.ReloadMcpServersAfterSignInAsync().ConfigureAwait(continueOnCapturedContext: false);
				}
				catch (Exception ex)
				{
					Log.Warn("connectors", "reload after sign-in: " + ex.Message);
				}
			});
		}
		else
		{
			Set(customConnector.Id, new ConnectorSignInState(ConnectorSignInKind.Failed, string.IsNullOrWhiteSpace(error) ? "The sign-in didn't complete." : error.Trim()));
		}
		FinishBrowserReturn();
	}

	private static void OnServerStartupStatus(string serverKey, string status, string? error)
	{
		CustomConnector customConnector = CustomConnectorStore.Load().FirstOrDefault((CustomConnector c) => c.ServerKey == serverKey);
		if ((object)customConnector == null)
		{
			return;
		}
		ConnectorSignInState connectorSignInState = StateFor(customConnector.Id);
		if (!string.IsNullOrWhiteSpace(error))
		{
			ConnectorSignInKind kind = connectorSignInState.Kind;
			bool flag = ((kind == ConnectorSignInKind.Checking || kind == ConnectorSignInKind.AwaitingBrowser || kind == ConnectorSignInKind.TokenRejected) ? true : false);
			if (!flag && (!customConnector.UsesCodexBrowserSignIn || connectorSignInState.Kind != ConnectorSignInKind.NeedsSignIn))
			{
				Set(customConnector.Id, new ConnectorSignInState(ConnectorSignInKind.Failed, ServerRefusalText(error, ServerUrl(customConnector))));
			}
		}
		else if (status == "ready" && connectorSignInState.Kind == ConnectorSignInKind.Failed)
		{
			Set(customConnector.Id, customConnector.HasApiKey ? new ConnectorSignInState(ConnectorSignInKind.SignedIn) : ConnectorSignInState.Unknown);
		}
	}

	public static async Task RefreshStatesAsync()
	{
		foreach (CustomConnector item in from c in CustomConnectorStore.Load()
			where c.UsesAppSideOAuth
			select c)
		{
			ConnectorSignInKind kind = StateFor(item.Id).Kind;
			if ((kind != ConnectorSignInKind.SignInUnavailable && kind != ConnectorSignInKind.AwaitingBrowser && kind != ConnectorSignInKind.Failed) || 1 == 0)
			{
				Set(item.Id, new ConnectorSignInState(item.HasApiKey ? ConnectorSignInKind.SignedIn : ConnectorSignInKind.NeedsSignIn));
			}
		}
		DeriveMissingCapabilities();
		VerifyTokensIfNeeded();
		List<CustomConnector> codex = (from c in CustomConnectorStore.Load()
			where c.UsesCodexBrowserSignIn
			select c).ToList();
		bool flag = codex.Count == 0;
		if (!flag)
		{
			flag = !(await EnsureRuntimeAsync().ConfigureAwait(continueOnCapturedContext: false));
		}
		if (flag)
		{
			return;
		}
		IReadOnlyDictionary<string, string> dictionary;
		try
		{
			dictionary = await agents.ListMcpServerAuthStatusesAsync().ConfigureAwait(continueOnCapturedContext: false);
		}
		catch (Exception ex)
		{
			Log.Warn("connectors", "sign-in state refresh failed: " + ex.Message);
			return;
		}
		foreach (CustomConnector item2 in codex)
		{
			ConnectorSignInKind kind = StateFor(item2.Id).Kind;
			if ((kind == ConnectorSignInKind.Checking || kind == ConnectorSignInKind.AwaitingBrowser) ? true : false)
			{
				continue;
			}
			switch (dictionary.GetValueOrDefault(item2.ServerKey))
			{
			case "notLoggedIn":
				if (item2.BrowserSignInSupport == "supported")
				{
					Set(item2.Id, new ConnectorSignInState(ConnectorSignInKind.NeedsSignIn));
				}
				else if (item2.BrowserSignInSupport == "unsupported")
				{
					Set(item2.Id, new ConnectorSignInState(ConnectorSignInKind.SignInUnavailable, UnavailableText(ServerUrl(item2))));
				}
				else
				{
					SignIn(item2.Id, probeOnly: true);
				}
				break;
			case "oAuth":
				Set(item2.Id, new ConnectorSignInState(ConnectorSignInKind.SignedIn));
				break;
			case "unsupported":
			case "bearerToken":
				Set(item2.Id, new ConnectorSignInState(ConnectorSignInKind.NotNeeded));
				break;
			}
		}
	}

	public static async Task OnLaunchAsync()
	{
		await RefreshExpiredTokensAsync(CancellationToken.None).ConfigureAwait(continueOnCapturedContext: false);
		DeriveMissingCapabilities();
		VerifyTokensIfNeeded();
		foreach (CustomConnector item in from c in CustomConnectorStore.Load()
			where c.UsesAppSideOAuth
			select c)
		{
			if (StateFor(item.Id).Kind == ConnectorSignInKind.Unknown)
			{
				Set(item.Id, new ConnectorSignInState(item.HasApiKey ? ConnectorSignInKind.SignedIn : ConnectorSignInKind.NeedsSignIn));
			}
		}
	}

	private static async Task<bool> EnsureRuntimeAsync()
	{
		if (agents == null)
		{
			return false;
		}
		try
		{
			agents.SetCustomConnectors(CustomConnectorStore.Registrations());
			await agents.EnsureRuntimeReadyAsync().ConfigureAwait(continueOnCapturedContext: false);
			return true;
		}
		catch (Exception ex)
		{
			Log.Warn("connectors", "agents' runtime unavailable: " + ex.Message);
			return false;
		}
	}

	public static void VerifyToken(string id, bool userInitiated)
	{
		CustomConnector c = CustomConnectorStore.Get(id);
		if ((object)c == null || !c.UsesPlainBearerToken)
		{
			return;
		}
		Uri url = ServerUrl(c);
		if ((object)url == null)
		{
			return;
		}
		CustomConnectorSecrets secrets = CustomConnectorStore.ReadSecrets(id);
		if (string.IsNullOrEmpty(secrets.BearerToken))
		{
			return;
		}
		Guid revision = revisions.GetOrAdd(id, (string _) => Guid.NewGuid());
		ConnectorSignInState before = StateFor(id);
		Set(id, new ConnectorSignInState(ConnectorSignInKind.Checking));
		Task.Run(async () =>
		{
			McpVerification mcpVerification = await McpProbe.VerifyConnectionAsync(Http, url, secrets.BearerToken, secrets.Headers).ConfigureAwait(continueOnCapturedContext: false);
			if (Current(id, revision))
			{
				if (!(mcpVerification is McpVerification.Reachable reachable))
				{
					if (!(mcpVerification is McpVerification.Unauthorized unauthorized))
					{
						if (mcpVerification is McpVerification.ServerError serverError)
						{
							Set(id, userInitiated ? new ConnectorSignInState(ConnectorSignInKind.Failed, $"{c.Name} answered HTTP {serverError.StatusCode}. Check the server URL, then try again.") : before);
						}
						else
						{
							Set(id, userInitiated ? new ConnectorSignInState(ConnectorSignInKind.Failed, "Couldn't reach " + c.Name + ". Check the server URL and your connection, then try again.") : before);
						}
					}
					else
					{
						Set(id, new ConnectorSignInState(ConnectorSignInKind.TokenRejected, $"{c.Name} rejected the token (HTTP {unauthorized.StatusCode}). Paste a fresh one under Edit."));
					}
				}
				else
				{
					Log.Info("connectors", $"{c.Name} accepted the token ({reachable.ToolCount} tools)");
					Set(id, new ConnectorSignInState(ConnectorSignInKind.NotNeeded));
				}
			}
		});
	}

	public static void VerifyTokensIfNeeded()
	{
		foreach (CustomConnector item in from c in CustomConnectorStore.Load()
			where c.UsesPlainBearerToken
			select c)
		{
			ConnectorSignInKind kind = StateFor(item.Id).Kind;
			if ((kind != ConnectorSignInKind.Checking && kind != ConnectorSignInKind.NotNeeded) || 1 == 0)
			{
				VerifyToken(item.Id, userInitiated: false);
			}
		}
	}

	private static bool AnyTokenExpiring()
	{
		return CustomConnectorStore.Load().Any((CustomConnector c) =>
		{
			if (c.UsesAppSideOAuth && c.HasApiKey)
			{
				CustomConnectorSecrets customConnectorSecrets = CustomConnectorStore.ReadSecrets(c.Id);
				if (customConnectorSecrets != null)
				{
					DateTimeOffset? expiresAt = customConnectorSecrets.ExpiresAt;
					if (expiresAt.HasValue)
					{
						DateTimeOffset valueOrDefault = expiresAt.GetValueOrDefault();
						string refreshToken = customConnectorSecrets.RefreshToken;
						if (refreshToken != null && refreshToken.Length > 0)
						{
							return valueOrDefault - DateTimeOffset.UtcNow < RefreshMargin;
						}
					}
				}
			}
			return false;
		});
	}

	private static async Task<IReadOnlyList<CustomConnectorRegistration>?> RefreshExpiredTokensAsync(CancellationToken ct)
	{
		bool changed = false;
		foreach (CustomConnector c in from customConnector in CustomConnectorStore.Load()
			where customConnector.UsesAppSideOAuth && customConnector.HasApiKey
			select customConnector)
		{
			CustomConnectorSecrets s = CustomConnectorStore.ReadSecrets(c.Id);
			DateTimeOffset? expiresAt = s.ExpiresAt;
			if (!expiresAt.HasValue)
			{
				continue;
			}
			DateTimeOffset valueOrDefault = expiresAt.GetValueOrDefault();
			if (valueOrDefault - DateTimeOffset.UtcNow >= RefreshMargin || string.IsNullOrEmpty(s.RefreshToken) || !Uri.TryCreate(s.TokenEndpoint, UriKind.Absolute, out Uri endpoint))
			{
				continue;
			}
			string text = ((c.TrimmedOAuthClientId.Length > 0) ? c.TrimmedOAuthClientId : s.RegisteredClientId);
			if (string.IsNullOrEmpty(text))
			{
				continue;
			}
			Guid revision = revisions.GetOrAdd(c.Id, (string _) => Guid.NewGuid());
			try
			{
				McpOAuthClientRegistration client = new McpOAuthClientRegistration(text, (c.TrimmedOAuthClientId.Length > 0) ? null : s.RegisteredClientSecret);
				McpOAuthTokens mcpOAuthTokens = await McpOAuth.RefreshAsync(Http, endpoint, client, s.RefreshToken, ct).ConfigureAwait(continueOnCapturedContext: false);
				if (!Current(c.Id, revision))
				{
					continue;
				}
				CustomConnectorStore.StoreSignInTokens(c.Id, mcpOAuthTokens with
				{
					RefreshToken = (mcpOAuthTokens.RefreshToken ?? s.RefreshToken)
				}, endpoint, (c.TrimmedOAuthClientId.Length > 0) ? null : client);
				Log.Info("connectors", c.Name + ": access token refreshed");
				changed = true;
				goto IL_0314;
			}
			catch (Exception ex)
			{
				if (!Current(c.Id, revision))
				{
					continue;
				}
				Log.Warn("connectors", c.Name + ": token refresh failed: " + ex.Message);
				Set(c.Id, new ConnectorSignInState(ConnectorSignInKind.Failed, "Your sign-in expired. Sign in again."));
				goto IL_0314;
			}
			IL_0314:
			endpoint = null;
		}
		return changed ? CustomConnectorStore.Registrations() : null;
	}

	public static void DeriveCapabilities(string id)
	{
		CustomConnector c = CustomConnectorStore.Get(id);
		if ((object)c == null || !c.IsRemote)
		{
			return;
		}
		Uri url = ServerUrl(c);
		if ((object)url == null)
		{
			return;
		}
		CustomConnectorSecrets secrets = CustomConnectorStore.ReadSecrets(id);
		bool codexToken = string.IsNullOrEmpty(secrets.BearerToken) && c.UsesCodexBrowserSignIn && agents != null;
		Task.Run(async () =>
		{
			McpToolCatalog mcpToolCatalog = null;
			for (int attempt = 0; attempt < ((!codexToken || StateFor(id).Kind != ConnectorSignInKind.SignedIn) ? 1 : 5); attempt++)
			{
				if (attempt > 0)
				{
					await Task.Delay(1000).ConfigureAwait(continueOnCapturedContext: false);
				}
				string bearerToken = (codexToken ? McpProbe.CodexStoredAccessToken(url, agents.CodexHome, c.ServerKey) : secrets.BearerToken);
				mcpToolCatalog = await McpProbe.FetchToolCatalogAsync(Http, url, bearerToken, secrets.Headers).ConfigureAwait(continueOnCapturedContext: false);
				if ((object)mcpToolCatalog != null)
				{
					break;
				}
			}
			if ((object)mcpToolCatalog != null)
			{
				CustomConnector customConnector = CustomConnectorStore.Get(id);
				if ((object)customConnector != null)
				{
					string line = McpProbe.DeriveCapabilityDescription(customConnector.Name, mcpToolCatalog.ToolNames);
					if (line != null && !(line == customConnector.DerivedCapabilityDescription))
					{
						Log.Info("connectors", "derived capability line for " + customConnector.Name + ": " + line);
						CustomConnectorStore.UpdateQuietly(id, (CustomConnector x) => x with
						{
							DerivedCapabilityDescription = line
						});
					}
				}
			}
		});
	}

	public static void DeriveMissingCapabilities()
	{
		foreach (CustomConnector item in from c in CustomConnectorStore.Load()
			where c.IsRemote && string.IsNullOrEmpty(c.DerivedCapabilityDescription)
			select c)
		{
			DeriveCapabilities(item.Id);
		}
	}

	public static string UnavailableText(Uri? serverUrl)
	{
		if ((object)serverUrl == null || !serverUrl.Host.EndsWith("facebook.com", StringComparison.OrdinalIgnoreCase))
		{
			return "This server only signs in clients it has approved, so HeyClicky can't log in through the browser. Add its client ID or an access token under Edit.";
		}
		return "Meta only signs in apps it has approved, so HeyClicky can't log in through the browser. Under Edit, paste your Meta app's App ID as the OAuth client ID (the app needs the \"Create & manage ads with ads MCP server\" use case and the redirect URL shown there), then Sign in.";
	}

	private static bool IsPermanentRefusal(string description)
	{
		if (!description.Contains("does not match the authorization server origin", StringComparison.OrdinalIgnoreCase) && !description.Contains("registration", StringComparison.OrdinalIgnoreCase) && !description.Contains("does not support", StringComparison.OrdinalIgnoreCase))
		{
			return description.Contains("unsupported", StringComparison.OrdinalIgnoreCase);
		}
		return true;
	}

	private static string ServerRefusalText(string refusal, Uri? serverUrl)
	{
		string text = Regex.Replace(refusal, "\\s+", " ").Trim();
		string text2 = "The server refused the connection: " + ((text.Length > 200) ? text.Substring(0, 200) : text);
		if ((object)serverUrl != null && serverUrl.Host.EndsWith("facebook.com", StringComparison.OrdinalIgnoreCase))
		{
			text2 += " For Meta Ads, add the \"Create & manage ads with ads MCP server\" use case to your Meta app (it grants ads_mcp_management), then sign in again.";
		}
		return text2;
	}
}
