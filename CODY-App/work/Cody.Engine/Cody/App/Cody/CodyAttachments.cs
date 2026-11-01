using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using HeyClicky.Core.Voice;

namespace HeyClicky.App.Cody;
internal static class CodyAttachments
{
    internal static string[] Paths(JsonElement request)
    {
        if(!request.TryGetProperty("files",out var files))return Array.Empty<string>();
        if(files.ValueKind!=JsonValueKind.Array||files.GetArrayLength()>10)throw new ArgumentException("Attach up to 10 files.");
        var paths=files.EnumerateArray().Select(file=>file.ValueKind==JsonValueKind.String?file.GetString():null).ToArray();
        if(paths.Any(file=>string.IsNullOrWhiteSpace(file)||!Path.IsPathFullyQualified(file)||!File.Exists(file)))throw new ArgumentException("An attached file is no longer available.");
        return paths.Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
    internal static async Task Submit(AppHost host,CompanionSession session,string text,bool speak,string[] files)
    {
        if(files.Length==0){await session.SubmitTextAsync(text,speak);return;}
        bool previous=host.Real.Core.Settings.Read(settings=>settings.TypedTurnsRespondWithVoice);
        host.Real.Core.Settings.Update(settings=>settings.TypedTurnsRespondWithVoice=speak);
        try{await session.SubmitTextAsync(text,files);}
        finally{host.Real.Core.Settings.Update(settings=>settings.TypedTurnsRespondWithVoice=previous);}
    }
}
