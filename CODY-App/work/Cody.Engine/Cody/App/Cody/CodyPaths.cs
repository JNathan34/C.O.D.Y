using System;
using System.IO;
using System.Text.RegularExpressions;
namespace HeyClicky.App.Cody;
internal static class CodyPaths
{
    public static string StateRoot{get{string root=Environment.GetEnvironmentVariable("CODY_ENGINE_STATE_DIR");root=string.IsNullOrWhiteSpace(root)?Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..")):Path.GetFullPath(root);Directory.CreateDirectory(root);return root;}}
    public static string PipeName{get{string name=Environment.GetEnvironmentVariable("CODY_ENGINE_PIPE_NAME")??"CODY.Engine.v1";if(!Regex.IsMatch(name,@"^CODY\.Engine\.[A-Za-z0-9.]+$"))throw new InvalidOperationException("Invalid C.O.D.Y. engine pipe name.");return name;}}
}
