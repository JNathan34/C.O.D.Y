using HeyClicky.App.Cody;
foreach(string command in new[]{"stop","cancel","abort","Cody, stop","please cancel","stop computer control","stop what you're doing","cancel the current task"})if(!CodyControlCommands.IsStop(command))throw new Exception("Stop command not recognized: "+command);
foreach(string command in new[]{"stop Spotify","cancel my timer","don't stop","why did you stop","stop at the next page"})if(CodyControlCommands.IsStop(command))throw new Exception("Unrelated request cancelled control: "+command);
if(!CodyMouseGuard.ShouldBlock(0)||!CodyMouseGuard.ShouldBlock(123)||CodyMouseGuard.ShouldBlock(1212369995))throw new Exception("Mouse protection policy failed");
if (!CodyMouseGuard.ShouldBlockKey(0x41, 0, 0) ||
    !CodyMouseGuard.ShouldBlockKey(0x41, 0x80, 0) ||
    !CodyMouseGuard.ShouldBlockKey(0x1B, 0x10, 0) ||
    CodyMouseGuard.ShouldBlockKey(0x1B, 0, 0) ||
    CodyMouseGuard.ShouldBlockKey(0x1B, 0x80, 0) ||
    CodyMouseGuard.ShouldBlockKey(0x41, 0x10, 1212369995))
    throw new Exception("Keyboard protection policy failed");
Console.WriteLine("PASS: keyboard and mouse input filtering, physical Esc, and stop command matching");
namespace HeyClicky{public record PointD(double X,double Y);}
namespace HeyClicky.Platform.Input{public static class ClickyInputProvenance{public static nuint Tag=>1212369995;}public static class ClickyScreenActuator{public static void MoveTo(HeyClicky.PointD point){}}}
namespace HeyClicky.App.Cody{internal static class CodySystemCursor{internal static void Start(){}internal static void Restore(){}}}
