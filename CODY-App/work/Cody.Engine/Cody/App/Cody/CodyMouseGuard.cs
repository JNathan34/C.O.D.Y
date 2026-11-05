using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
using HeyClicky.Platform.Input;
namespace HeyClicky.App.Cody;

// Filter desktop input while allowing C.O.D.Y. events and physical Esc.
internal static class CodyMouseGuard
{
    private static readonly object gate=new();
    private static readonly Hook mouseCallback=OnMouse;
    private static readonly Hook keyboardCallback=OnKey;
    private static uint threadId;private static volatile int generation;private static volatile bool holding;
    private static Timer watchdog;private static long heartbeat,dropped;private static Action failed;
    internal static bool Active=>holding;
    internal static long Dropped=>Interlocked.Read(ref dropped);
    internal static bool ShouldBlock(nuint tag)=>tag!=ClickyInputProvenance.Tag;
    static CodyMouseGuard(){AppDomain.CurrentDomain.ProcessExit+=(_,_)=>Stop();}
    internal static void Pulse()=>Interlocked.Exchange(ref heartbeat,Environment.TickCount64);
    internal static bool ShouldBlockKey(uint key, uint flags, nuint tag) =>
        ShouldBlock(tag) && (key != 0x1B || (flags & 0x10) != 0);

    internal static void Start(bool showSystemCursor, Action onFailure){
        lock(gate){
            if(holding)return;int ticket=++generation;failed=onFailure;dropped=0;
            var ready = new System.Threading.Tasks.TaskCompletionSource<uint>();
            var thread = new Thread(() =>
            {
                uint localThread = GetCurrentThreadId();
                PeekMessage(out _, 0, 0, 0, 0);
                nint mouse = 0, keyboard = 0, touchSink = 0;
                try
                {
                    nint module = GetModuleHandle(null);
                    mouse = SetWindowsHookEx(14, mouseCallback, module, 0);
                    if (mouse == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                    keyboard = SetWindowsHookEx(13, keyboardCallback, module, 0);
                    if (keyboard == 0) throw new Win32Exception(Marshal.GetLastWin32Error());

                    // Windows requires UIAccess for desktop-wide native pointer redirection.
                    // The mouse hook also covers touch and trackpad input promoted to mouse events.
                    touchSink = CreateWindowEx(0, "STATIC", null, 0, 0, 0, 0, 0, -3, 0, module, 0);
                    if (touchSink != 0)
                    {
                        RegisterPointerInputTarget(touchSink, 2); // PT_TOUCH
                        RegisterPointerInputTarget(touchSink, 5); // PT_TOUCHPAD
                    }

                    ready.TrySetResult(localThread);
                    if (ticket != generation) return;
                    while (GetMessage(out var message, 0, 0, 0) > 0)
                        DispatchMessage(ref message);
                }
                catch (Exception error)
                {
                    ready.TrySetException(error);
                }
                finally
                {
                    if (touchSink != 0) DestroyWindow(touchSink);
                    if (keyboard != 0) UnhookWindowsHookEx(keyboard);
                    if (mouse != 0) UnhookWindowsHookEx(mouse);
                }
            }) { IsBackground = true, Name = "CODY input guard" };

            try
            {
                thread.Start();
                threadId = ready.Task.WaitAsync(TimeSpan.FromMilliseconds(1500)).GetAwaiter().GetResult();
                if (showSystemCursor) CodySystemCursor.Start();
                Pulse();
                holding = true;
                watchdog = new Timer(_ =>
                {
                    Action cancel;
                    lock (gate)
                    {
                        if (ticket != generation || !holding ||
                            Environment.TickCount64 - Interlocked.Read(ref heartbeat) <= 3000) return;
                        cancel = failed;
                        Stop();
                    }
                    cancel?.Invoke();
                }, null, 500, 500);
            }
            catch
            {
                Stop();
                throw;
            }
        }
    }
    internal static void Stop(){lock(gate){holding=false;generation++;watchdog?.Dispose();watchdog=null;CodySystemCursor.Restore();if(threadId!=0)PostThreadMessage(threadId,0x12,0,0);threadId=0;failed=null;}}
    private static nint OnKey(int code, nint message, nint data)
    {
        if (code >= 0 && holding)
        {
            var key = Marshal.PtrToStructure<KeyEvent>(data);
            if (ShouldBlockKey(key.Key, key.Flags, key.Extra)) return 1;
        }
        return CallNextHookEx(0, code, message, data);
    }
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
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyEvent { public uint Key, Scan, Flags, Time; public nuint Extra; }
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
    [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern nint CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")] private static extern bool RegisterPointerInputTarget(nint window, uint type);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll")]private static extern nint DispatchMessage(ref Message message);
    [DllImport("user32.dll")]private static extern bool PostThreadMessage(uint thread,uint message,nuint w,nint l);
    [DllImport("kernel32.dll")]private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern nint GetModuleHandle(string name);
    [DllImport("user32.dll")]private static extern int GetSystemMetrics(int metric);
    [DllImport("user32.dll",SetLastError=true)]private static extern uint SendInput(uint count,Input[] inputs,int size);
}
