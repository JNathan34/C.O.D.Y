using ClickyScreenActuator = HeyClicky.App.Cody.CodyIndependentInput;
using System;
using HeyClicky.App.Drive;
using HeyClicky.Platform.Input;
using Microsoft.UI.Dispatching;

namespace HeyClicky.App.Cody;

// Reports presentation state only; input and take-back remain owned by the native drive.
internal static class CodyDriveVisuals
{
    private static DispatcherQueueTimer timer;
    private static bool active,acting;
    private static string status="";
    private static double x,y;
    internal static bool Active=>active;
    internal static object Snapshot()=>new {active,acting,status,x,y,systemInput=CodyIndependentInput.UsingSystemInput};
    internal static void Start(DispatcherQueue dispatcher)
    {
        timer=dispatcher.CreateTimer();timer.Interval=TimeSpan.FromMilliseconds(33);
        timer.Tick+=(_,_)=>{
            if(!active||!acting)return;
            var point=ClickyScreenActuator.CurrentPointer;
            if(point.X==x&&point.Y==y)return;x=point.X;y=point.Y;Publish();
        };
    }
    internal static void Show(string text)
    {
        CodyIndependentInput.Begin();
        var point=ClickyScreenActuator.CurrentPointer;x=point.X;y=point.Y;
        active=true;status=text;timer?.Start();Publish();
    }
    internal static void Status(string text){status=text;if(active)Publish();}
    internal static void Acting(bool value){acting=value;if(active){var point=ClickyScreenActuator.CurrentPointer;x=point.X;y=point.Y;Publish();}}
    internal static void Hide(){active=false;acting=false;timer?.Stop();CodyIndependentInput.End();Publish();}
    private static void Publish()=>CodyEngineBridge.PublishDrive(Snapshot());
}
