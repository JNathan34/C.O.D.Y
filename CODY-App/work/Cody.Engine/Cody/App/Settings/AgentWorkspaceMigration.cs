using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json.Nodes;

namespace HeyClicky.App.Settings;

// Moves only the project workspace and remaps known task metadata, never accounts or credentials.
internal static class AgentWorkspaceMigration
{
    internal static string MapPath(string value,string source,string destination)
    {
        if(string.Equals(value,source,StringComparison.OrdinalIgnoreCase))return destination;
        if(value.StartsWith(source+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return destination+value.Substring(source.Length);
        if(value.StartsWith("file:",StringComparison.OrdinalIgnoreCase)&&Uri.TryCreate(value,UriKind.Absolute,out var uri)&&uri.IsFile){var mapped=MapPath(uri.LocalPath,source,destination);if(mapped!=uri.LocalPath)return new Uri(mapped).AbsoluteUri;}
        return value;
    }
    private static bool Remap(JsonNode node,string source,string destination)
    {
        bool changed=false;
        void Set(JsonNode child,Action<JsonNode> assign){
            if(child is JsonValue value&&value.TryGetValue<string>(out var text)){var mapped=MapPath(text,source,destination);if(mapped!=text){assign(JsonValue.Create(mapped));changed=true;}}
            else if(child!=null)changed|=Remap(child,source,destination);
        }
        if(node is JsonObject obj){foreach(var key in new List<string>(obj.SelectKeys()))Set(obj[key],value=>obj[key]=value);}
        else if(node is JsonArray array){for(int i=0;i<array.Count;i++){int index=i;Set(array[i],value=>array[index]=value);}}
        return changed;
    }
    private static IEnumerable<string> SelectKeys(this JsonObject obj){foreach(var pair in obj)yield return pair.Key;}
    internal static void Move(string source,string destination,string sourceParent,string destinationParent,IEnumerable<string> metadataFiles)
    {
        source=Path.GetFullPath(source).TrimEnd(Path.DirectorySeparatorChar);destination=Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar);
        bool Inside(string path,string root)=>path.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);
        if(!Inside(source,sourceParent)||!Inside(destination,destinationParent)||source==destination||Inside(source,destination)||Inside(destination,source))throw new InvalidOperationException("Invalid CODY workspace migration paths.");
        if(Directory.Exists(source)&&(File.GetAttributes(source)&FileAttributes.ReparsePoint)!=0)throw new IOException("The old workspace is a linked folder. Choose a CODY folder manually.");
        if(Directory.Exists(source)&&Directory.Exists(destination))throw new IOException("Both workspaces already exist. No project files were overwritten.");
        var changes=new Dictionary<string,string>();
        foreach(var file in metadataFiles){if(!File.Exists(file))continue;var node=JsonNode.Parse(File.ReadAllText(file));if(node!=null&&Remap(node,source,destination))changes[file]=node.ToJsonString();}
        // Parse and back up metadata before moving any projects. A retry is safe after interruption.
        foreach(var file in changes.Keys)File.Copy(file,file+".workspace-backup-"+DateTime.UtcNow.ToString("yyyyMMddHHmmssfff"),false);
        Directory.CreateDirectory(Path.GetDirectoryName(destination));
        if(Directory.Exists(source))Directory.Move(source,destination);else Directory.CreateDirectory(destination);
        foreach(var pair in changes){var temporary=pair.Key+".workspace-tmp";File.WriteAllText(temporary,pair.Value);File.Move(temporary,pair.Key,true);}
    }
}
