using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Core.Auth;
using HeyClicky.Core.Configuration;

namespace HeyClicky.Core.Worker;

public sealed class AppRemoteConfig
{
	private static readonly Lazy<AppRemoteConfig> shared = new Lazy<AppRemoteConfig>(() => new AppRemoteConfig(Path.Combine(AppBundleConfiguration.AppDataDirectory, "app-config.json")));

	private readonly string cachePath;

	private readonly Lock gate = new Lock();

	private JsonObject? config;

	public static AppRemoteConfig Shared => shared.Value;

	public string? AgentHarnessDefault
	{
		get
		{
			using (gate.EnterScope())
			{
				string value;
				return (config?["agentHarnessDefault"] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out value)) ? value : null;
			}
		}
	}

	public AppRemoteLinks Links
	{
		get
		{
			JsonObject links;
			using (gate.EnterScope())
			{
				links = config?["links"] as JsonObject;
			}
			AppRemoteLinks bakedInDefaults = AppRemoteLinks.BakedInDefaults;
			return new AppRemoteLinks(Link(links, "featureRequest") ?? bakedInDefaults.FeatureRequest, Link(links, "communityReddit") ?? bakedInDefaults.CommunityReddit, Link(links, "communityWhatsApp") ?? bakedInDefaults.CommunityWhatsApp, Link(links, "changelog") ?? bakedInDefaults.Changelog);
		}
	}

	public event Action<string?>? AgentHarnessDefaultFetched;

	public event Action? Changed;

	public AppRemoteConfig(string cachePath)
	{
		this.cachePath = cachePath;
		try
		{
			if (File.Exists(cachePath))
			{
				config = JsonNode.Parse(File.ReadAllText(cachePath)) as JsonObject;
			}
		}
		catch (Exception ex)
		{
			Log.Warn("app-config", "cached config unreadable, using the shipped defaults: " + ex.Message);
		}
	}

	private static string? Link(JsonObject? links, string key)
	{
		string value = default;
		Uri result = default;
		bool flag = links?[key] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out value) && Uri.TryCreate(value, UriKind.Absolute, out result);
		if (flag)
		{
			string scheme = result.Scheme;
			bool flag2 = ((scheme == "https" || scheme == "http") ? true : false);
			flag = flag2;
		}
		if (!flag)
		{
			return null;
		}
		return value;
	}

	public bool Apply(byte[] responseBody)
	{
		JsonObject jsonObject;
		try
		{
			jsonObject = (JsonNode.Parse(responseBody) as JsonObject)?["appConfig"] as JsonObject;
		}
		catch (Exception)
		{
			return false;
		}
		if (jsonObject == null)
		{
			return false;
		}
		string text = jsonObject.ToJsonString();
		bool flag;
		using (gate.EnterScope())
		{
			try
			{
				Directory.CreateDirectory(Path.GetDirectoryName(cachePath));
				AtomicFile.WriteAllBytes(cachePath, Encoding.UTF8.GetBytes(text));
			}
			catch (Exception ex2)
			{
				Log.Warn("app-config", "cache write failed: " + ex2.Message);
			}
			flag = config?.ToJsonString() != text;
			config = (JsonObject)jsonObject.DeepClone();
		}
		string obj = ((jsonObject["agentHarnessDefault"] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out string value)) ? value : null);
		try
		{
			AgentHarnessDefaultFetched?.Invoke(obj);
		}
		catch (Exception ex3)
		{
			Log.Warn("app-config", "agentHarnessDefault: " + ex3.Message);
		}
		if (flag)
		{
			Log.Info("app-config", "fetched a new config");
			Changed?.Invoke();
		}
		return true;
	}

	public async Task RefreshAsync(WorkerClient worker, CancellationToken ct = default(CancellationToken))
	{
		try
		{
			byte[] array = await worker.SendRawAsync(HttpMethod.Get, "/app-config", null, authenticated: false, ct, TimeSpan.FromSeconds(15L)).ConfigureAwait(continueOnCapturedContext: false);
			if (array != null)
			{
				Apply(array);
			}
		}
		catch (Exception ex) when (!ct.IsCancellationRequested)
		{
			Log.Warn("app-config", "/app-config: " + ex.Message);
		}
	}
}
