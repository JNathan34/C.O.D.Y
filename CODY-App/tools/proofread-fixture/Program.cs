using System.Text.Json;
using System.Runtime.InteropServices;
class Program{
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(nint hwnd);
 [DllImport("user32.dll")]static extern nint GetForegroundWindow();
 [STAThread]static void Main(){
  ApplicationConfiguration.Initialize();var form=new Form{Text="C.O.D.Y. spelling test fixture",Width=650,Height=250};var box=new TextBox{Multiline=true,Dock=DockStyle.Fill,Font=new System.Drawing.Font("Segoe UI",14)};form.Controls.Add(box);
  form.Shown+=(_,_)=>{Console.WriteLine("{\"ready\":true}");Task.Run(()=>{string line;while((line=Console.ReadLine())!=null){try{using var doc=JsonDocument.Parse(line);var request=doc.RootElement.Clone();form.Invoke(()=>{try{switch(request.GetProperty("command").GetString()){
   case "set":box.ReadOnly=false;box.UseSystemPasswordChar=false;box.Text=request.GetProperty("text").GetString();if(request.TryGetProperty("readonly",out var ro))box.ReadOnly=ro.GetBoolean();form.Activate();SetForegroundWindow(form.Handle);box.Focus();if(request.TryGetProperty("start",out var start))box.Select(start.GetInt32(),request.GetProperty("length").GetInt32());else box.Select(box.TextLength,0);break;
   case "get":break;case "close":form.Close();break;
  }Console.WriteLine(JsonSerializer.Serialize(new{text=box.Text,focused=box.Focused,foreground=GetForegroundWindow()==form.Handle}));}catch(Exception error){Console.WriteLine(JsonSerializer.Serialize(new{error=error.Message}));}});}catch(Exception error){Console.WriteLine(JsonSerializer.Serialize(new{error=error.Message}));}}});};Application.Run(form);
 }
}
