using System;
namespace HeyClicky.App.Cody;
internal static class CodyZoomMath
{
    public static double Target(double current,double baseline,int wheelDelta)=>Math.Clamp(current*Math.Pow(.9,Math.Clamp(wheelDelta,-1200,1200)/120d),baseline*.45,baseline*4);
    public static double Ease(double current,double target,double seconds){double next=current+(target-current)*(1-Math.Exp(-Math.Clamp(seconds,0,.064)/.09));return Math.Abs(next-target)<.0001?target:next;}
}
