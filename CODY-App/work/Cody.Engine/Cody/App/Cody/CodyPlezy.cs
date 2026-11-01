using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace HeyClicky.App.Cody;

// A deliberately narrow adapter: only the installed Plezy window, its search
// edit, an exact title button, and that title's Play/Resume control are eligible.
internal static class CodyPlezy
{
    private static readonly SemaphoreSlim serial=new(1,1);
    public static async Task<object> Play(string title)
    {
        if(string.IsNullOrWhiteSpace(title)||title.Length>180||title.Any(char.IsControl))throw new ArgumentException("Invalid Plezy title.");
        await serial.WaitAsync();
        try{return await Task.Run(async()=>{
            string exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Plezy","plezy.exe");
            if(!File.Exists(exe))throw new InvalidOperationException("Plezy is not installed at its normal location.");
            Process process=Process.GetProcessesByName("plezy").FirstOrDefault(p=>p.MainWindowHandle!=0&&string.Equals(p.MainModule?.FileName,exe,StringComparison.OrdinalIgnoreCase));
            if(process==null){Process.Start(new ProcessStartInfo(exe){UseShellExecute=true});for(int i=0;i<80&&process==null;i++){await Task.Delay(150);process=Process.GetProcessesByName("plezy").FirstOrDefault(p=>p.MainWindowHandle!=0&&string.Equals(p.MainModule?.FileName,exe,StringComparison.OrdinalIgnoreCase));}}
            if(process==null)throw new InvalidOperationException("Plezy did not open a window.");
            nint hwnd=process.MainWindowHandle;if(IsIconic(hwnd))ShowWindow(hwnd,9);SetForegroundWindow(hwnd);await Task.Delay(200);
            var automation=(Automation)new AutomationClass();
            Element Root(){var root=automation.ElementFromHandle(hwnd);if(Convert.ToInt32(root.Property(30002))!=process.Id)throw new InvalidOperationException("Plezy window changed.");return root;}
            Element[] Visible(Func<Element,bool> predicate){var all=Root().FindAll(4,automation.TrueCondition());var list=new List<Element>();for(int i=0;i<Math.Min(all.Length,2500);i++){var element=all.Get(i);try{if(!(bool)element.Property(30022)&&predicate(element))list.Add(element);}catch{}}return list.ToArray();}
            string Name(Element element)=>element.Property(30005) as string??"";
            bool Button(Element element)=>Convert.ToInt32(element.Property(30003))==50000;
            void Click(Element element){
                if(Convert.ToInt32(element.Property(30002))!=process.Id||!(bool)element.Property(30010))throw new InvalidOperationException("Plezy control is not available.");
                try{if(element.Pattern(10000) is Invoke invoke){invoke.Run();return;}}catch(COMException){}catch(InvalidCastException){}
                if(GetForegroundWindow()!=hwnd)throw new InvalidOperationException("Keep Plezy in front while it starts the title.");
                var rect=(double[])element.Property(30001);if(rect.Length!=4||rect[2]<=0||rect[3]<=0)throw new InvalidOperationException("Plezy control moved.");
                SetCursorPos((int)(rect[0]+rect[2]/2),(int)(rect[1]+rect[3]/2));Send(new Input{type=0,mouse=new Mouse{flags=2}},new Input{type=0,mouse=new Mouse{flags=4}});
            }
            var search=Visible(e=>Name(e)=="Search").FirstOrDefault();
            if(search==null)throw new InvalidOperationException("Plezy's Search tab is not available. Leave its main window open.");
            // Hover expands Plezy's sidebar and moves Search below the libraries.
            // Resolve its accessible bounds again after that layout settles.
            var searchBounds=(double[])search.Property(30001);
            SetCursorPos((int)(searchBounds[0]+searchBounds[2]/2),(int)(searchBounds[1]+searchBounds[3]/2));await Task.Delay(350);
            search=Visible(e=>Name(e)=="Search").FirstOrDefault()??throw new InvalidOperationException("Plezy Search moved during navigation.");
            Click(search);await Task.Delay(250);
            Element edit=null;for(int i=0;i<35&&edit==null;i++){edit=Visible(e=>Convert.ToInt32(e.Property(30003))==50004&&Name(e).StartsWith("Search",StringComparison.OrdinalIgnoreCase)).FirstOrDefault();if(edit==null)await Task.Delay(100);}
            if(edit==null)throw new InvalidOperationException("Plezy did not expose its search box.");
            Click(edit);edit.SetFocus();
            try{((Value)edit.Pattern(10002)).Set(title);}catch{}
            await Task.Delay(100);
            if(!string.Equals(edit.Property(30045) as string,title,StringComparison.Ordinal)){
                if(GetForegroundWindow()!=hwnd)throw new InvalidOperationException("Plezy lost keyboard focus before search.");
                Key(0x11,false);Key(0x41,false);Key(0x41,true);Key(0x11,true);
                foreach(char character in title){if(GetForegroundWindow()!=hwnd)throw new InvalidOperationException("Plezy lost focus during search; input was stopped.");short mapped=VkKeyScan(character);if(mapped==-1)throw new InvalidOperationException("Plezy could not enter this title in its search field.");int modifiers=(mapped>>8)&0xff;if((modifiers&1)!=0)Key(0x10,false);if((modifiers&2)!=0)Key(0x11,false);if((modifiers&4)!=0)Key(0x12,false);Key(mapped&0xff,false);Key(mapped&0xff,true);if((modifiers&4)!=0)Key(0x12,true);if((modifiers&2)!=0)Key(0x11,true);if((modifiers&1)!=0)Key(0x10,true);await Task.Delay(12);}
            }
            string Normalize(string value)=>Regex.Replace(value.ToLowerInvariant(),@"[^\p{L}\p{N}]","");
            Element match=null;
            for(int i=0;i<100;i++){
                var matches=Visible(e=>Button(e)&&Normalize(Name(e))==Normalize(title));
                if(matches.Length>1)throw new InvalidOperationException("More than one Plezy title matches. Open the version you want in Plezy first.");
                if(matches.Length==1){match=matches[0];break;}await Task.Delay(150);
            }
            if(match==null)throw new InvalidOperationException("No exact Plezy result for \""+title+"\". It has not played a different title.");
            Click(match);await Task.Delay(350);
            Element play=null;
            for(int i=0;i<50&&play==null;i++){
                play=Visible(e=>Button(e)&&Regex.IsMatch(Name(e),@"^(Play|Resume|Continue watching)(\b|$)",RegexOptions.IgnoreCase)).OrderBy(e=>Name(e).StartsWith("Play",StringComparison.OrdinalIgnoreCase)?0:1).FirstOrDefault();
                if(play==null)await Task.Delay(150);
            }
            if(play==null)throw new InvalidOperationException("Plezy opened the title, but its Play button was not available.");
            Click(play);
            var manager=await global::Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            for(int i=0;i<80;i++){
                foreach(var session in manager.GetSessions())if(session.SourceAppUserModelId.Contains("plezy",StringComparison.OrdinalIgnoreCase)){
                    var media=await session.TryGetMediaPropertiesAsync();
                    if(Normalize(Regex.Replace(media.Title,@"\s*[\(\[]\d{4}[\)\]]\s*$",""))==Normalize(title)&&session.GetPlaybackInfo().PlaybackStatus==global::Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)return new {title=media.Title,playing=true,app="Plezy"};
                }await Task.Delay(200);
            }
            throw new InvalidOperationException("Plezy received Play, but playback was not confirmed. Check the player for a server or media error.");
        });}finally{serial.Release();}
    }
    private static void Key(int code,bool up)=>Send(new Input{type=1,key=new Keyboard{vk=(ushort)code,flags=up?2u:0}});
    private static void Send(params Input[] inputs){if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf<Input>())!=inputs.Length)throw new InvalidOperationException("Windows refused Plezy input.");}
    [StructLayout(LayoutKind.Explicit,Size=40)]private struct Input{[FieldOffset(0)]public uint type;[FieldOffset(8)]public Mouse mouse;[FieldOffset(8)]public Keyboard key;}
    [StructLayout(LayoutKind.Sequential)]private struct Mouse{public int x,y;public uint data,flags,time;public nuint extra;}
    [StructLayout(LayoutKind.Sequential)]private struct Keyboard{public ushort vk,scan;public uint flags,time;public nuint extra;}
    [DllImport("user32.dll")]private static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")]private static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")]private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")]private static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")]private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")]private static extern bool ShowWindow(nint hwnd,int command);
    [DllImport("user32.dll",EntryPoint="VkKeyScanW",CharSet=CharSet.Unicode)]private static extern short VkKeyScan(char value);
    [ComImport,Guid("E22AD333-B25F-460C-83D0-0581107395C9")]private class AutomationClass{}
    [ComImport,Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface Automation{
        void Slot0();void Slot1();void Slot2();Element ElementFromHandle(nint hwnd);void Slot4();Element Focused();void Slot6();void Slot7();void Slot8();void Slot9();void Slot10();void Slot11();void Slot12();void Slot13();void Slot14();void Slot15();void Slot16();void Slot17();Condition TrueCondition();
    }
    [ComImport,Guid("352FFBA8-0973-437C-A61F-F64CAFD81DF9"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface Condition{}
    [ComImport,Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface Element{
        void SetFocus();void Slot1();void Slot2();Elements FindAll(int scope,Condition condition);void Slot4();void Slot5();void Slot6();[return:MarshalAs(UnmanagedType.Struct)]object Property(int id);void Slot8();void Slot9();void Slot10();void Slot11();void Slot12();[return:MarshalAs(UnmanagedType.IUnknown)]object Pattern(int id);
    }
    [ComImport,Guid("14314595-B4BC-4055-95F2-58F2E42C9855"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface Elements{int Length{get;}Element Get(int index);}
    [ComImport,Guid("FB377FBE-8EA6-46D5-9C73-6499642D3059"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface Invoke{void Run();}
    [ComImport,Guid("A94CD8B1-0844-4CD6-9D2D-640537AB39E9"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface Value{void Set([MarshalAs(UnmanagedType.BStr)]string text);}
}
