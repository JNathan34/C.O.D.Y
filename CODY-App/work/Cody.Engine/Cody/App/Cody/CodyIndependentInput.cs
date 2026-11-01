using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Platform.Input;
namespace HeyClicky.App.Cody;
// Window-targeted input never moves the user's Windows pointer or injects global keys.
// Both input paths remain available; the selected mode is fixed for each control run.
internal static class CodyIndependentInput
{
    private static readonly object gate=new();
    internal static bool SystemInputEnabled{get;set;}=true;
    private static bool systemInput;
    private static CancellationTokenSource inputCancellation;
    private static bool UsesSystemInput=>!CodyEngineBridge.EngineMode||systemInput;
    internal static bool UsingSystemInput=>CodyEngineBridge.EngineMode&&active&&systemInput;
    private static PointD pointer;
    private static volatile bool active,left;
    private static nint target,heldTarget;
    private static nint hoverTarget;
    internal static string LastReason{get;private set;}="";
    internal static string LastMethod{get;private set;}="";
    private static ClickyActuation Refuse(string reason){LastReason=reason;return ClickyActuation.Refused;}
    private static volatile int generation;
    private static nint probeRoot;
    internal static bool Active=>active;
    public static PointD CurrentPointer{get{lock(gate)return CodyEngineBridge.EngineMode&&active&&!systemInput?pointer:ClickyScreenActuator.CurrentPointer;}}
    public static bool IsLeftButtonHeld=>CodyEngineBridge.EngineMode&&!systemInput?left:ClickyScreenActuator.IsLeftButtonHeld;
    internal static void Begin(bool? useSystemInput=null){if(!CodyEngineBridge.EngineMode)return;lock(gate){if(active)return;pointer=ClickyScreenActuator.CurrentPointer;systemInput=useSystemInput??SystemInputEnabled;inputCancellation=new CancellationTokenSource();if(systemInput)CodyMouseGuard.Start(End);active=true;generation++;target=hoverTarget=0;LastReason=LastMethod="";CodyAccessibilityInput.Reset();}}
    internal static void End(){if(!CodyEngineBridge.EngineMode)return;lock(gate){CodyMouseGuard.Stop();inputCancellation?.Cancel();ReleaseHeldButton();if(systemInput)ClickyScreenActuator.ReleaseStrandedKeysAfterDrive("control ended");active=false;target=0;generation++;if(hoverTarget!=0)PostMessage(hoverTarget,0x2A3,0,0);hoverTarget=0;}}
    public static async Task GlideAsync(PointD point,double seconds=.45,CancellationToken ct=default){
        if(CodyEngineBridge.EngineMode&&!active)return;
        if(!CodyEngineBridge.EngineMode){await ClickyScreenActuator.GlideAsync(point,seconds,ct);return;}
        if(!active)return;var from=CurrentPointer;
        double distance=Math.Sqrt(Math.Pow(point.X-from.X,2)+Math.Pow(point.Y-from.Y,2));
        if(distance<1){MoveTo(point);return;}
        seconds=CodyControlSpeed.GlideSeconds(distance,seconds);
        int ticket=generation;var travel=Stopwatch.StartNew();
        // Use elapsed time so Windows timer granularity cannot stretch the glide.
        while(true){
            ct.ThrowIfCancellationRequested();if(!active||ticket!=generation)return;
            double progress=Math.Min(1,travel.Elapsed.TotalSeconds/seconds),t=progress*progress*(3-2*progress);
            MoveTo(new PointD(from.X+(point.X-from.X)*t,from.Y+(point.Y-from.Y)*t));
            if(progress>=1)break;await Task.Delay(8,ct);
        }
    }
    public static void MoveTo(PointD point){if(CodyEngineBridge.EngineMode&&!active)return;if(UsesSystemInput){CodyMouseGuard.MoveTo(point);return;}if(!active)return;lock(gate)pointer=point;var window=left?heldTarget:TargetAt(point);if(window!=hoverTarget){if(hoverTarget!=0)PostMessage(hoverTarget,0x2A3,0,0);hoverTarget=window;}if(window!=0)Send(window,0x200,left?1u:0u,point);}
    public static async Task<ClickyActuation> ClickAsync(PointD point,ClickyMouseButton button=ClickyMouseButton.Left,int count=1,ClickyModifierKeys modifiers=ClickyModifierKeys.None){
        if(CodyEngineBridge.EngineMode&&!active)return Refuse("Computer control has stopped.");
        if(UsesSystemInput){CodyMouseGuard.MoveTo(point);return await ClickyScreenActuator.ClickAsync(point,button,count,modifiers);}
        if(!active)return Refuse("Computer control has stopped.");
        if((modifiers&(ClickyModifierKeys.Alt|ClickyModifierKeys.Windows))!=0)return Refuse("This modifier-click requires an application tool.");
        MoveTo(point);LastReason="";var root=TargetAt(point,false);if(root==0)return Refuse(string.IsNullOrEmpty(LastReason)?"No controllable app was found at the requested position.":LastReason);target=root;int ticket=generation;
        if(button==ClickyMouseButton.Left){
            var result=await CodyAccessibilityInput.Click(BrowserInput(root,point),point,count,modifiers.HasFlag(ClickyModifierKeys.Control),()=>active&&ticket==generation&&IsWindow(root));
            if(result.Handled){LastReason="";LastMethod=result.Method;return ClickyActuation.Done;}
            if(result.Attempted)return Refuse(result.Reason??"The app rejected the accessibility action.");
            if(result.Method=="shell/taskbar"){
                var shell=await CodyTaskbarInput.Activate(result.Text,()=>active&&ticket==generation);
                if(shell.Handled){LastReason="";LastMethod=shell.Method;return ClickyActuation.Done;}
                return Refuse(shell.Reason??"The taskbar button has no independent action.");
            }
        }
        if(!active||ticket!=generation)return Refuse("Computer control was stopped before the click.");
        var window=TargetAt(point);if(window==0){
            if(button==ClickyMouseButton.Left&&TitlebarAction(root,point,count)){LastMethod="window-command";return ClickyActuation.Done;}
            return Refuse("That window area has no independent click action. Use an application or window tool.");
        }target=window;
        if(BrowserInput(root,point)!=root){var activation=root;GetWindowThreadProcessId(root,out var browserPid);var hostPid=ParentProcess(browserPid);for(nint host=GetTopWindow(0);host!=0;host=GetWindow(host,2)){GetWindowThreadProcessId(host,out var pid);if(pid==hostPid&&Class(host)=="WinUIDesktopWin32WindowClass"&&IsWindowVisible(host)&&AtPoint(host,point)){activation=host;break;}}SetForegroundWindow(activation);}
        uint down=button==ClickyMouseButton.Right?0x204u:button==ClickyMouseButton.Middle?0x207u:0x201u,up=down+1;uint held=button==ClickyMouseButton.Right?2u:button==ClickyMouseButton.Middle?16u:1u;
        uint flags=(modifiers.HasFlag(ClickyModifierKeys.Control)?8u:0u)|(modifiers.HasFlag(ClickyModifierKeys.Shift)?4u:0u);
        for(int i=0;i<Math.Clamp(count,1,3);i++){
            if(!active||ticket!=generation)return Refuse("Computer control was stopped before the click.");
            if(!Send(window,0x200,flags,point)||!Send(window,i==1?down+2:down,held|flags,point))return Refuse("Windows refused input to the selected app.");
            await Task.Delay(35);if(!Send(window,up,flags,point))return Refuse("Windows refused the click release.");await Task.Delay(40);
        }LastReason="";LastMethod="window-message/"+Class(window);return ClickyActuation.Done;
    }
    public static ClickyActuation SetLeftButton(bool down){
        lock(gate){
        if(CodyEngineBridge.EngineMode&&!active)return ClickyActuation.Refused;if(UsesSystemInput)return ClickyScreenActuator.SetLeftButton(down);if(!active)return ClickyActuation.Refused;var point=CurrentPointer;
        if(left==down)return ClickyActuation.Done;
        var window=down?TargetAt(point):heldTarget;if(window==0)return ClickyActuation.Refused;
        if(!Send(window,down?0x201u:0x202u,down?1u:0u,point))return ClickyActuation.Refused;
        left=down;heldTarget=down?window:0;target=window;return ClickyActuation.Done;
        }
    }
    public static void ReleaseHeldButton(){lock(gate){if(UsesSystemInput){ClickyScreenActuator.ReleaseHeldButton();return;}if(left&&heldTarget!=0)Send(heldTarget,0x202,0,CurrentPointer);left=false;heldTarget=0;}}
    public static async Task<ClickyActuation> DragAsync(IReadOnlyList<PointD> path){
        if(CodyEngineBridge.EngineMode&&!active)return Refuse("Computer control has stopped.");
        if(!CodyEngineBridge.EngineMode)return await ClickyScreenActuator.DragAsync(path);if(path.Count<2)return ClickyActuation.Refused;
        MoveTo(path[0]);if(SetLeftButton(true)!=ClickyActuation.Done)return ClickyActuation.Refused;int ticket=generation;
        try{foreach(var point in path){if(!active||ticket!=generation)return ClickyActuation.Refused;MoveTo(point);await Task.Delay(18);}return ClickyActuation.Done;}finally{ReleaseHeldButton();}
    }
    public static Task<ClickyActuation> ScrollAsync(int lines){
        if(CodyEngineBridge.EngineMode&&!active)return Task.FromResult(ClickyActuation.Refused);if(UsesSystemInput)return ClickyScreenActuator.ScrollAsync(lines);if(!active)return Task.FromResult(ClickyActuation.Refused);var point=CurrentPointer;var window=TargetAt(point);if(window==0)return Task.FromResult(ClickyActuation.Refused);target=window;
        long wheel=((long)(ushort)(short)(Math.Clamp(lines,-240,240)*120))<<16;
        return Task.FromResult(PostMessage(window,0x20A,(nint)wheel,Pack((int)point.X,(int)point.Y))?ClickyActuation.Done:ClickyActuation.Refused);
    }
    private static nint KeyboardTarget(){if(target==0||!IsWindow(target))return 0;uint thread=GetWindowThreadProcessId(target,out _);var info=new GuiThreadInfo{size=Marshal.SizeOf<GuiThreadInfo>()};return GetGUIThreadInfo(thread,ref info)&&info.focus!=0&&GetAncestor(info.focus,2)==GetAncestor(target,2)?info.focus:target;}
    public static async Task<ClickyActuation> TypeAsync(string text,CancellationToken ct=default){
        if(CodyEngineBridge.EngineMode&&!active)return Refuse("Computer control has stopped.");
        if(UsesSystemInput){using var typing=CancellationTokenSource.CreateLinkedTokenSource(ct,inputCancellation?.Token??CancellationToken.None);return await ClickyScreenActuator.TypeAsync(text,typing.Token);}var window=KeyboardTarget();if(window==0||!active)return Refuse("Click the target text field before typing.");int ticket=generation;var root=GetAncestor(window,2);
        var result=await CodyAccessibilityInput.Type(root,text,()=>active&&ticket==generation&&!ct.IsCancellationRequested&&IsWindow(root));
        if(result.Handled){LastMethod=result.Method;LastReason="";return ClickyActuation.Done;}if(result.Attempted)return Refuse(result.Reason??"The app rejected text insertion.");
        foreach(char ch in text){ct.ThrowIfCancellationRequested();if(!active||ticket!=generation||!PostMessage(window,0x102,(nint)ch,(nint)1))return Refuse("Text insertion stopped or was rejected by the app.");}await Task.Delay(20,ct);LastMethod="window-message/type";return ClickyActuation.Done;
    }
    private static ushort Key(string text){var key=text.Trim().ToLowerInvariant();if(key.Length==1&&char.IsAsciiLetterOrDigit(key[0]))return(char)char.ToUpperInvariant(key[0]);if(key.StartsWith('f')&&int.TryParse(key[1..],out var number)&&number>=1&&number<=24)return(ushort)(111+number);return key switch{"enter" or "return"=>13,"tab"=>9,"escape" or "esc"=>27,"backspace"=>8,"delete"=>8,"del" or "forwarddelete"=>46,"insert"=>45,"space"=>32,"up" or "arrowup"=>38,"down" or "arrowdown"=>40,"left" or "arrowleft"=>37,"right" or "arrowright"=>39,"home"=>36,"end"=>35,"pageup"=>33,"pagedown"=>34,_=>0};}
    public static async Task<ClickyActuation> PressAsync(string chord){
        if(CodyEngineBridge.EngineMode&&!active)return Refuse("Computer control has stopped.");
        if(UsesSystemInput)return await ClickyScreenActuator.PressAsync(chord);
        chord=chord.Trim().ToLowerInvariant().Replace("control+","ctrl+").Replace("opt+","alt+");if(!active)return Refuse("Computer control has stopped.");
        if(chord is "win" or "windows" or "meta" or "super"){
            int startTicket=generation;var start=await CodyAccessibilityInput.OpenStart(()=>active&&startTicket==generation);
            if(!start.Handled)return Refuse(start.Reason??"Windows did not expose the Start action.");
            await Task.Delay(150);if(!active||startTicket!=generation)return Refuse("Computer control stopped.");
            target=GetForegroundWindow();LastMethod=start.Method;LastReason="";return ClickyActuation.Done;
        }
        var targetWindow=KeyboardTarget();if(targetWindow==0)targetWindow=TargetAt(CurrentPointer,false);var root=targetWindow==0?0:GetAncestor(targetWindow,2);int ticket=generation;
        if(root!=0&&(chord.Contains('+')||chord=="f6")){
            if(chord=="alt+f4"){LastMethod="window-command/close";return PostMessage(root,0x10,0,0)?ClickyActuation.Done:Refuse("The app rejected the close request.");}
            if(chord=="ctrl+v"){var clipboard=ReadClipboard();if(clipboard==null)return Refuse("The clipboard does not contain text.");target=targetWindow;return await TypeAsync(clipboard);}
            var result=await CodyAccessibilityInput.Shortcut(root,chord,()=>active&&ticket==generation&&IsWindow(root));
            if(result.Handled){target=targetWindow;if(result.Text!=null&&active&&ticket==generation&&!await HeyClicky.Platform.Win32.TextInsertion.CopyTextAsync(result.Text))return Refuse("Windows could not update the clipboard.");LastReason="";LastMethod=result.Method;return ClickyActuation.Done;}
            if(result.Attempted)return Refuse(result.Reason??"The app rejected this shortcut.");
        }
        if(chord.Contains('+'))return Refuse("This shortcut has no independent action in the selected app. Use its browser or application tools.");
        ushort key=Key(chord);if(key==0)return Refuse("Unsupported independent key: "+chord+". No key was sent.");var window=KeyboardTarget();if(window==0||!active)return ClickyActuation.Refused;
        uint scan=MapVirtualKey(key,0);if(!PostMessage(window,0x100,(nint)key,(nint)(1|scan<<16)))return ClickyActuation.Refused;await Task.Delay(25);return PostMessage(window,0x101,(nint)key,(nint)(1|scan<<16|0xC0000000))?ClickyActuation.Done:ClickyActuation.Refused;
    }
    public static async Task<ClickyActuation> HoldAsync(IEnumerable<string> keys,double seconds){if(CodyEngineBridge.EngineMode&&!active)return ClickyActuation.Refused;if(UsesSystemInput)return await ClickyScreenActuator.HoldAsync(keys,seconds);return ClickyActuation.Refused;}
    public static void ReleaseStrandedKeysAfterDrive(string when){if(UsesSystemInput)ClickyScreenActuator.ReleaseStrandedKeysAfterDrive(when);}
    private static bool Send(nint window,uint message,uint buttons,PointD point){if(window==0)return false;var p=new NativePoint{X=(int)Math.Round(point.X),Y=(int)Math.Round(point.Y)};return ScreenToClient(window,ref p)&&PostMessage(window,message,(nint)buttons,Pack(p.X,p.Y));}
    private static nint Pack(int x,int y)=>(nint)((uint)(ushort)(short)x|((uint)(ushort)(short)y<<16));
    private static nint TargetAt(PointD point,bool clientOnly=true){
        for(nint window=GetTopWindow(0);window!=0;window=GetWindow(window,2)){
            if(!IsWindowVisible(window)||(GetWindowLongPtr(window,-20).ToInt64()&0x20)!=0||!AtPoint(window,point))continue;
            GetWindowThreadProcessId(window,out uint pid);if(pid==Environment.ProcessId&&window!=probeRoot)continue;
            var title=new StringBuilder(256);GetWindowText(window,title,256);if(title.ToString()=="C.O.D.Y")continue;
            if(DwmGetWindowAttribute(window,14,out int cloaked,4)==0&&cloaked!=0)continue;
            var owner=GetAncestor(window,3);var webProcesses=new HashSet<uint>();
            if(Class(window)=="WinUIDesktopWin32WindowClass"){
                // A WebView can live in another process and a separate top-level HWND.
                EnumChildWindows(window,(child,_)=>{if(Class(child).StartsWith("Chrome_WidgetWin",StringComparison.Ordinal)){GetWindowThreadProcessId(child,out var webPid);webProcesses.Add(webPid);}return true;},0);
                for(nint hosted=GetTopWindow(0);hosted!=0;hosted=GetWindow(hosted,2))if(hosted!=window&&Class(hosted)=="Chrome_WidgetWin_1"&&(GetAncestor(hosted,3)==owner||WebProcess(hosted,webProcesses))&&IsWindowVisible(hosted)&&AtPoint(hosted,point)){window=hosted;break;}
            }
            if(probeRoot!=0&&window!=probeRoot&&GetAncestor(window,3)!=probeRoot){LastReason="Another window covers the verification target: "+Class(window);return 0;}
            if(!clientOnly)return window;
            var browserInput=BrowserInput(window,point);if(browserInput!=window)return browserInput;
            for(int depth=0;depth<15;depth++){var p=new NativePoint{X=(int)Math.Round(point.X),Y=(int)Math.Round(point.Y)};if(!ScreenToClient(window,ref p))return 0;var child=ChildWindowFromPointEx(window,p,7);if(child==0||child==window)break;
                if(Class(child)=="Intermediate D3D Window")break;window=child;
            }
            var client=new NativePoint{X=(int)Math.Round(point.X),Y=(int)Math.Round(point.Y)};if(!ScreenToClient(window,ref client)||!GetClientRect(window,out var bounds)||client.X<0||client.Y<0||client.X>=bounds.right||client.Y>=bounds.bottom)return 0;
            return window;
        }return 0;
    }
    private static nint BrowserInput(nint root,PointD point){
        GetWindowThreadProcessId(root,out var pid);try{if(System.Diagnostics.Process.GetProcessById((int)pid).ProcessName!="msedgewebview2")return root;}catch{return root;}
        nint render=0;EnumChildWindows(root,(child,_)=>{if(Class(child)=="Chrome_RenderWidgetHostHWND"&&IsWindowVisible(child)&&AtPoint(child,point)){render=child;return false;}return true;},0);return render==0?root:render;
    }
    private static bool WebProcess(nint window,HashSet<uint> processes){GetWindowThreadProcessId(window,out var pid);if(processes.Contains(pid))return true;for(int depth=0;depth<5&&pid!=0;depth++){pid=ParentProcess(pid);if(processes.Contains(pid))return true;}return false;}
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<uint,(long time,uint parent)> parents=new();
    private static uint ParentProcess(uint pid){if(parents.TryGetValue(pid,out var cached)&&Environment.TickCount64-cached.time<1500)return cached.parent;uint parent=0;var handle=OpenProcess(0x1000,false,pid);if(handle!=0)try{if(NtQueryInformationProcess(handle,0,out var info,Marshal.SizeOf<ProcessInfo>(),out _)==0)parent=(uint)info.parent.ToInt64();}finally{CloseHandle(handle);}if(parents.Count>256)parents.Clear();parents[pid]=(Environment.TickCount64,parent);return parent;}
    [StructLayout(LayoutKind.Sequential)]private struct ProcessInfo{public nint reserved,peb,reserved2,reserved3,pid,parent;}
    [DllImport("kernel32.dll")]private static extern nint OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll")]private static extern bool CloseHandle(nint handle);
    [DllImport("ntdll.dll")]private static extern int NtQueryInformationProcess(nint process,int kind,out ProcessInfo info,int length,out int returned);
    [DllImport("user32.dll")]private static extern bool IsIconic(nint window);
    private static bool AtPoint(nint window,PointD point)=>GetWindowRect(window,out var r)&&point.X>=r.left&&point.X<r.right&&point.Y>=r.top&&point.Y<r.bottom;
    [DllImport("user32.dll")]private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")]private static extern bool SetForegroundWindow(nint window);
    [DllImport("user32.dll",SetLastError=true)]private static extern nint SendMessageTimeout(nint window,uint message,nint w,nint l,uint flags,uint timeout,out nint result);
    internal static async Task<object> CheckRouting(bool clickSearch=false){var results=new List<object>();for(nint w=GetTopWindow(0);w!=0;w=GetWindow(w,2)){var title=new StringBuilder(256);GetWindowText(w,title,256);bool whatsapp=title.ToString()=="WhatsApp"&&Class(w)=="WinUIDesktopWin32WindowClass";bool taskbar=Class(w)=="Shell_TrayWnd";if(!whatsapp&&!taskbar)continue;
        GetWindowRect(w,out var r);var point=whatsapp?new PointD(r.left+(r.right-r.left)*.25,r.top+(r.bottom-r.top)*.2):new PointD(r.left+(r.right-r.left)*.455,(r.top+r.bottom)/2.0);var root=TargetAt(point,false);if(root==0)continue;string click=null;bool taskbarEligible=false;bool? taskbarMinimized=null,taskbarRestored=null;
        if(taskbar&&clickSearch){var button=await CodyAccessibilityInput.TaskbarPoint(root);if(button.Handled){taskbarEligible=true;using var location=System.Text.Json.JsonDocument.Parse(button.Text);point=new PointD(location.RootElement.GetProperty("x").GetDouble(),location.RootElement.GetProperty("y").GetDouble());}}
        var before=ClickyScreenActuator.CurrentPointer;if(whatsapp&&clickSearch){Begin();try{await GlideAsync(point,.05);click=(await ClickAsync(point)).ToString()+"/"+LastMethod;}finally{End();}await Task.Delay(200);}if(taskbar&&clickSearch&&taskbarEligible){nint app=0;for(nint candidate=GetTopWindow(0);candidate!=0;candidate=GetWindow(candidate,2)){var name=new StringBuilder(256);GetWindowText(candidate,name,256);if(name.ToString()=="WhatsApp"&&Class(candidate)=="WinUIDesktopWin32WindowClass"){app=candidate;break;}}if(app!=0){Begin();try{await GlideAsync(point,.05);click=(await ClickAsync(point)).ToString()+"/"+LastMethod;await Task.Delay(350);taskbarMinimized=IsIconic(app);if(taskbarMinimized==false){click+=" -> "+(await ClickAsync(point)).ToString()+"/"+LastMethod;await Task.Delay(350);taskbarMinimized=IsIconic(app);}if(taskbarMinimized==true){click+=" -> "+(await ClickAsync(point)).ToString()+"/"+LastMethod;await Task.Delay(350);taskbarRestored=!IsIconic(app);}}finally{End();}}}
        var after=ClickyScreenActuator.CurrentPointer;var result=await CodyAccessibilityInput.Check(BrowserInput(root,point),point,whatsapp);results.Add(new{click,taskbarMinimized,taskbarRestored,pointerUnchanged=before==after,app=whatsapp?"WhatsApp":"Taskbar",rootClass=Class(root),receiverClass=Class(TargetAt(point)),result});}return results;}
    internal static object Diagnose(){var roots=new List<object>();for(nint w=GetTopWindow(0);w!=0;w=GetWindow(w,2)){var title=new StringBuilder(256);GetWindowText(w,title,256);string cls=Class(w);if(title.ToString()!="WhatsApp"&&cls!="Shell_TrayWnd")continue;var children=new List<object>();EnumChildWindows(w,(child,_)=>{if(children.Count<70)children.Add(WindowInfo(child));return children.Count<70;},0);var sample=new PointD((routableX(w)),routableY(w));roots.Add(new{window=WindowInfo(w),children,route=new{root=TargetAt(sample,false).ToString(),receiver=TargetAt(sample).ToString(),x=sample.X,y=sample.Y}});}return roots;}
    private static double routableX(nint w){GetWindowRect(w,out var r);return r.left+(r.right-r.left)*.25;}
    private static double routableY(nint w){GetWindowRect(w,out var r);return Class(w)=="Shell_TrayWnd"?(r.top+r.bottom)/2.0:r.top+(r.bottom-r.top)*.2;}
    private static string Class(nint window){var text=new StringBuilder(128);GetClassName(window,text,128);return text.ToString();}
    private static object WindowInfo(nint window){GetWindowRect(window,out var r);GetWindowThreadProcessId(window,out var pid);return new{pid,handle=window.ToString(),@class=Class(window),owner=GetAncestor(window,3).ToString(),visible=IsWindowVisible(window),left=r.left,top=r.top,right=r.right,bottom=r.bottom};}
    private delegate bool EnumWindow(nint window,nint data);
    [DllImport("user32.dll")]private static extern bool EnumChildWindows(nint root,EnumWindow callback,nint data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetClassName(nint window,StringBuilder name,int count);
    private static bool TitlebarAction(nint root,PointD point,int count){
        var hit=SendMessage(root,0x84,0,Pack((int)point.X,(int)point.Y)).ToInt32();
        if(hit==8)return ShowWindowAsync(root,6);if(hit==9||hit==2&&count==2)return ShowWindowAsync(root,IsZoomed(root)?9:3);if(hit==20)return PostMessage(root,0x10,0,0);return false;
    }
    private static string ReadClipboard(){if(!OpenClipboard(0))return null;try{var handle=GetClipboardData(13);if(handle==0)return null;var data=GlobalLock(handle);if(data==0)return null;try{return Marshal.PtrToStringUni(data);}finally{GlobalUnlock(handle);}}finally{CloseClipboard();}}
    internal static async Task<object> Probe(string handle,double x,double y,string text,string gesture="click",string key="",bool useSystemInput=false){
        var root=(nint)long.Parse(handle);var title=new StringBuilder(256);GetWindowText(root,title,title.Capacity);GetWindowThreadProcessId(root,out uint pid);
        if(!CodyControlFixtures.Owns(root)&&(title.ToString()!="CODY independent cursor verification"||System.Diagnostics.Process.GetProcessById((int)pid).ProcessName!="electron"))throw new InvalidOperationException("Only owned verification windows may receive probe input.");
        var before=ClickyScreenActuator.CurrentPointer;probeRoot=root;
        try{
            Begin(useSystemInput);CodyDriveVisuals.Show("Verifying computer control");CodyDriveVisuals.Acting(true);await GlideAsync(new PointD(x,y),.1);
            bool protectedMouse=CodyMouseGuard.Active,customCursor=CodySystemCursor.Active;bool? untaggedBlocked=null;
            if(useSystemInput&&gesture=="guard"){var pinned=CurrentPointer;long dropped=CodyMouseGuard.Dropped;CodyMouseGuard.TestUntaggedNudge();await Task.Delay(60);untaggedBlocked=CurrentPointer==pinned&&CodyMouseGuard.Dropped>dropped;}
            if(gesture=="escape"){var escape=new CodyEscapeTakeBack.KeyState();escape.Handle(27,true,false,0,()=>active,End);}
            var clicked=gesture is "key-only" or "hover" or "guard"?ClickyActuation.Done:gesture=="scroll"?await ScrollAsync(-2):gesture=="drag"?await DragAsync(new[]{CurrentPointer,new PointD(x+20,y),new PointD(x+40,y),new PointD(x+60,y)}):await ClickAsync(CurrentPointer,gesture=="right"?ClickyMouseButton.Right:ClickyMouseButton.Left,gesture=="double"?2:1);
            string clickMethod=LastMethod,reason=LastReason;
            var selected=gesture=="select-type"?await PressAsync("ctrl+a"):ClickyActuation.Done;
            var keyResult=string.IsNullOrEmpty(key)?ClickyActuation.Done:await PressAsync(key);
            var typed=string.IsNullOrEmpty(text)?ClickyActuation.Done:selected!=ClickyActuation.Done?selected:await TypeAsync(text);string typeMethod=LastMethod;if(typed!=ClickyActuation.Done||keyResult!=ClickyActuation.Done)reason=LastReason;
            var refused=await PressAsync("ctrl+alt+unsupported");
            End();var stopped=await ClickAsync(new PointD(x,y));
            var after=ClickyScreenActuator.CurrentPointer;return new{protectedMouse,customCursor,untaggedBlocked,mouseReleased=!CodyMouseGuard.Active,normalCursorRestored=!CodySystemCursor.Active,clicked=clicked.ToString(),typed=typed.ToString(),selected=selected.ToString(),key=keyResult.ToString(),method=clickMethod,typeMethod,reason,stoppedInputRefused=stopped==ClickyActuation.Refused,globalChordRefused=refused==ClickyActuation.Refused,before=new{x=before.X,y=before.Y},after=new{x=after.X,y=after.Y}};
        }
        finally{CodyDriveVisuals.Hide();End();probeRoot=0;if(useSystemInput)ClickyScreenActuator.MoveTo(before);}
    }
    [StructLayout(LayoutKind.Sequential)]private struct NativePoint{public int X,Y;}
    [StructLayout(LayoutKind.Sequential)]private struct Rect{public int left,top,right,bottom;}
    [StructLayout(LayoutKind.Sequential)]private struct GuiThreadInfo{public int size,flags;public nint active,focus,capture,menuOwner,moveSize,caret;public Rect caretRect;}
    [DllImport("user32.dll",SetLastError=true)]private static extern bool PostMessage(nint window,uint message,nint w,nint l);
    [DllImport("user32.dll")]private static extern bool ScreenToClient(nint window,ref NativePoint point);
    [DllImport("user32.dll")]private static extern bool GetWindowRect(nint window,out Rect rect);
    [DllImport("user32.dll")]private static extern bool GetClientRect(nint window,out Rect rect);
    [DllImport("user32.dll")]private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")]private static extern bool IsWindow(nint window);
    [DllImport("user32.dll")]private static extern nint GetTopWindow(nint window);
    [DllImport("user32.dll")]private static extern nint GetWindow(nint window,uint direction);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]private static extern nint GetWindowLongPtr(nint window,int index);
    [DllImport("user32.dll")]private static extern nint ChildWindowFromPointEx(nint window,NativePoint point,uint flags);
    [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(nint window,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetWindowText(nint window,StringBuilder text,int count);
    [DllImport("user32.dll")]private static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
    [DllImport("user32.dll")]private static extern nint GetAncestor(nint window,uint flags);
    [DllImport("user32.dll")]private static extern uint MapVirtualKey(uint code,uint type);
    [DllImport("dwmapi.dll")]private static extern int DwmGetWindowAttribute(nint window,int attribute,out int value,int size);
    [DllImport("user32.dll")]private static extern nint SendMessage(nint window,uint message,nint w,nint l);
    [DllImport("user32.dll")]private static extern bool ShowWindowAsync(nint window,int state);
    [DllImport("user32.dll")]private static extern bool IsZoomed(nint window);
    [DllImport("user32.dll")]private static extern bool OpenClipboard(nint window);
    [DllImport("user32.dll")]private static extern bool CloseClipboard();
    [DllImport("user32.dll")]private static extern nint GetClipboardData(uint format);
    [DllImport("kernel32.dll")]private static extern nint GlobalLock(nint memory);
    [DllImport("kernel32.dll")]private static extern bool GlobalUnlock(nint memory);
}
