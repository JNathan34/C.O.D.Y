using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Drawing;
namespace HeyClicky.App.Cody;

// Adapt the bundled drawing engine's own figure windows; no global scroll remapping.
internal static class CodyModelZoom
{
    private const BindingFlags Fields=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
    private static readonly ConcurrentDictionary<nint,Binding> figures=new();
    private static readonly Hook callback=OnMouse;
    private static readonly Stopwatch clock=Stopwatch.StartNew();
    private static ScreenDrawingCanvas canvas;
    private static MethodInfo post;
    private static nint hook;
    private static Timer animation;
    private static int queued;
    private static long wheels;
    private static string error;
    private static object Field(object value,string name)=>value?.GetType().GetField(name,Fields)?.GetValue(value);
    private static object Property(object value,string name)=>value?.GetType().GetProperty(name,Fields)?.GetValue(value);
    private static void Post(Action action){try{post?.Invoke(canvas,new object[]{(Action)(()=>{try{action();}catch(Exception ex){error=ex.GetBaseException().Message;}})});}catch(Exception ex){error=ex.GetBaseException().Message;}}
    internal static void Start(ScreenDrawingCanvas value){
        canvas=value;post=value.GetType().GetMethod("PostToDrawingThread",Fields);
        CodyModelDrag.Start(value,Post);
        hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);
        if(hook==0)error="Mouse-wheel hook could not start: "+Marshal.GetLastWin32Error();
        animation=new Timer(_=>{
            if((!CodyModelDrag.Active&&!figures.Values.Any(x=>x.Animating))||Interlocked.Exchange(ref queued,1)!=0)return;
            Post(()=>{try{CodyModelDrag.Tick();foreach(var binding in figures.Values)binding.Tick();}finally{Volatile.Write(ref queued,0);}});
        },null,16,16);Refresh();
    }
    internal static void Refresh()=>Post(()=>{
        object painter=Field(canvas,"painter"),adapter=Property(painter,"Figures")??Field(painter,"Figures");
        if(Field(adapter,"stages") is not IDictionary stages)return;
        var live=new HashSet<nint>();
        foreach(DictionaryEntry entry in stages){var figure=entry.Value;object handle=Field(figure,"Handle"),stage=Field(figure,"Stage");if(handle==null||stage==null)continue;
            nint hwnd=(nint)(Property(handle,"Handle")??nint.Zero);if(hwnd==0)continue;live.Add(hwnd);
            if(!figures.TryGetValue(hwnd,out var existing)||!ReferenceEquals(existing.Stage,stage))figures[hwnd]=new Binding(stage,figure,hwnd);
        }
        foreach(nint hwnd in figures.Keys)if(!live.Contains(hwnd))figures.TryRemove(hwnd,out _);
    });
    private static nint OnMouse(int code,nint message,nint data){
        if(code>=0){var input=Marshal.PtrToStructure<MouseEvent>(data);
            bool control=(GetAsyncKeyState(0x11)&0x8000)!=0&&(GetAsyncKeyState(0x12)&0x8000)==0;
            if(RouteDrag((int)message,input.Point.X,input.Point.Y,control)&&message!=0x200)return 1;
            if(message==0x20A&&RouteWheel(input.Point,(short)(input.MouseData>>16))){Interlocked.Increment(ref wheels);return 1;}
        }
        return CallNextHookEx(hook,code,message,data);
    }
    private static Binding Pick(Point point){
        nint hwnd=GetAncestor(WindowFromPoint(point),2);
        for(int i=0;i<200&&hwnd!=0;i++,hwnd=GetWindow(hwnd,2)){
            if(!IsWindowVisible(hwnd)||!GetWindowRect(hwnd,out var rect)||point.X<rect.Left||point.X>=rect.Right||point.Y<rect.Top||point.Y>=rect.Bottom)continue;
            if((GetWindowLong(hwnd,-20)&0x20)!=0)continue;
            return figures.TryGetValue(hwnd,out var binding)?binding:null;
        }return null;
    }
    private static bool RouteWheel(Point point,int delta){var binding=delta==0?null:Pick(point);if(binding==null)return false;Post(()=>binding.Wheel(delta));return true;}
    private static bool RouteDrag(int message,int x,int y,bool control)=>CodyModelDrag.Mouse(message,x,y,control,(px,py)=>{var binding=Pick(new Point{X=px,Y=py});return (binding?.Figure,binding?.Handle??0);});
    internal static bool DragForTest(string action,int x,int y,bool control)=>RouteDrag(action switch{"down"=>0x201,"move"=>0x200,"up"=>0x202,_=>throw new ArgumentException("Invalid drag action")},x,y,control);
    internal static bool WheelAtPointForTest(int x,int y,int delta)=>RouteWheel(new Point{X=x,Y=y},delta);
    internal static bool WheelForTest(string handle,int delta){if(!long.TryParse(handle,out long raw)||!figures.TryGetValue((nint)raw,out var binding)||delta==0||!IsWindowVisible(binding.Handle))return false;Post(()=>binding.Wheel(delta));return true;}
    internal static Task<object> Snapshot(){var answer=new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);Post(()=>answer.TrySetResult(new{hookInstalled=hook!=0,wheels=Interlocked.Read(ref wheels),error,figures=figures.Values.Select(x=>x.Snapshot()).ToArray()}));return answer.Task.WaitAsync(TimeSpan.FromSeconds(5));}
    private sealed class Binding{
        internal readonly object Stage,Figure;internal readonly nint Handle;
        private readonly object scene,sync;private readonly FieldInfo camera,framing;private readonly MethodInfo apply;
        private double baseline,current,target,previous;private bool initialized;internal volatile bool Animating;
        internal Binding(object stage,object figure,nint handle){Stage=stage;Figure=figure;Handle=handle;scene=Field(stage,"Scene");sync=Field(stage,"sync")??stage;camera=scene?.GetType().GetField("camera",Fields);framing=scene?.GetType().GetField("framing",Fields);apply=stage.GetType().GetMethod("ApplyCamera",Fields);}
        internal void Wheel(int delta){
            if(scene==null||camera==null||framing==null||apply==null)throw new InvalidOperationException("The 3D engine zoom adapter is unavailable.");
            lock(sync){if(!initialized){baseline=current=target=Convert.ToDouble(Property(scene,"CameraDistance"));if(!double.IsFinite(baseline)||baseline<=0)throw new InvalidOperationException("The model camera is not ready.");initialized=true;}
                object settings=camera.GetValue(scene);settings.GetType().GetField("Fits").SetValue(settings,false);camera.SetValue(scene,settings);framing.SetValue(scene,null);
                target=CodyZoomMath.Target(target,baseline,delta);previous=clock.Elapsed.TotalSeconds;Animating=true;
            }
        }
        internal void Tick(){if(!Animating)return;lock(sync){double now=clock.Elapsed.TotalSeconds;current=CodyZoomMath.Ease(current,target,now-previous);previous=now;
            apply.Invoke(Stage,new object[]{JsonSerializer.SerializeToElement(new{distance=(float)current}),null});Animating=current!=target;}}
        internal object Snapshot(){GetWindowRect(Handle,out var bounds);lock(sync){object placement=Property(Stage,"Placement");return new{handle=Handle.ToString(),bounds=new{x=bounds.Left,y=bounds.Top,width=bounds.Right-bounds.Left,height=bounds.Bottom-bounds.Top},translation=new{x=Convert.ToDouble(Field(placement,"M31")),y=Convert.ToDouble(Field(placement,"M32"))},rotating=Field(Stage,"isDragging") is true,initialized,baseline,current,target,cameraDistance=scene==null?0:Convert.ToDouble(Property(scene,"CameraDistance")),animating=Animating};}}
    }
    private delegate nint Hook(int code,nint message,nint data);
    [StructLayout(LayoutKind.Sequential)]private struct Point{public int X,Y;}
    [StructLayout(LayoutKind.Sequential)]private struct Rect{public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)]private struct MouseEvent{public Point Point;public uint MouseData,Flags,Time;public nuint ExtraInfo;}
    [DllImport("user32.dll",SetLastError=true)]private static extern nint SetWindowsHookEx(int kind,Hook callback,nint module,uint thread);
    [DllImport("user32.dll")]private static extern nint CallNextHookEx(nint hook,int code,nint message,nint data);
    [DllImport("user32.dll")]private static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")]private static extern nint GetAncestor(nint window,uint flags);
    [DllImport("user32.dll")]private static extern nint GetWindow(nint window,uint command);
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")]private static extern int GetWindowLong(nint window,int index);
    [DllImport("user32.dll")]private static extern bool GetWindowRect(nint window,out Rect rect);
    [DllImport("user32.dll")]private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")]private static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]private static extern nint GetModuleHandle(string name);
}
