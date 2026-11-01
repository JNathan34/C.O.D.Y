using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.IO.Compression;
using System.Xml.Linq;
using HeyClicky.Agents;
using HeyClicky.App.Dock;
namespace HeyClicky.App.Cody;
internal static class CodyTaskOutputs
{
    internal sealed record Output(string Id,string Name,string Kind,string Target);
    private static readonly string[] Documents={".docx",".doc",".odt",".rtf",".pdf",".txt",".md",".xlsx",".xls",".csv",".pptx",".ppt",".ods",".odp"};
    private static readonly string[] Images={".png",".jpg",".jpeg",".webp",".gif",".bmp",".svg"};
    internal static string Kind(string target){if(DockFiles.IsWebLink(target)||new[]{".html",".htm"}.Contains(Path.GetExtension(target).ToLowerInvariant()))return "website";var ext=Path.GetExtension(target).ToLowerInvariant();return Images.Contains(ext)?"images":Documents.Contains(ext)?"document":"file";}
    internal static IReadOnlyList<Output> Resolve(AgentTaskDetail detail){
        var entries=new List<string>(detail.Artifacts);
        if(detail.Answer?.Done!=null)entries.AddRange(detail.Answer.Done.Select(x=>x.Link).Where(x=>x!=null));
        if(detail.Answer?.Ask!=null)entries.AddRange(detail.Answer.Ask.Select(x=>x.File).Where(x=>x!=null));
        if(detail.Answer?.Next?.Open!=null)entries.Add(detail.Answer.Next.Open);
        var text=(detail.StreamingResponse??"")+"\n"+(detail.Summary??"");
        foreach(Match match in Regex.Matches(text,@"\[[^\]\r\n]*\]\(([^\r\n]+?)\)|`((?:[A-Za-z]:[\\/]|file:///)[^`\r\n]+)`")){
            string value=match.Groups[1].Success?match.Groups[1].Value:match.Groups[2].Value;
            // Narrative links are only fallbacks for actual local files; arbitrary cited sites are not deliverables.
            if(!DockFiles.IsWebLink(value))entries.Add(value.Trim('<','>'));
        }
        var found=new List<Output>();int budget=300;
        foreach(var entry in entries.Take(100))Add(entry);
        if(found.Count==0&&detail.WorkspacePath!=null&&Directory.Exists(detail.WorkspacePath)){
            try{Scan(detail.WorkspacePath,0);}catch{}
        }
        return found.OrderBy(x=>x.Kind=="website"?0:x.Kind=="document"?1:2).Take(24).ToArray();
        void Add(string entry){try{
            if(string.IsNullOrWhiteSpace(entry))return;string target=DockFiles.Resolve(entry,detail.WorkspacePath);
            if(DockFiles.IsWebLink(target)){if(!Uri.TryCreate(target,UriKind.Absolute,out var url)||url.UserInfo.Length>0)return;}
            else if(!Path.IsPathFullyQualified(target)||target.StartsWith(@"\\")||!File.Exists(target)||Kind(target)=="file")return;
            if(found.Any(x=>string.Equals(x.Target,target,StringComparison.OrdinalIgnoreCase)))return;
            string id=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(target))).Substring(0,24);
            string name=DockFiles.IsWebLink(target)?new Uri(target).Host:Path.GetFileName(target);
            found.Add(new(id,name,Kind(target),target));
        }catch{}}
        void Scan(string directory,int depth){
            foreach(var file in Directory.EnumerateFiles(directory).Take(80)){if(--budget<0)return;if(File.GetLastWriteTimeUtc(file)>=detail.Snapshot.StartedAt.UtcDateTime.AddSeconds(-5))Add(file);}
            if(depth>=2||found.Count>=24||budget<=0)return;
            foreach(var folder in Directory.EnumerateDirectories(directory).Take(25))if(!new[]{"node_modules",".git",".venv","venv"}.Contains(Path.GetFileName(folder))&&(File.GetAttributes(folder)&FileAttributes.ReparsePoint)==0)Scan(folder,depth+1);
        }
    }
    internal static string BrowserExecutable(){var buffer=new StringBuilder(2048);uint length=2048;return AssocQueryString(0,2,"https",null,buffer,ref length)==0&&File.Exists(buffer.ToString())?buffer.ToString():null;}
    private static string DocumentText(string path){
        try{
            if(path==null||Path.GetExtension(path).ToLowerInvariant()!=".docx")return null;
            using var zip=ZipFile.OpenRead(path);var entry=zip.GetEntry("word/document.xml");
            if(entry==null||entry.Length>2000000)return null;
            using var stream=entry.Open();var xml=XDocument.Load(stream);
            string text=string.Join("\n",xml.Descendants().Where(x=>x.Name.LocalName=="p").Take(12).Select(p=>string.Concat(p.Descendants().Where(x=>x.Name.LocalName=="t").Select(x=>x.Value))));
            return text[..Math.Min(2000,text.Length)];
        }catch{return null;}
    }
    internal static object Preview(AgentTaskDetail detail){var outputs=Resolve(detail);var first=outputs.FirstOrDefault();var website=outputs.FirstOrDefault(x=>x.Kind=="website"&&!DockFiles.IsWebLink(x.Target));bool web=first?.Kind=="website"||first==null&&Regex.IsMatch(detail.Snapshot.Title,@"\b(website|webpage|web page|landing page)\b",RegexOptions.IgnoreCase);return new{
        files=outputs.Select(x=>x.Name).Take(8).ToArray(),imagePaths=outputs.Where(x=>x.Kind=="images"&&Path.GetExtension(x.Target)!=".svg").Select(x=>x.Target).Take(4).ToArray(),
        websitePath=website?.Target,iconPath=web?BrowserExecutable():first?.Target,documentText=DocumentText(first?.Target),
        kind=first?.Kind??(Regex.IsMatch(detail.Snapshot.Title,@"\b(website|webpage|web page|landing page)\b",RegexOptions.IgnoreCase)?"website":"document"),
        outputs=outputs.Select(x=>new{id=x.Id,name=x.Name,kind=x.Kind}).ToArray()
    };}
    internal static object Open(AgentTaskDetail detail,string outputId){
        var outputs=Resolve(detail);var output=string.IsNullOrEmpty(outputId)?outputs.FirstOrDefault():outputs.FirstOrDefault(x=>x.Id==outputId);
        if(output==null)throw new InvalidOperationException("This task has no saved result to open yet.");
        if(output.Kind=="website"&&!DockFiles.IsWebLink(output.Target)){
            string browser=BrowserExecutable();if(browser==null)throw new InvalidOperationException("Set a default web browser in Windows to open this website.");
            var start=new ProcessStartInfo(browser){UseShellExecute=false};start.ArgumentList.Add(new Uri(output.Target).AbsoluteUri);Process.Start(start);
        }else Process.Start(new ProcessStartInfo(output.Target){UseShellExecute=true});
        return new{opened=true,name=output.Name,kind=output.Kind};
    }
    [DllImport("shlwapi.dll",CharSet=CharSet.Unicode)]private static extern int AssocQueryString(uint flags,uint str,string assoc,string extra,StringBuilder output,ref uint length);
}
