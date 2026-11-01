using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Agents.Backend;
using HeyClicky.App.Settings;
using HeyClicky.App.Services;
namespace HeyClicky.App.Cody;

internal static class CodyPlugins
{
    private static AgentIntegrationCatalog catalog;
    internal static async Task<object> List(AppHost host){
        string message=null;bool signedIn=host.Services.Auth.IsSignedIn;
        if(signedIn){try{using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));catalog=await host.Real.Agents.ListIntegrationsAsync(timeout.Token);ConnectedApps.SetCatalog(catalog);if(!catalog.ComposioConfigured)message="Cloud plugins are not configured on the HeyClicky server.";}catch{message="Could not refresh cloud plugins. Check your connection and try Refresh.";}}
        else{catalog=null;message="Sign in to HeyClicky to browse and connect cloud plugins.";}
        var cloud=(catalog?.Integrations??Array.Empty<AgentIntegration>()).Where(x=>!x.IsLocalIntegration).Append(ObsidianVault.Row()).Select(x=>new{
            id=x.Id,name=x.DisplayName,description=x.Description,status=x.Status,connected=x.IsActiveConnection,kind=x.IsLocalIntegration?"local":"cloud",logo=x.LogoUrl,
            canAddAccount=!x.IsLocalIntegration&&!x.HasReachedActiveAccountLimit,accounts=x.ActiveAccounts.Select(a=>new{id=a.ConnectedAccountId,name=a.Label??a.AccountName??"Connected account"}).ToArray()
        }).ToArray();
        var custom=CustomConnectorStore.Load().Select(x=>{var state=ConnectorAuth.StateFor(x.Id);return new{id=x.IntegrationId,name=x.Name,description=x.DerivedCapabilityDescription??"Custom MCP server",status=state.Kind.ToString(),connected=state.Kind is ConnectorSignInKind.SignedIn or ConnectorSignInKind.NotNeeded,kind="custom",canConnect=x.IsRemote};}).ToArray();
        return new{signedIn,available=catalog?.ComposioConfigured??false,message,plugins=cloud,custom};
    }
    internal static async Task<object> Act(AppHost host,string id,string action,string accountId){
        if(string.IsNullOrWhiteSpace(id)||id.Length>200)throw new ArgumentException("Invalid plugin.");
        if(action!="connect"&&action!="disconnect")throw new ArgumentException("Invalid plugin action.");
        if(id.StartsWith("custom:",StringComparison.Ordinal)){
            string key=id.Substring(7);var connector=CustomConnectorStore.Get(key)??throw new InvalidOperationException("This custom plugin no longer exists.");
            if(action=="connect"){if(!connector.IsRemote)throw new InvalidOperationException("This local plugin is already installed.");ConnectorAuth.SignIn(key);}
            else{CustomConnectorStore.Remove(key);ConnectorAuth.Removed(key);host.Real.Agents.InvalidateConnectedApps();}
            return new{awaiting=action=="connect",changed=true};
        }
        if(id=="obsidian"){
            bool changed;if(action=="connect")changed=ObsidianVault.Configure(HeyClicky.App.Interop.Native.GetForegroundWindow());else{ObsidianVault.Unset();changed=true;}
            host.Real.Agents.InvalidateConnectedApps();return new{awaiting=false,changed};
        }
        if(!host.Services.Auth.IsSignedIn)throw new InvalidOperationException("Sign in to HeyClicky first.");
        if(catalog==null)await List(host);
        var plugin=catalog.Integrations.FirstOrDefault(x=>x.Id==id)??throw new ArgumentException("This plugin is not in the HeyClicky catalog.");
        if(action=="connect"){
            if(plugin.HasReachedActiveAccountLimit)throw new InvalidOperationException("This plugin already has the maximum number of connected accounts.");
            string url=await host.Real.Agents.ConnectIntegrationAsync(plugin.PrimaryToolkitSlug);
            if(!Uri.TryCreate(url,UriKind.Absolute,out var uri)||uri.Scheme!="https")throw new InvalidOperationException("HeyClicky returned an invalid sign-in address.");
            host.OpenUrl(url);return new{awaiting=true,changed=false};
        }
        if(!string.IsNullOrEmpty(accountId)&&!plugin.Accounts.Any(a=>a.ConnectedAccountId==accountId))throw new ArgumentException("That account does not belong to this plugin.");
        await host.Real.Agents.DisconnectIntegrationAsync(plugin.PrimaryToolkitSlug,string.IsNullOrEmpty(accountId)?null:accountId);return new{awaiting=false,changed=true};
    }
    internal static object Add(AppHost host,string name,string server,string apiKey){
        name=(name??"").Trim();server=(server??"").Trim();apiKey=apiKey??"";
        if(name.Length<1||name.Length>80)throw new ArgumentException("Enter a plugin name (up to 80 characters).");
        if(server.Length>2048||!Uri.TryCreate(server,UriKind.Absolute,out var uri)||(uri.Scheme!="https"&&!(uri.Scheme=="http"&&uri.IsLoopback))||uri.UserInfo.Length>0)throw new ArgumentException("Use an HTTPS MCP server URL, or HTTP for localhost.");
        if(apiKey.Length>8192||apiKey.Contains('\r')||apiKey.Contains('\n'))throw new ArgumentException("Invalid API key.");
        string id=Guid.NewGuid().ToString("N");var connector=new CustomConnector(id,name,"remote",uri.AbsoluteUri,null,Array.Empty<string>(),Array.Empty<string>(),apiKey.Length>0);
        string error=CustomConnectorStore.Save(connector,new CustomConnectorSecrets{BearerToken=apiKey.Length>0?apiKey:null},out _);if(error!=null)throw new InvalidOperationException(error);
        ConnectorAuth.AfterSave(id);host.Real.Agents.InvalidateConnectedApps();return new{id=connector.IntegrationId,added=true};
    }
}
