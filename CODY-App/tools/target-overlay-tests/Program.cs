using System.Text.Json;
using HeyClicky;
using HeyClicky.App.Cody;
CodyCursorVisuals.Target(new ClickTargetRing(new(530,144),56,new(496,122,68,45),"Click Add"));
CodyCursorVisuals.Tick(VoiceState.Idle,0);
var state=JsonSerializer.SerializeToElement(CodyEngineBridge.Last);
if(state.GetProperty("visible").GetBoolean()||state.GetProperty("target").GetProperty("frame").GetProperty("width").GetDouble()!=68)throw new Exception("Idle guide payload missing");
CodyCursorVisuals.Target(null);CodyCursorVisuals.Tick(VoiceState.Idle,0);
if(JsonSerializer.SerializeToElement(CodyEngineBridge.Last).GetProperty("target").ValueKind!=JsonValueKind.Null)throw new Exception("Stale guide payload");
int sent=CodyEngineBridge.Sent;CodyCursorVisuals.Tick(VoiceState.Idle,0);
if(CodyEngineBridge.Sent!=sent)throw new Exception("Idle should stop publishing");
Console.WriteLine("PASS: native target payload, idle visibility, clear event, idle silence");
namespace HeyClicky{
 public record PointD(double X,double Y);
 public readonly record struct RectD(double X,double Y,double Width,double Height);
 public record ClickTargetRing(PointD CenterPx,double RadiusPx,RectD? ControlFramePx,string Label);
 public enum VoiceState{Idle,Listening,Responding}
}
namespace HeyClicky.Platform.Input{public static class ClickyScreenActuator{public static PointD CurrentPointer=>new(0,0);}}
namespace HeyClicky.App.Cody{internal static class CodyEngineBridge{internal static object Last;internal static int Sent;internal static void PublishCursor(object data){Last=data;Sent++;}}}
