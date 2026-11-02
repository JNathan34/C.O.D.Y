using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.UI.Dispatching;
namespace HeyClicky.App.Cody;

// Reassert the overlay group on window-order events without taking foreground focus.
internal static class CodyOverlayOrder
{
    private static nint[] layers=Array.Empty<nint>();
    private static nint island,foregroundHook,orderHook,contender;
    private static uint clientPid;
    private static DispatcherQueue dispatcher;
    private static readonly WinEventCallback callback=Changed;
    private static int queued;
    private static long retryAfter;
    private static long repairs;
    private static DispatcherQueueTimer repairTimer,watchdog;
    private const uint KeepGeometryAndFocus=0x213;
    internal static void Start(DispatcherQueue queue){
        dispatcher=queue;
        foregroundHook=SetWinEventHook(3,3,0,callback,0,0,0);
        orderHook=SetWinEventHook(0x8002,0x8004,0,callback,0,0,0);
        // Shell/compositor changes do not always deliver window-order events.
        // Check visible overlays too; Refresh leaves correctly ordered windows alone.
        watchdog=queue.CreateTimer();watchdog.Interval=TimeSpan.FromMilliseconds(250);
        watchdog.Tick+=(_,_)=>{if(HasVisibleClient())Refresh();};watchdog.Start();
    }
    internal static void Stop(){if(foregroundHook!=0)UnhookWinEvent(foregroundHook);if(orderHook!=0)UnhookWinEvent(orderHook);foregroundHook=orderHook=0;repairTimer?.Stop();repairTimer=null;watchdog?.Stop();watchdog=null;TestContender(false);layers=Array.Empty<nint>();}
    private static void Changed(nint hook,uint kind,nint window,int obj,int child,uint thread,uint time){
        if(!HasVisibleClient()||dispatcher==null||kind!=3&&kind!=0x8004&&(obj!=0||child!=0))return;
        if(Interlocked.Exchange(ref queued,1)!=0)return;
        if(!dispatcher.TryEnqueue(DispatcherQueuePriority.High,()=>{Interlocked.Exchange(ref queued,0);Refresh();}))Interlocked.Exchange(ref queued,0);
    }
    private static bool OwnedBy(nint window,uint pid){GetWindowThreadProcessId(window,out uint owner);return window!=0&&IsWindow(window)&&owner==pid;}
    private static bool HasVisibleClient()=>OwnedBy(island,clientPid)&&IsWindowVisible(island)||layers.Any(IsWindowVisible);
    private static string Class(nint window){var name=new StringBuilder(96);GetClassName(window,name,name.Capacity);return name.ToString();}
    private static bool Visible(nint window){
        if(!IsWindowVisible(window)||Class(window)=="SysShadow"||!GetWindowRect(window,out var r)||r.right<=r.left||r.bottom<=r.top)return false;
        return DwmGetWindowAttribute(window,14,out int cloaked,4)!=0||cloaked==0;
    }
    private static List<nint> Stack(){var result=new List<nint>();EnumWindows((window,_)=>{if(Visible(window))result.Add(window);return true;},0);return result;}
    private static bool Overlap(nint first,nint second){if(!GetWindowRect(first,out var a)||!GetWindowRect(second,out var b))return false;return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
    internal static object Register(uint pid,string[] handles,string islandHandle){
        if(handles.Length>16||pid==0)throw new ArgumentException("Invalid overlay registration.");
        nint Parse(string value){if(!long.TryParse(value,out long raw)||raw<=0)return 0;return (nint)raw;}
        var next=handles.Select(Parse).ToArray();
        if(next.Any(h=>!OwnedBy(h,pid)||!Class(h).StartsWith("Chrome_WidgetWin_",StringComparison.Ordinal)||((long)GetWindowLongPtr(h,-20)&0x08000000)==0))throw new ArgumentException("Overlay handles must be non-activating C.O.D.Y. windows.");
        var anchor=Parse(islandHandle);if(anchor!=0&&!OwnedBy(anchor,pid))throw new ArgumentException("Invalid island window.");
        clientPid=pid;layers=next;island=anchor;Refresh();return new{registered=layers.Length,eventDriven=foregroundHook!=0&&orderHook!=0};
    }
    private static bool NeedsRepair(List<nint> stack,nint[] protectedWindows){
        foreach(var surface in protectedWindows){
            int index=stack.IndexOf(surface);if(index<0)continue;
            if(((long)GetWindowLongPtr(surface,-20)&8)==0)return true;
            if(island!=0&&Visible(island)&&Overlap(surface,island)&&stack.IndexOf(island)>index)return true;
            // The canvas spans the whole display but is mostly transparent.
            // Its bounds must not cause a fight with taskbars and other overlays.
            // Only the explicit computer-control layers need external-app repair.
            if(!layers.Contains(surface))continue;
            for(int i=0;i<index;i++){
                var window=stack[i];GetWindowThreadProcessId(window,out uint pid);
                if(pid==clientPid||protectedWindows.Contains(window)||window==island)continue;
                if(Overlap(surface,window))return true;
            }
        }
        return false;
    }
    internal static void Refresh(){
        if(Environment.TickCount64<retryAfter){
            if(dispatcher!=null&&repairTimer==null){repairTimer=dispatcher.CreateTimer();repairTimer.IsRepeating=false;repairTimer.Interval=TimeSpan.FromMilliseconds(Math.Max(16,retryAfter-Environment.TickCount64));repairTimer.Tick+=(_,_)=>{repairTimer=null;Refresh();};repairTimer.Start();}return;
        }
        var stack=Stack();var drawing=stack.Where(window=>{GetWindowThreadProcessId(window,out uint pid);return pid==Environment.ProcessId&&(Class(window) is "HeyClickyDrawingWindow" or "HeyClickyOverlayWindow");}).ToArray();
        var visibleLayers=layers.Where(h=>OwnedBy(h,clientPid)&&Visible(h)).ToArray();
        var protectedWindows=visibleLayers.Concat(HeyClicky.Platform.Win32.ScreenCaptureYield.IsYielding?Array.Empty<nint>():drawing).ToArray();
        if(!NeedsRepair(stack,protectedWindows))return;
        Interlocked.Increment(ref repairs);
        // Insert drawing surfaces below the chat from the outset. Raising each
        // model to HWND_TOPMOST first briefly covers the chat and causes flicker.
        nint after=-1;
        if(OwnedBy(island,clientPid)&&Visible(island)){SetWindowPos(island,-1,0,0,0,0,KeepGeometryAndFocus);after=island;}
        foreach(var surface in protectedWindows.Skip(visibleLayers.Length).Concat(visibleLayers)){
            SetWindowPos(surface,after,0,0,0,0,KeepGeometryAndFocus);after=surface;
        }
        // Higher Windows security bands cannot be reordered by a regular app.
        // Avoid repeatedly churning the desktop if the OS declines the order.
        retryAfter=Environment.TickCount64+(NeedsRepair(Stack(),protectedWindows)?500:16);
    }
    internal static object Snapshot(){
        var stack=Stack();var visible=layers.Where(h=>OwnedBy(h,clientPid)&&Visible(h)).ToArray();
        var drawing=stack.Where(h=>{GetWindowThreadProcessId(h,out uint pid);return pid==Environment.ProcessId&&(Class(h) is "HeyClickyDrawingWindow" or "HeyClickyOverlayWindow");}).ToArray();
        var protectedWindows=visible.Concat(drawing).ToArray();
        return new{registered=layers.Length,visible=visible.Length,drawing=drawing.Length,repairs=Interlocked.Read(ref repairs),eventDriven=foregroundHook!=0&&orderHook!=0,aboveApps=!NeedsRepair(stack,protectedWindows),islandAbove= !Visible(island)||protectedWindows.All(h=>!Overlap(h,island)||stack.IndexOf(island)<stack.IndexOf(h)),foreground=GetForegroundWindow().ToString()};
    }
    // A non-activating, click-through foreign test surface; never sends input.
    internal static object TestContender(bool show){
        if(!show){if(contender!=0)DestroyWindow(contender);contender=0;return Snapshot();}
        if(contender==0)contender=CreateWindowEx(0x08080088|0x20,"STATIC","C.O.D.Y. overlay order check",0x80000000,100,160,96,96,0,0,0,0);
        // Include the real taskbar in the stacking check, without activating it.
        nint taskbar=FindWindow("Shell_TrayWnd",null);
        if(taskbar!=0)SetWindowPos(taskbar,-1,0,0,0,0,KeepGeometryAndFocus);
        SetLayeredWindowAttributes(contender,0,1,2);ShowWindow(contender,4);SetWindowPos(contender,-1,0,0,0,0,KeepGeometryAndFocus);return new{shown=IsWindowVisible(contender),foreground=GetForegroundWindow().ToString()};
    }
    private struct Rect{public int left,top,right,bottom;}
    private delegate bool EnumCallback(nint window,nint data);
    private delegate void WinEventCallback(nint hook,uint kind,nint window,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll")]private static extern nint SetWinEventHook(uint min,uint max,nint module,WinEventCallback callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")]private static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll")]private static extern bool EnumWindows(EnumCallback callback,nint data);
    [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(nint window,out uint pid);
    [DllImport("user32.dll")]private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")]private static extern bool IsWindow(nint window);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetClassName(nint window,StringBuilder name,int length);
    [DllImport("user32.dll")]private static extern bool GetWindowRect(nint window,out Rect rect);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]private static extern nint GetWindowLongPtr(nint window,int index);
    [DllImport("dwmapi.dll")]private static extern int DwmGetWindowAttribute(nint window,int attribute,out int value,int size);
    [DllImport("user32.dll")]private static extern bool SetWindowPos(nint window,nint after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")]private static extern nint GetForegroundWindow();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern nint FindWindow(string cls,string title);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern nint CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,nint parent,nint menu,nint instance,nint parameter);
    [DllImport("user32.dll")]private static extern bool ShowWindow(nint window,int command);
    [DllImport("user32.dll")]private static extern bool SetLayeredWindowAttributes(nint window,uint key,byte alpha,uint flags);
    [DllImport("user32.dll")]private static extern bool DestroyWindow(nint window);
}
