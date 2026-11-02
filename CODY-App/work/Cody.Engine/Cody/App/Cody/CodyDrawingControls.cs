using System;
using System.Collections;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Drawing;
using HeyClicky.Platform.Win32;

namespace HeyClicky.App.Cody;

// The bundled drawing canvas hides its card handles until narration ends.
// Refresh those same controls on its drawing thread while a program is streaming.
internal static class CodyDrawingControls
{
    private const BindingFlags Members=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
    private static int queued;
    private static int offeredGeneration=-1;
    private static string error;
    private static object Field(object value,string name)=>value?.GetType().GetField(name,Members)?.GetValue(value);
    private static object Property(object value,string name)=>value?.GetType().GetProperty(name,Members)?.GetValue(value);
    private static void Invoke(object value,string name,params object[] args)=>value?.GetType().GetMethod(name,Members)?.Invoke(value,args);
    private static int ModelCount(ScreenDrawingCanvas canvas)
    {
        object painter=Field(canvas,"painter"),figures=Property(painter,"Figures")??Field(painter,"Figures");
        return Field(figures,"stages") is IDictionary stages?stages.Count:0;
    }
    internal static IDisposable WatchScreen(ScreenDrawingCanvas canvas,DisplayInfo display,Action<string> changed)
    {
        int generation=(int)(Field(canvas,"clearGeneration")??-1);
        return new ScreenDrawingStaleWatch(display,reason=>Invoke(canvas,"PostToDrawingThread",(Action)(()=>{
            if(generation!=(int)(Field(canvas,"clearGeneration")??-1))return;
            if(canvas.IsShowing&&!canvas.IsDrawingFadedAway&&ModelCount(canvas)>0)
            {
                // Re-arm the one-shot watcher without dismissing the model. X and Clear
                // still use the canvas's original explicit removal paths.
                Invoke(canvas,"StartStaleWatch",display);
                return;
            }
            changed(reason);
        })));
    }
    internal static void ScreenChangeForTest(AppHost host,string reason)=>Invoke(Field(host.Real.Canvas,"staleWatch"),"Fire",reason);
    internal static void Tick(AppHost host)
    {
        var canvas=host.Real.Canvas;
        if(!canvas.IsStreamingNarration||!canvas.IsShowing||canvas.IsDrawingFadedAway){offeredGeneration=-1;return;}
        int generation=(int)(Field(canvas,"clearGeneration")??-1);
        host.Lessons?.ShowGeneratingControls(generation!=offeredGeneration);offeredGeneration=generation;
        if(Interlocked.Exchange(ref queued,1)!=0)return;
        try{Invoke(canvas,"PostToDrawingThread",(Action)(()=>{
            try{
                if(!canvas.IsStreamingNarration||!canvas.IsShowing||canvas.IsDrawingFadedAway)return;
                object controls=Field(canvas,"cardHandles");Invoke(controls,"Refresh");
                if(Field(controls,"handles") is IEnumerable handles)foreach(object handle in handles)Invoke(handle,"SetRevealed",true,false);
            }catch(Exception ex){error=ex.GetBaseException().Message;}
            finally{Volatile.Write(ref queued,0);}
        }));}catch(Exception ex){Volatile.Write(ref queued,0);error=ex.GetBaseException().Message;}
    }
    internal static void CloseForTest(AppHost host)=>Invoke(host.Real.Canvas,"SimulateCard",-1,"close",0f,0f);
    internal static Task<object> Snapshot(AppHost host)
    {
        var result=new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        var canvas=host.Real.Canvas;
        Invoke(canvas,"PostToDrawingThread",(Action)(()=>{
            try{
                int shown=0,revealed=0,closeButtons=0;object controls=Field(canvas,"cardHandles");
                if(Field(controls,"handles") is IEnumerable handles)foreach(object handle in handles){if(Property(handle,"IsShown") is true)shown++;if(Field(handle,"revealed") is true){revealed++;if(Field(Field(handle,"layout"),"Buttons") is IEnumerable buttons)foreach(object button in buttons)if(Field(button,"Item1") is int kind&&kind==0)closeButtons++;}}
                result.TrySetResult(new{streaming=canvas.IsStreamingNarration,showing=canvas.IsShowing,models=ModelCount(canvas),clearVisible=host.Lessons?.GeneratingControlsShown??false,shown,revealed,closeButtons,error});
            }catch(Exception ex){result.TrySetException(ex.GetBaseException());}
        }));return result.Task;
    }
}
