using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
using HeyClicky.Platform.Input;
namespace HeyClicky.App.Cody;

// Mouse-only capture: keyboard hooks, Esc and Ctrl+Alt keep working normally.
internal static class CodyMouseGuard
{
    private static readonly object gate=new();
    private static readonly Hook callback=OnMouse;
    private static nint hook;private static uint threadId;private static int generation;private static volatile bool holding;
    private static Timer watchdog;private static long heartbeat,dropped;private static Action failed;
    internal static bool Active=>holding;
    internal static long Dropped=>Interlocked.Read(ref dropped);
    internal static bool ShouldBlock(nuint tag)=>tag!=ClickyInputProvenance.Tag;
    static CodyMouseGuard(){AppDomain.CurrentDomain.ProcessExit+=(_,_)=>Stop();}
    internal static void Pulse()=>Interlocked.Exchange(ref heartbeat,Environment.TickCount64);
    internal static void Start(Action onFailure){
        lock(gate){
            if(holding)return;int ticket=++generation;failed=onFailure;dropped=0;
            var ready=new ManualResetEventSlim();Exception failure=null;
            var thread=new Thread(()=>{
                uint localThread=GetCurrentThreadId();PeekMessage(out _,0,0,0,0);
                nint localHook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);
                if(localHook==0)failure=new Win32Exception(Marshal.GetLastWin32Error());
                if(ticket==generation){threadId=localThread;hook=localHook;}
                ready.Set();if(localHook==0)return;
                if(ticket!=generation){UnhookWindowsHookEx(localHook);return;}
                try{while(GetMessage(out var message,0,0,0)>0){TranslateMessage(ref message);DispatchMessage(ref message);}}
                finally{UnhookWindowsHookEx(localHook);if(ticket==generation){hook=0;threadId=0;}}
            }){IsBackground=true,Name="CODY mouse guard"};
            thread.Start();if(!ready.Wait(1500)||failure!=null){Stop();throw new InvalidOperationException("Mouse protection could not start.",failure);}
            try{CodySystemCursor.Start();Pulse();holding=true;watchdog=new Timer(_=>{if(holding&&Environment.TickCount64-Interlocked.Read(ref heartbeat)>3000){var cancel=failed;Stop();cancel?.Invoke();}},null,500,500);}
            catch{Stop();throw;}
        }
    }
    internal static void Stop(){lock(gate){holding=false;generation++;watchdog?.Dispose();watchdog=null;CodySystemCursor.Restore();if(threadId!=0)PostThreadMessage(threadId,0x12,0,0);threadId=0;hook=0;failed=null;}}
    private static nint OnMouse(int code,nint message,nint data){
        if(code>=0&&holding){var mouse=Marshal.PtrToStructure<MouseEvent>(data);if(ShouldBlock(mouse.Extra)){Interlocked.Increment(ref dropped);return 1;}}
        return CallNextHookEx(0,code,message,data);
    }
    internal static void MoveTo(PointD point){
        if(!holding){ClickyScreenActuator.MoveTo(point);return;}
        int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
        var input=new Input{Type=0,Mouse=new MouseInput{X=(int)Math.Round(Math.Clamp((point.X-left)/Math.Max(1,width-1),0,1)*65535),Y=(int)Math.Round(Math.Clamp((point.Y-top)/Math.Max(1,height-1),0,1)*65535),Flags=0xC001,Extra=ClickyInputProvenance.Tag}};
        if(SendInput(1,new[]{input},Marshal.SizeOf<Input>())!=1)throw new Win32Exception(Marshal.GetLastWin32Error(),"Windows refused the protected pointer move.");
    }
    internal static void TestUntaggedNudge(){var input=new Input{Type=0,Mouse=new MouseInput{X=35,Y=20,Flags=1}};SendInput(1,new[]{input},Marshal.SizeOf<Input>());}
    private delegate nint Hook(int code,nint message,nint data);
    [StructLayout(LayoutKind.Sequential)]private struct MouseEvent{public int X,Y;public uint Data,Flags,Time;public nuint Extra;}
    [StructLayout(LayoutKind.Sequential)]private struct MouseInput{public int X,Y;public uint Data,Flags,Time;public nuint Extra;}
    [StructLayout(LayoutKind.Explicit,Size=40)]private struct Input{[FieldOffset(0)]public uint Type;[FieldOffset(8)]public MouseInput Mouse;}
    [StructLayout(LayoutKind.Sequential)]private struct Message{public nint Window;public uint Id;public nuint W;public nint L;public uint Time;public int X,Y;public uint Private;}
    [DllImport("user32.dll",SetLastError=true)]private static extern nint SetWindowsHookEx(int kind,Hook callback,nint module,uint thread);
    [DllImport("user32.dll")]private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")]private static extern nint CallNextHookEx(nint hook,int code,nint message,nint data);
    [DllImport("user32.dll")]private static extern int GetMessage(out Message message,nint window,uint min,uint max);
    [DllImport("user32.dll")]private static extern bool PeekMessage(out Message message,nint window,uint min,uint max,uint remove);
    [DllImport("user32.dll")]private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")]private static extern nint DispatchMessage(ref Message message);
    [DllImport("user32.dll")]private static extern bool PostThreadMessage(uint thread,uint message,nuint w,nint l);
    [DllImport("kernel32.dll")]private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern nint GetModuleHandle(string name);
    [DllImport("user32.dll")]private static extern int GetSystemMetrics(int metric);
    [DllImport("user32.dll",SetLastError=true)]private static extern uint SendInput(uint count,Input[] inputs,int size);
}
