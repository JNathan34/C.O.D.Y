using System;
using System.Collections;
using System.Linq;
using System.Numerics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using Windows.Graphics;
using Windows.UI.Composition;

namespace HeyClicky.App.Cody;

// The bundled engine reports card extents separately from the rendered chrome.
// Use the chrome's own coordinates for both clipping and caption hit targets.
internal static class CodyModelViewport
{
    private const BindingFlags Members=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
    private sealed class Owner { internal object Chrome; }
    private static readonly ConditionalWeakTable<object,Owner> owners=new();
    private static object Get(object value,string name)=>value?.GetType().GetField(name,Members)?.GetValue(value)??value?.GetType().GetProperty(name,Members)?.GetValue(value);
    private static object Call(object value,string name,params object[] args)=>value.GetType().GetMethod(name,Members).Invoke(value,args);
    internal static bool Belongs(object node,int[] units)
    {
        for(object current=node;current!=null;current=Get(current,"Parent"))
            if(Get(current,"Unit") is int unit&&units.Contains(unit))return true;
        return false;
    }
    private static object FindChrome(object node)
    {
        if(node==null)return null;
        if(Get(node,"Window")!=null)return node;
        if(Get(node,"Children") is IEnumerable children)foreach(object child in children){var found=FindChrome(child);if(found!=null)return found;}
        return null;
    }
    internal static void Refresh(object canvas)
    {
        var figures=Get(Get(canvas,"painter"),"Figures");
        if(Get(figures,"stages") is not IDictionary stages)return;
        foreach(object figure in stages.Values.Cast<object>().ToArray())if(Get(figure,"Handle")!=null)Apply(canvas,figure);
    }
    internal static object Inspect(object canvas,object figure)
    {
        var visual=(Visual)Get(Get(figure,"Node"),"Visual");
        var clip=(visual.Clip as CompositionGeometricClip)?.Geometry as CompositionRectangleGeometry;
        object close=null;
        var overlay=Get(canvas,"overlay");var origin=(RectInt32)Get(overlay,"BoundsPx");
        double pixels=origin.Width/((Vector2)Get(Get(canvas,"painter"),"CanvasSize")).X;
        foreach(object caption in (IEnumerable)Get(Get(canvas,"cardHandles"),"handles")){
            object card=Get(caption,"Card");
            if(card==null||!Belongs(Get(figure,"Node"),(int[])Get(card,"Units")))continue;
            var frame=(RectInt32)Get(caption,"Frame");double scale=Convert.ToDouble(Get(overlay,"RasterizationScale"));
            foreach(object button in (IEnumerable)Get(Get(caption,"layout"),"Buttons"))if((int)Get(button,"Item1")==0){
                object rect=Get(button,"Item2");
                double N(string name)=>Convert.ToDouble(Get(rect,name));
                close=new {x=(frame.X+N("X")*scale-origin.X)/pixels,y=(frame.Y+N("Y")*scale-origin.Y)/pixels,width=N("Width")*scale/pixels,height=N("Height")*scale/pixels};
            }
        }
        return new {clipped=clip!=null,clip=clip==null?null:new {x=clip.Offset.X,y=clip.Offset.Y,width=clip.Size.X,height=clip.Size.Y},close};
    }
    private static Matrix3x2 Placement(object node)
    {
        var result=Matrix3x2.Identity;
        for(object parent=Get(node,"Parent");parent!=null;parent=Get(parent,"Parent"))
            if(Get(parent,"Kind")?.ToString()=="Wrapper"){
                var scale=(Vector3)Get(parent,"WrapperScale");var offset=(Vector3)Get(parent,"WrapperOffset");
                result*=Matrix3x2.CreateScale(scale.X)*Matrix3x2.CreateTranslation(offset.X,offset.Y);
            }
        return result;
    }
    internal static RectD? Apply(object canvas,object figure)
    {
        object painter=Get(canvas,"painter"),node=Get(figure,"Node"),stage=Get(figure,"Stage");
        object engine=Get(canvas,"engine");
        var card=((IEnumerable)Call(engine,"DraggableCards")).Cast<object>().FirstOrDefault(c=>Get(c,"Window")!=null&&Belongs(node,(int[])Get(c,"Units")));
        var visual=(Visual)Get(node,"Visual");
        var nodes=(IDictionary)Get(painter,"unitNodes");
        if(card==null){
            if(owners.TryGetValue(figure,out _)){
                // Closing chrome must also remove a model nested beneath its wrapper.
                Call(painter,"RemoveUnit",(int)Get(node,"Unit"));
                return null;
            }
            visual.Clip=null;SetWindowRgn((nint)Get(Get(figure,"Handle"),"Handle"),0,true);return null;
        }
        object chrome=null;
        foreach(int member in (int[])Get(card,"Units"))if(nodes.Contains(member)&&(chrome=FindChrome(nodes[member]))!=null)break;
        if(chrome==null)return null;
        owners.GetOrCreateValue(figure).Chrome=chrome;
        object info=Get(chrome,"Window");
        double N(string name)=>Convert.ToDouble(Get(info,name));
        var transform=Placement(chrome);
        var top=Vector2.Transform(new Vector2((float)N("X"),(float)N("Y")),transform);
        var bottom=Vector2.Transform(new Vector2((float)(N("X")+N("Width")),(float)(N("Y")+N("Height"))),transform);
        var box=new RectD(top.X,top.Y,bottom.X-top.X,bottom.Y-top.Y);
        double header=Math.Clamp(N("TitleBarHeight")*transform.M22,0,box.Height);
        var content=new RectD(box.X+1,box.Y+header,Math.Max(0,box.Width-2),Math.Max(0,box.Height-header-1));
        if(!Matrix3x2.Invert((Matrix3x2)Get(stage,"Placement"),out var inverse))return null;
        var localTop=Vector2.Transform(new Vector2((float)content.X,(float)content.Y),inverse);
        var localBottom=Vector2.Transform(new Vector2((float)content.Right,(float)content.Bottom),inverse);
        var geometry=visual.Compositor.CreateRectangleGeometry();geometry.Offset=localTop;geometry.Size=Vector2.Max(Vector2.Zero,localBottom-localTop);
        visual.Clip=visual.Compositor.CreateGeometricClip(geometry);

        // Native input windows must obey the same boundary as the composition layer.
        object overlay=Get(canvas,"overlay");var bounds=(RectInt32)Get(overlay,"BoundsPx");
        double pixels=bounds.Width/((Vector2)Get(painter,"CanvasSize")).X;
        object handle=Get(figure,"Handle");var frame=(RectInt32)Get(handle,"BoundsPx");
        int left=Math.Max(0,(int)Math.Ceiling(bounds.X+content.X*pixels-frame.X));
        int up=Math.Max(0,(int)Math.Ceiling(bounds.Y+content.Y*pixels-frame.Y));
        int right=Math.Min(frame.Width,(int)Math.Floor(bounds.X+content.Right*pixels-frame.X));
        int down=Math.Min(frame.Height,(int)Math.Floor(bounds.Y+content.Bottom*pixels-frame.Y));
        nint region=CreateRectRgn(left,up,Math.Max(left,right),Math.Max(up,down));
        if(SetWindowRgn((nint)Get(handle,"Handle"),region,true)==0)DeleteObject(region);

        // Rebuild the drawing and hit-test layout together in the handle's frame.
        object owner=Get(canvas,"cardHandles");
        foreach(object caption in (IEnumerable)Get(owner,"handles")){
            object shown=Get(caption,"Card");
            if(shown==null||!Belongs(node,(int[])Get(shown,"Units")))continue;
            object corrected=Call(shown,"<Clone>$"),window=Call(Get(shown,"Window"),"<Clone>$");
            window.GetType().GetProperty("Box").SetValue(window,box);
            window.GetType().GetProperty("TitleBarHeight").SetValue(window,header);
            corrected.GetType().GetProperty("Window").SetValue(corrected,window);
            var captionFrame=(RectInt32)Get(caption,"Frame");double scale=Convert.ToDouble(Get(overlay,"RasterizationScale"));
            var cardRect=new RectInt32((int)(bounds.X+box.X*pixels),(int)(bounds.Y+box.Y*pixels),(int)(box.Width*pixels),(int)(box.Height*pixels));
            object layout=Call(owner,"BuildLayout",corrected,cardRect,captionFrame,scale);
            Call(caption,"Place",corrected,captionFrame,layout,scale);
        }
        return content;
    }
    [DllImport("gdi32.dll")]private static extern nint CreateRectRgn(int left,int top,int right,int bottom);
    [DllImport("gdi32.dll")]private static extern bool DeleteObject(nint value);
    [DllImport("user32.dll")]private static extern int SetWindowRgn(nint window,nint region,bool redraw);
}
