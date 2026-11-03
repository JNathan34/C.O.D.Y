using System;
using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using HeyClicky.Drawing;

namespace HeyClicky.App.Cody;

// Use the drawing engine's own mark transforms, so placement survives rotation,
// zoom and subsequent edits, including figures with no card behind them.
internal static class CodyModelDrag
{
    private const BindingFlags Members=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
    private static ScreenDrawingCanvas canvas;
    private static Action<Action> post;
    private static Drag active;
    private static string error;
    private static int moves;
    private static object Field(object value,string name)=>value?.GetType().GetField(name,Members)?.GetValue(value);
    private static object Property(object value,string name)=>value?.GetType().GetProperty(name,Members)?.GetValue(value);
    private static object Invoke(object value,string name,params object[] args)=>value?.GetType().GetMethod(name,Members)?.Invoke(value,args);
    internal static bool Active=>Volatile.Read(ref active)!=null;
    internal static void Start(ScreenDrawingCanvas value,Action<Action> enqueue)
    {
        canvas=value;post=enqueue;
        post(()=>{
            object engine=Field(canvas,"engine");
            Invoke(engine,"Evaluate",@"(()=>{if(globalThis.__codyDragInstalled)return 'ready';const live=ClickyDraw.live;ClickyDraw.live=function(...args){const session=live.apply(this,args);globalThis.__codyDragSession={session,w:args[0].w,h:args[0].h};return session;};globalThis.__codyDragInstalled=true;return 'ready';})()");
        });
    }
    internal static bool Mouse(int message,int x,int y,bool control,Func<int,int,(object Figure,nint Handle)> pick)
    {
        if(message==0x201){
            if(Active)return true;
            if(!control)return false;
            var target=pick(x,y);if(target.Figure==null)return false;
            var drag=new Drag{Figure=target.Figure,Handle=target.Handle,StartX=x,StartY=y,X=x,Y=y};
            Volatile.Write(ref active,drag);post(()=>Begin(drag));return true;
        }
        var current=Volatile.Read(ref active);if(current==null)return false;
        if(message==0x200){Volatile.Write(ref current.X,x);Volatile.Write(ref current.Y,y);return true;}
        if(message==0x202){Volatile.Write(ref current.X,x);Volatile.Write(ref current.Y,y);Volatile.Write(ref active,null);post(()=>Apply(current));return true;}
        return false;
    }
    internal static void Tick(){var drag=Volatile.Read(ref active);if(drag!=null)Apply(drag);}
    private static void Begin(Drag drag)
    {
        try{
            drag.Generation=(int)(Field(canvas,"clearGeneration")??-1);
            object engine=Field(canvas,"engine"),painter=Field(canvas,"painter"),overlay=Field(canvas,"overlay");
            string stage=(string)Property(Field(drag.Figure,"Stage"),"Identifier");
            string raw=(string)Invoke(engine,"Evaluate","(()=>{const live=globalThis.__codyDragSession;if(!live)return '-1';const marks=ClickyDraw.runCode(live.session.code,live.w,live.h);return String(marks.findIndex(mark=>mark&&mark.do==='stage3d'&&mark.id==="+JsonSerializer.Serialize(stage)+"));})()");
            if(!int.TryParse(raw,out int mark)||mark<0)throw new InvalidOperationException("The model's drawing mark could not be found.");
            drag.Marks=new[]{mark};
            if(Invoke(engine,"DraggableCards") is IEnumerable cards)foreach(object card in cards)
                if(Property(card,"Marks") is int[] marks&&Property(card,"Units") is int[] units&&CodyModelViewport.Belongs(Field(drag.Figure,"Node"),units)){drag.Marks=marks;break;}
            object bounds=Property(overlay,"BoundsPx"),size=Property(painter,"CanvasSize"),handle=Field(drag.Figure,"Handle"),frame=Property(handle,"BoundsPx");
            drag.Scale=Convert.ToDouble(Field(bounds,"Width"))/Convert.ToDouble(Field(size,"X"));
            drag.Left=Convert.ToDouble(Field(bounds,"X"));drag.Top=Convert.ToDouble(Field(bounds,"Y"));drag.Right=drag.Left+Convert.ToDouble(Field(bounds,"Width"));drag.Bottom=drag.Top+Convert.ToDouble(Field(bounds,"Height"));
            drag.ModelLeft=Convert.ToDouble(Field(frame,"X"));drag.ModelTop=Convert.ToDouble(Field(frame,"Y"));drag.ModelRight=drag.ModelLeft+Convert.ToDouble(Field(frame,"Width"));drag.ModelBottom=drag.ModelTop+Convert.ToDouble(Field(frame,"Height"));
            if(!double.IsFinite(drag.Scale)||drag.Scale<=0)throw new InvalidOperationException("The model's display scale is unavailable.");
            drag.Ready=true;
        }catch(Exception ex){error=ex.GetBaseException().Message;}
    }
    private static void Apply(Drag drag)
    {
        if(!drag.Ready||!canvas.IsShowing||drag.Generation!=(int)(Field(canvas,"clearGeneration")??-1))return;
        try{
            double keep=40*drag.Scale;
            double x=Math.Clamp((double)Volatile.Read(ref drag.X)-drag.StartX,drag.Left+keep-drag.ModelRight,drag.Right-keep-drag.ModelLeft);
            double y=Math.Clamp((double)Volatile.Read(ref drag.Y)-drag.StartY,drag.Top+keep-drag.ModelBottom,drag.Bottom-keep-drag.ModelTop);
            double dx=(x-drag.AppliedX)/drag.Scale,dy=(y-drag.AppliedY)/drag.Scale;if(Math.Abs(dx)+Math.Abs(dy)<0.01)return;
            int moved=Convert.ToInt32(Invoke(Field(canvas,"engine"),"MoveCard",drag.Marks,dx,dy));
            if(moved>0){drag.AppliedX=x;drag.AppliedY=y;Invoke(Field(canvas,"cardHandles"),"Refresh");CodyModelViewport.Apply(canvas,drag.Figure);Interlocked.Increment(ref moves);}
        }catch(Exception ex){error=ex.GetBaseException().Message;drag.Ready=false;}
    }
    internal static Task<object> Snapshot(){var answer=new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);post(()=>answer.TrySetResult(new{active=Active,moves,error}));return answer.Task.WaitAsync(TimeSpan.FromSeconds(5));}
    private sealed class Drag
    {
        internal object Figure;internal nint Handle;internal int StartX,StartY,X,Y,Generation;internal int[] Marks;
        internal double Scale,Left,Top,Right,Bottom,ModelLeft,ModelTop,ModelRight,ModelBottom,AppliedX,AppliedY;internal bool Ready;
    }
}
