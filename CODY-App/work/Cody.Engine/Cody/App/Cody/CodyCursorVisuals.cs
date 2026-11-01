using System;
using HeyClicky.Platform.Input;
namespace HeyClicky.App.Cody;
internal static class CodyCursorVisuals
{
    private static bool requested,wasVisible;
    private static volatile ClickTargetRing target;
    internal static void Target(ClickTargetRing ring){target=ring;}
    private static double? anchorX,anchorY;
    private static DateTime hideAfter;
    private static string message;
    private static DateTime messageUntil;
    internal static void Message(string text,double seconds=8){message=text?.Length>2000?text.Substring(0,2000):text;messageUntil=DateTime.UtcNow.AddSeconds(Math.Clamp(seconds,1,30));}
    internal static void HideMessage(){message=null;}
    internal static void Show(){requested=true;}
    internal static void Hide(){requested=false;anchorX=anchorY=null;}
    internal static void Point(double x,double y){anchorX=x;anchorY=y;requested=true;}
    internal static void Return(){anchorX=anchorY=null;requested=false;}
    internal static void Tick(VoiceState phase,float level){
        if(phase!=VoiceState.Idle)hideAfter=DateTime.UtcNow.AddMilliseconds(450);
        if(DateTime.UtcNow>=messageUntil)message=null;
        bool visible=requested||phase!=VoiceState.Idle||DateTime.UtcNow<hideAfter||message!=null;
        if(!visible&&!wasVisible&&target==null)return;wasVisible=visible||target!=null;
        var ring=target;
        var point=ClickyScreenActuator.CurrentPointer;
        CodyEngineBridge.PublishCursor(new{visible,phase=phase.ToString(),level,message,target=ring==null?null:new{ x=ring.CenterPx.X,y=ring.CenterPx.Y,radius=ring.RadiusPx,frame=ring.ControlFramePx is RectD box?new{x=box.X,y=box.Y,width=box.Width,height=box.Height}:null,label=ring.Label },x=anchorX??point.X,y=anchorY??point.Y});
    }
}
