using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
namespace HeyClicky.App.Cody;

// Resolve the actual taskbar control through Windows' installed-app catalogue.
// Shell activation and window commands never inject physical mouse or keyboard input.
internal static class CodyTaskbarInput
{
    internal static string AppName(string label)=>Regex.Replace(label??"",@"(?: pinned| - \d+ running windows?)+$","",RegexOptions.IgnoreCase).Trim();
    internal static Task<CodyAccessibilityInput.Result> Activate(string label,Func<bool> valid)=>CodyAccessibilityInput.Run((_,act)=>{
        string name=AppName(label);if(name.Length==0)return new(Reason:"The taskbar button has no app name.");
        dynamic shell=null,folder=null,items=null;
        try{
            shell=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));folder=shell.NameSpace("shell:AppsFolder");items=folder.Items();
            var matches=new List<string>();
            for(int i=0;i<(int)items.Count;i++){
                dynamic item=items.Item(i);
                try{if(string.Equals((string)item.Name,name,StringComparison.OrdinalIgnoreCase))matches.Add((string)item.Path);}
                finally{if(item!=null&&Marshal.IsComObject(item))Marshal.ReleaseComObject(item);}
            }
            if(matches.Count!=1)return new(Reason:matches.Count==0?"Windows could not resolve the taskbar app "+name+".":"More than one installed app matches "+name+".");
            string app=matches[0];nint running=FindWindow(app,name);
            act();
            if(running!=0){
                if(GetForegroundWindow()==running)ShowWindow(running,6);
                else{if(IsIconic(running))ShowWindow(running,9);if(!SetForegroundWindow(running))return new(Attempted:true,Reason:"Windows refused to activate "+name+".");}
                return new(true,true,"shell/taskbar-window");
            }
            Process.Start(new ProcessStartInfo("explorer.exe"){Arguments="shell:AppsFolder\\"+app,UseShellExecute=true});
            return new(true,true,"shell/taskbar-launch");
        }catch(Exception ex){return new(Attempted:true,Reason:"Windows could not activate the taskbar app: "+ex.GetType().Name);}
        finally{foreach(object value in new object[]{items,folder,shell})if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
    },valid);
    private static nint FindWindow(string app,string name){
        nint found=0;
        EnumWindows((window,_)=>{
            if(!IsWindowVisible(window))return true;GetWindowThreadProcessId(window,out uint pid);var process=OpenProcess(0x1000,false,pid);if(process==0)return true;
            try{uint length=512;var id=new StringBuilder(512);bool matches=GetApplicationUserModelId(process,ref length,id)==0&&string.Equals(app,id.ToString(),StringComparison.OrdinalIgnoreCase);
                if(!matches){try{matches=string.Equals(Process.GetProcessById((int)pid).ProcessName,name,StringComparison.OrdinalIgnoreCase);}catch{}}
                if(matches){found=window;return false;}
            }finally{CloseHandle(process);}return true;
        },0);return found;
    }
    private delegate bool EnumCallback(nint window,nint data);
    [DllImport("user32.dll")]private static extern bool EnumWindows(EnumCallback callback,nint data);
    [DllImport("user32.dll")]private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(nint window,out uint pid);
    [DllImport("user32.dll")]private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")]private static extern bool SetForegroundWindow(nint window);
    [DllImport("user32.dll")]private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")]private static extern bool ShowWindow(nint window,int command);
    [DllImport("kernel32.dll")]private static extern nint OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll")]private static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern int GetApplicationUserModelId(nint process,ref uint length,StringBuilder id);
}

