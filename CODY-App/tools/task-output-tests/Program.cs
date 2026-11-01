using HeyClicky.App.Cody;
using HeyClicky.Agents;
using System.Text.Json;
class Program{
 static void Main(){var root=Path.Combine(Path.GetTempPath(),"cody-task-outputs-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);int checks=0;
 void Check(bool passed,string name){if(!passed)throw new Exception(name);Console.WriteLine("PASS "+name);checks++;}
 try{var html=Path.Combine(root,"index.html");File.WriteAllText(html,"<h1>Test</h1>");var doc=Path.Combine(root,"My report.docx");File.WriteAllText(doc,"fixture");var exe=Path.Combine(root,"unsafe.exe");File.WriteAllText(exe,"not executable");
 var task=new AgentTaskDetail{WorkspacePath=root,Artifacts=new[]{"index.html","My report.docx","unsafe.exe","https://example.com/result"}};
 var outputs=CodyTaskOutputs.Resolve(task);Check(outputs.Count==3,"only supported deliverables are offered");Check(outputs.First().Kind=="website","website is the primary output");Check(outputs.Any(x=>x.Name=="My report.docx"&&x.Kind=="document"),"Word output is recognized");
 using(var archive=new System.IO.Compression.ZipArchive(new FileStream(doc,FileMode.Create),System.IO.Compression.ZipArchiveMode.Create)){var entry=archive.CreateEntry("word/document.xml");using var writer=new StreamWriter(entry.Open());writer.Write("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>Project brief</w:t></w:r></w:p><w:p><w:r><w:t>Actual document content.</w:t></w:r></w:p></w:body></w:document>");}
 var documentTask=new AgentTaskDetail{WorkspacePath=root,Artifacts=new[]{doc}};var documentPreview=JsonSerializer.SerializeToElement(CodyTaskOutputs.Preview(documentTask));Check(documentPreview.GetProperty("documentText").GetString().Contains("Actual document content."),"Word cover uses the real document text");
 Check(CodyTaskOutputs.Resolve(task).Select(x=>x.Id).SequenceEqual(outputs.Select(x=>x.Id)),"output IDs are stable");
 task.Artifacts=Array.Empty<string>();task.StreamingResponse="Saved [website]("+html+") and `"+doc+"`";Check(CodyTaskOutputs.Resolve(task).Count==2,"explicit local output links are recovered");
 task.StreamingResponse="Read [this source](https://example.com/citation)";task.WorkspacePath=null;Check(CodyTaskOutputs.Resolve(task).Count==0,"narrative citations are not mistaken for results");
 task.WorkspacePath=root;task.StreamingResponse="";Check(CodyTaskOutputs.Resolve(task).Count==2,"recent deliverables are recovered from the task workspace");
 task.Snapshot.StartedAt=DateTimeOffset.UtcNow.AddDays(1);Check(CodyTaskOutputs.Resolve(task).Count==0,"old files do not become outputs of a new task");
 try{CodyTaskOutputs.Open(task,"unknown");throw new Exception("unknown output accepted");}catch(InvalidOperationException){checks++;Console.WriteLine("PASS unknown output is rejected");}
 Console.WriteLine(JsonSerializer.Serialize(new{checks,browser=CodyTaskOutputs.BrowserExecutable()}));
 }finally{foreach(var f in Directory.GetFiles(root))File.Delete(f);Directory.Delete(root);}}
}
namespace HeyClicky.Agents{
 public class AgentTaskDetail{public List<string> Dummy=new();public IEnumerable<string> Artifacts{get;set;}=Array.Empty<string>();public string WorkspacePath{get;set;}public string StreamingResponse{get;set;}="";public string Summary{get;set;}="";public Answer Answer{get;set;}public Snapshot Snapshot{get;set;}=new();}
 public class Snapshot{public DateTimeOffset StartedAt{get;set;}=DateTimeOffset.UtcNow.AddMinutes(-1);public string Title{get;set;}="Website";}
 public class Answer{public List<ResultLink> Done{get;set;}public List<ResultLink> Ask{get;set;}public ResultLink Next{get;set;}}
 public class ResultLink{public string LinkValue;public string Link=>LinkValue;public string File{get;set;}public string Open{get;set;}}
}
namespace HeyClicky.App.Dock{public static class DockFiles{public static bool IsWebLink(string x)=>x.StartsWith("http://")||x.StartsWith("https://");public static string Resolve(string entry,string workspace){if(IsWebLink(entry))return entry;if(entry.StartsWith("file://"))return new Uri(entry).LocalPath;return Path.IsPathFullyQualified(entry)?entry:workspace==null?entry:Path.GetFullPath(Path.Combine(workspace,entry));}}}
