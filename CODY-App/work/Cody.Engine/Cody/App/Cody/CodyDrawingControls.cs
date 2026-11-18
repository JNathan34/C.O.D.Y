using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Drawing;
using HeyClicky.Platform.Capture;
using HeyClicky.Platform.Win32;
using Windows.UI.Composition;

namespace HeyClicky.App.Cody;

// The bundled drawing canvas hides its card handles until narration ends.
// Refresh those same controls on its drawing thread while a program is streaming.
internal static class CodyDrawingControls
{
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
    private const BindingFlags Members=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
    private sealed class RefreshState { internal int Queued; }
    private static readonly ConditionalWeakTable<ScreenDrawingCanvas,RefreshState> refreshStates=new();
    private static int offeredGeneration=-1;
    private static ScreenDrawingCanvas offeredCanvas;
    private static string error;
    private static object Field(object value,string name)=>value?.GetType().GetField(name,Members)?.GetValue(value);
    private static object Property(object value,string name)=>value?.GetType().GetProperty(name,Members)?.GetValue(value);
    private static void Invoke(object value,string name,params object[] args)=>value?.GetType().GetMethod(name,Members)?.Invoke(value,args);
    private static int ModelCount(ScreenDrawingCanvas canvas)
    {
        return ReadOnDrawingThread(canvas,()=>{
            object painter=Field(canvas,"painter"),figures=Property(painter,"Figures")??Field(painter,"Figures");
            if(Field(figures,"stages") is not IDictionary stages)return 0;
            int count=0;
            foreach(DictionaryEntry entry in stages){
                object figure=entry.Value,handle=Field(figure,"Handle");
                if(handle!=null?Property(handle,"IsShown") is true&&Property(handle,"Handle") is nint hwnd&&IsWindowVisible(hwnd):Field(figure,"Surface")!=null&&Property(Field(figure,"Visual"),"IsVisible") is true)count++;
            }
            return count;
        });
    }
    private static int ReadOnDrawingThread(ScreenDrawingCanvas canvas,Func<int> read)
    {
        var method=canvas.GetType().GetMethods(Members).SingleOrDefault(candidate=>candidate.Name=="OnDrawingThread"&&candidate.IsGenericMethodDefinition);
        return (int)(method?.MakeGenericMethod(typeof(int)).Invoke(canvas,new object[]{read,0})??0);
    }
    internal static bool HasVisibleDrawing(ScreenDrawingCanvas canvas)
    {
        if(!HasDrawingContent(canvas))return false;
        // Hidden/minimised or background app windows must not retain the top Clear HUD.
        if(Field(canvas,"staleWatch") is DrawingScreenWatch watch&&watch.IsBoundToBackgroundWindow)return false;
        return true;
    }
    private static bool HasDrawingContent(ScreenDrawingCanvas canvas)
    {
        if(!canvas.IsShowing||canvas.IsDrawingFadedAway)return false;
        // Empty containers and closed 3D placeholders can remain allocated. Only
        // visible drawing nodes (or a live model) should keep the Clear button up.
        int renderedUnits=VisibleUnitCount(canvas);
        // Ordinary computer-control tasks can construct visual nodes for previews,
        // targets or app windows. They are not user-clearable ink. Require a
        // confirmed ink mark (or a live 3D drawing) before offering Clear.
        return CodyDrawingControlState.HasContent(canvas.IsShowing,canvas.IsDrawingFadedAway,
            renderedUnits,ModelCount(canvas),canvas.InkedMarkCount);
    }
    private static int VisibleUnitCount(ScreenDrawingCanvas canvas)
    {
        int Count(){
            var seen=new HashSet<object>(ReferenceEqualityComparer.Instance);
            int Visit(object node){
                if(node==null||!seen.Add(node))return 0;
                for(object ancestor=node;ancestor!=null;ancestor=Field(ancestor,"Parent"))
                    if(Property(Field(ancestor,"Visual"),"IsVisible") is not true)return 0;
                string kind=Field(node,"Kind")?.ToString();
                if(kind is "Stage3D" or "Placeholder")return 0;
                int count=CodyDrawingControlState.IsDrawable(kind)?1:0;
                if(Field(node,"Children") is IEnumerable children)foreach(object child in children)count+=Visit(child);
                return count;
            }
            if(Field(Field(canvas,"painter"),"unitNodes") is not IDictionary units)return 0;
            int count=0;foreach(DictionaryEntry unit in units)count+=Visit(unit.Value);return count;
        }
        return ReadOnDrawingThread(canvas,Count);
    }
    private static (double X,double Y,double Width,double Height)? HighlightBounds(ScreenDrawingCanvas canvas)
    {
        if(Field(Field(canvas,"painter"),"unitNodes") is not IDictionary units)return null;
        foreach(object node in units.Values)
        {
            if(Field(node,"Kind")?.ToString() is not ("Shape" or "Text" or "Dot" or "Wash")||
                Property(Field(node,"Visual"),"IsVisible") is not true)continue;
            if(Field(node,"Extent") is not ValueTuple<double,double,double,double> extent)continue;
            var (x,y,width,height)=extent;
            if(Math.Max(width,height)<4)continue;
            double sampleWidth=Math.Max(32,width),sampleHeight=Math.Max(32,height);
            return (x-(sampleWidth-width)/2,y-(sampleHeight-height)/2,sampleWidth,sampleHeight);
        }
        return null;
    }
    private sealed class DrawingScreenWatch : IDisposable
    {
        private readonly ScreenDrawingCanvas canvas;
        private readonly DisplayInfo display;
        private readonly Action<string> changed;
        private readonly CodyDrawingFollow follow;
        private ScreenDrawingStaleWatch stale;
        private bool disposed;

        internal DrawingScreenWatch(ScreenDrawingCanvas canvas,DisplayInfo display,ScreenCaptureService capture,Action<string> changed)
        {
            this.canvas=canvas;
            this.display=display;
            this.changed=changed;
            if(Property(Field(canvas,"painter"),"StageVisual") is Visual stage)stage.IsVisible=true;
            follow=new CodyDrawingFollow(capture,display,Field(canvas,"screenshotJpeg") as byte[],
                (Vector2)(Field(canvas,"canvasSize")??Vector2.Zero),Post);
            Arm();
        }
        private void Post(Action action)=>Invoke(canvas,"PostToDrawingThread",action);
        internal bool Hidden=>follow.Hidden;
        internal bool IsBoundToBackgroundWindow=>follow.Available&&!follow.OwnerForeground;
        internal bool CanContinue(ScreenCaptureFrame frame)=>follow.CanContinue(frame);
        internal object Inspect()=>follow.Inspect();
        private void Arm()=>stale=new ScreenDrawingStaleWatch(display,Fire);
        internal void Fire(string reason)=>Post(()=>{
            if(disposed||!canvas.IsShowing||canvas.IsDrawingFadedAway)return;
            stale.Dispose();
            if(ModelCount(canvas)>0)
            {
                Arm();
                return;
            }
            if(CodyEngineBridge.EngineMode || follow.Available&&!canvas.DrawsPicture)
            {
                follow.ScreenChanged(reason);
                if((!follow.Available||follow.OwnerForeground)&&!canvas.IsStreamingNarration&&(reason is "click" or "scroll")&&
                    Field(canvas,"UserActedOnScreen") is EventHandler<string> userActed)
                    Invoke(canvas,"Raise",(Action)(()=>userActed(canvas,reason)));
                Arm();
                return;
            }
            changed(reason);
        });
        internal bool Refresh()
        {
            if(canvas.DrawsPicture||ModelCount(canvas)>0||HighlightBounds(canvas) is not {} bounds)
            {
                follow.ResetPlacement();
                return false;
            }
            follow.Tick(Property(Field(canvas,"painter"),"StageVisual") as Visual,bounds,
                (Vector2)(Field(canvas,"canvasSize")??Vector2.Zero));
            return follow.Hidden||follow.Moved;
        }
        public void Dispose()
        {
            disposed=true;
            stale?.Dispose();
            follow.Dispose();
        }
    }
    internal static IDisposable WatchScreen(ScreenDrawingCanvas canvas,DisplayInfo display,ScreenCaptureService capture,Action<string> changed)
        =>new DrawingScreenWatch(canvas,display,capture,changed);
    internal static bool CanContinue(ScreenDrawingCanvas canvas,ScreenCaptureFrame frame)
        =>Field(canvas,"staleWatch") is not DrawingScreenWatch watch||watch.CanContinue(frame);
    internal static void ScreenChangeForTest(AppHost host,string reason)=>Invoke(Field(host.Real.Canvas,"staleWatch"),"Fire",reason);
    internal static void Tick(AppHost host)
    {
        var drawings=host.Real.DrawingCanvases.Where(HasDrawingContent).ToArray();
        // Even hidden drawings need to be refreshed so they can reappear when
        // their original window is restored, without re-drawing from scratch.
        foreach(var canvas in drawings)Refresh(canvas);
        var latest=drawings.LastOrDefault(HasVisibleDrawing);
        if(latest==null)
        {
            offeredCanvas=null;
            offeredGeneration=-1;
            host.Lessons?.HideDrawingControls();
            return;
        }
        int generation=(int)(Field(latest,"clearGeneration")??-1);
        host.Lessons?.ShowGeneratingControls(latest!=offeredCanvas||generation!=offeredGeneration,latest);
        offeredCanvas=latest;
        offeredGeneration=generation;
    }
    private static void Refresh(ScreenDrawingCanvas canvas)
    {
        var state=refreshStates.GetValue(canvas,_=>new RefreshState());
        if(Interlocked.Exchange(ref state.Queued,1)!=0)return;
        try{Invoke(canvas,"PostToDrawingThread",(Action)(()=>{
            try{
                if(!HasDrawingContent(canvas))return;
                object controls=Field(canvas,"cardHandles");
                if(Field(canvas,"staleWatch") is DrawingScreenWatch watch&&watch.Refresh())
                {
                    Invoke(controls,"Hide");
                    return;
                }
                if(!HasVisibleDrawing(canvas))return;
                if(!canvas.IsStreamingNarration)return;
                Invoke(controls,"Refresh");
                CodyModelViewport.Refresh(canvas);
                if(Field(controls,"handles") is IEnumerable handles)foreach(object handle in handles)Invoke(handle,"SetRevealed",true,false);
            }catch(Exception ex){error=ex.GetBaseException().Message;}
            finally{Volatile.Write(ref state.Queued,0);}
        }));}catch(Exception ex){Volatile.Write(ref state.Queued,0);error=ex.GetBaseException().Message;}
    }
    internal static void CloseForTest(AppHost host)=>Invoke(host.Real.Canvas,"SimulateCard",-1,"close",0f,0f);
    internal static Task ClearTwoDimensional(ScreenDrawingCanvas canvas)
    {
        var result=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Invoke(canvas,"PostToDrawingThread",(Action)(()=>{
            try
            {
                if(ModelCount(canvas)==0)canvas.Clear(animated:false);
                else ClearMixedCanvas();
                result.TrySetResult();
            }
            catch(Exception ex)
            {
                result.TrySetException(ex.GetBaseException());
            }
        }));
        return result.Task.WaitAsync(TimeSpan.FromSeconds(5));

        void ClearMixedCanvas()
        {
            // A mixed canvas can contain an independent 3D figure and 2D
            // annotation units. Retire the pointing marks in the engine first.
            Invoke(Field(canvas,"engine"),"DropPointing");
            object painter=Field(canvas,"painter");
            if(Field(painter,"unitNodes") is IDictionary units)
            {
                var drawingUnits=new List<int>();
                foreach(DictionaryEntry unit in units)
                    if(!ContainsFigure(unit.Value)&&(CodyDrawingControlState.IsDrawable(Field(unit.Value,"Kind")?.ToString())||
                        Field(unit.Value,"Children") is IEnumerable))drawingUnits.Add((int)unit.Key);
                foreach(int id in drawingUnits)Invoke(painter,"RemoveUnit",id);
            }
            Invoke(Field(canvas,"caption"),"Hide");
            Invoke(Field(canvas,"buttons"),"Clear");
        }

        static bool ContainsFigure(object node)
            => Field(node,"Kind")?.ToString()=="Stage3D" ||
                Field(node,"Children") is IEnumerable children && children.Cast<object>().Any(ContainsFigure);
    }
    internal static Task<object> Snapshot(AppHost host)
    {
        var result=new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        var canvas=host.Real.Canvas;
        var drawingDisplays=host.Real.DrawingCanvases.Where(HasVisibleDrawing)
            .Select(drawing=>drawing.DrawingDisplay).ToArray();
        Invoke(canvas,"PostToDrawingThread",(Action)(()=>{
            try{
                int shown=0,revealed=0,closeButtons=0;object controls=Field(canvas,"cardHandles");
                if(Field(controls,"handles") is IEnumerable handles)foreach(object handle in handles){if(Property(handle,"IsShown") is true)shown++;if(Field(handle,"revealed") is true){revealed++;if(Field(Field(handle,"layout"),"Buttons") is IEnumerable buttons)foreach(object button in buttons)if(Field(button,"Item1") is int kind&&kind==0)closeButtons++;}}
                var stage=Property(Field(canvas,"painter"),"StageVisual") as Visual;
                var watch=Field(canvas,"staleWatch") as DrawingScreenWatch;
                result.TrySetResult(new{streaming=canvas.IsStreamingNarration,showing=canvas.IsShowing,visiblePrograms=drawingDisplays.Length,drawingDisplays,renderedUnits=VisibleUnitCount(canvas),models=ModelCount(canvas),clearVisible=host.Lessons?.GeneratingControlsShown??false,shown,revealed,closeButtons,hidden=watch?.Hidden??false,offsetX=stage?.Offset.X,offsetY=stage?.Offset.Y,follow=watch?.Inspect(),error});
            }catch(Exception ex){result.TrySetException(ex.GetBaseException());}
        }));return result.Task;
    }
}
