param([Parameter(Mandatory=$true)][string]$AppsJson,[ValidateSet('split','pin','status')][string]$Mode='split',[bool]$Topmost=$true)
$ErrorActionPreference='Stop'
[string[]]$layoutApps=ConvertFrom-Json -InputObject $AppsJson
$processNames=@{
  firefox=@('firefox');plezy=@('plezy');chrome=@('chrome');edge=@('msedge');notepad=@('notepad');paint=@('mspaint');calculator=@('CalculatorApp','Calculator','calc');'file explorer'=@('explorer');spotify=@('Spotify');settings=@('SystemSettings')
}
if($Mode -eq 'split' -and ($layoutApps.Count -ne 2 -or $layoutApps[0] -eq $layoutApps[1])){throw 'Split screen requires two different supported apps.'}
if($Mode -ne 'split' -and $layoutApps.Count -ne 1){throw 'Choose one supported app to pin or unpin.'}
foreach($layoutApp in $layoutApps){if(-not $processNames.ContainsKey([string]$layoutApp)){throw 'Unsupported split-screen app.'}}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class CodyAppLayout {
  [StructLayout(LayoutKind.Sequential)]public struct Rect {public int Left,Top,Right,Bottom;public int Width{get{return Right-Left;}}public int Height{get{return Bottom-Top;}}}
  [StructLayout(LayoutKind.Sequential)]public struct Point {public int X,Y;}
  [StructLayout(LayoutKind.Sequential)]private struct MonitorInfo {public int Size;public Rect Bounds,Work;public uint Flags;}
  [StructLayout(LayoutKind.Sequential)]public struct Placement {public int Size,Flags,Show;public Point Min,Max;public Rect Normal;}
  public sealed class Window {public IntPtr Handle;public int Pid;public string Process;public Placement Original;}
  private delegate bool EnumCallback(IntPtr hwnd,IntPtr state);
  [DllImport("user32.dll")]private static extern bool EnumWindows(EnumCallback callback,IntPtr state);
  [DllImport("user32.dll")]private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]private static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll")]private static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")]private static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetClassName(IntPtr hwnd,StringBuilder value,int length);
  [DllImport("user32.dll")]private static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")]private static extern IntPtr MonitorFromPoint(Point point,uint flags);
  [DllImport("user32.dll")]private static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
  [DllImport("user32.dll")]private static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")]private static extern bool GetWindowPlacement(IntPtr hwnd,ref Placement placement);
  [DllImport("user32.dll")]private static extern bool SetWindowPlacement(IntPtr hwnd,ref Placement placement);
  [DllImport("user32.dll")]private static extern bool ShowWindow(IntPtr hwnd,int command);
  [DllImport("user32.dll")]private static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")]private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")]private static extern int GetWindowLong(IntPtr hwnd,int index);
  [DllImport("user32.dll")]private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")]private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")]private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")]private static extern int Frame(IntPtr hwnd,int attribute,out Rect rect,int size);
  [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")]private static extern int Attribute(IntPtr hwnd,int attribute,out int value,int size);
  public static void UsePhysicalPixels(){SetProcessDpiAwarenessContext(new IntPtr(-4));SetThreadDpiAwarenessContext(new IntPtr(-4));}
  public static Rect WorkArea(){Point point;if(!GetCursorPos(out point))throw new Exception("Cannot locate the current screen.");var info=new MonitorInfo{Size=Marshal.SizeOf(typeof(MonitorInfo))};if(!GetMonitorInfo(MonitorFromPoint(point,2),ref info))throw new Exception("Cannot read the screen work area.");return info.Work;}
  public static Window Find(string[] names,bool explorer){
    Window found=null;
    EnumWindows((hwnd,state)=>{
      if(!IsWindowVisible(hwnd)||GetWindowTextLength(hwnd)==0||GetWindow(hwnd,4)!=IntPtr.Zero)return true;
      int cloaked;if(Attribute(hwnd,14,out cloaked,4)==0&&cloaked!=0)return true;
      uint pid;GetWindowThreadProcessId(hwnd,out pid);
      try{
        using(var process=Process.GetProcessById((int)pid)){
          bool matches=false;foreach(var name in names)if(string.Equals(process.ProcessName,name,StringComparison.OrdinalIgnoreCase)){matches=true;break;}
          if(!matches)return true;
          if(explorer){var cls=new StringBuilder(128);GetClassName(hwnd,cls,128);if(cls.ToString()!="CabinetWClass")return true;}
          var placement=new Placement{Size=Marshal.SizeOf(typeof(Placement))};if(!GetWindowPlacement(hwnd,ref placement))return true;
          found=new Window{Handle=hwnd,Pid=(int)pid,Process=process.ProcessName,Original=placement};return false;
        }
      }catch{return true;}
    },IntPtr.Zero);return found;
  }
  public static void Check(Window window){uint pid;GetWindowThreadProcessId(window.Handle,out pid);if(pid!=window.Pid||!IsWindowVisible(window.Handle))throw new Exception("An app window closed or changed before layout.");}
  public static Rect Visible(Window window){Check(window);Rect rect;if(Frame(window.Handle,9,out rect,Marshal.SizeOf(typeof(Rect)))==0)return rect;if(GetWindowRect(window.Handle,out rect))return rect;throw new Exception("Cannot read app window bounds.");}
  public static void Restore(Window window){Check(window);ShowWindow(window.Handle,9);}
  public static void Place(Window window,int left,int top,int width,int height){
    Check(window);Rect outer;if(!GetWindowRect(window.Handle,out outer))throw new Exception("Cannot read app window bounds.");var visible=Visible(window);
    int l=Math.Max(0,visible.Left-outer.Left),t=Math.Max(0,visible.Top-outer.Top),r=Math.Max(0,outer.Right-visible.Right),b=Math.Max(0,outer.Bottom-visible.Bottom);
    if(!SetWindowPos(window.Handle,IntPtr.Zero,left-l,top-t,width+l+r,height+t+b,0x250))throw new Exception("Windows refused to arrange an app window.");
  }
  public static bool Fits(Window window,int left,int top,int width,int height){var bounds=Visible(window);return Math.Abs(bounds.Left-left)<=4&&Math.Abs(bounds.Top-top)<=4&&Math.Abs(bounds.Width-width)<=4&&Math.Abs(bounds.Height-height)<=4;}
  public static void Rollback(Window window){if(window==null)return;try{Check(window);var placement=window.Original;SetWindowPlacement(window.Handle,ref placement);}catch{}}
  public static void Focus(Window window){Check(window);SetForegroundWindow(window.Handle);}
  public static bool IsPinned(Window window){Check(window);return (GetWindowLong(window.Handle,-20)&8)!=0;}
  public static void Pin(Window window,bool pinned){Check(window);if(pinned&&IsIconic(window.Handle))ShowWindow(window.Handle,9);if(IsPinned(window)==pinned)return;if(!SetWindowPos(window.Handle,new IntPtr(pinned?-1:-2),0,0,0,0,0x213))throw new Exception("Windows refused to change the always-on-top setting.");if(IsPinned(window)!=pinned)throw new Exception("Windows did not confirm the always-on-top setting.");}
}
'@
[CodyAppLayout]::UsePhysicalPixels()
$work=[CodyAppLayout]::WorkArea()
function Find-LayoutWindow([string]$Name){[CodyAppLayout]::Find([string[]]$processNames[$Name],$Name -eq 'file explorer')}
function Resolve-LayoutLaunch([string]$Name){
  if($Name -eq 'plezy'){$candidate=Join-Path $env:LOCALAPPDATA 'Programs\Plezy\plezy.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate};throw 'Plezy is not installed at its normal location.'}
  if($Name -eq 'spotify'){return 'spotify:'};if($Name -eq 'settings'){return 'ms-settings:'}
  $executables=@{firefox='firefox.exe';chrome='chrome.exe';edge='msedge.exe';notepad='notepad.exe';paint='mspaint.exe';calculator='calc.exe';'file explorer'='explorer.exe'}
  $exe=$executables[$Name]
  foreach($registryPath in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\$exe","HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\$exe","HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\$exe")){
    $item=Get-Item -LiteralPath $registryPath -ErrorAction SilentlyContinue
    if($item){$candidate=[string]$item.GetValue('');if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){return $candidate}}
  }
  $relative=@{firefox='Mozilla Firefox\firefox.exe';chrome='Google\Chrome\Application\chrome.exe';edge='Microsoft\Edge\Application\msedge.exe'}
  if($relative.ContainsKey($Name)){foreach($installRoot in @($env:ProgramFiles,[Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),$env:LOCALAPPDATA)){if($installRoot){$candidate=Join-Path $installRoot $relative[$Name];if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}}}}
  $command=Get-Command $exe -ErrorAction SilentlyContinue;if($command){return $command.Source};throw "$Name is not installed or could not be located."
}
if($Mode -ne 'split'){
  $pinApp=$layoutApps[0];$pinWindow=Find-LayoutWindow $pinApp
  if(-not $pinWindow -and ($Mode -eq 'status' -or -not $Topmost)){@{app=$pinApp;pinned=$false;wasOpen=$false;changed=$false}|ConvertTo-Json -Compress;return}
  if(-not $pinWindow){
    $pinExecutable=Resolve-LayoutLaunch $pinApp;Start-Process -FilePath $pinExecutable -ErrorAction Stop
    $pinDeadline=[DateTime]::UtcNow.AddSeconds(22)
    do{$pinWindow=Find-LayoutWindow $pinApp;if($pinWindow){break};Start-Sleep -Milliseconds 150}while([DateTime]::UtcNow -lt $pinDeadline)
    if(-not $pinWindow){throw "$pinApp did not expose a normal app window to pin."}
  }
  $wasPinned=[CodyAppLayout]::IsPinned($pinWindow)
  if($Mode -eq 'pin'){[CodyAppLayout]::Pin($pinWindow,$Topmost)}
  @{app=$pinApp;pinned=[CodyAppLayout]::IsPinned($pinWindow);wasOpen=$true;pid=$pinWindow.Pid;changed=($Mode -eq 'pin' -and $wasPinned -ne $Topmost)}|ConvertTo-Json -Compress;return
}
$found=@{};$launch=@{}
# Locate both apps before opening anything, and move neither until both windows exist.
foreach($layoutApp in $layoutApps){$found[$layoutApp]=Find-LayoutWindow $layoutApp;if(-not $found[$layoutApp]){$launch[$layoutApp]=Resolve-LayoutLaunch $layoutApp}}
foreach($layoutApp in $layoutApps){if($launch.ContainsKey($layoutApp)){Start-Process -FilePath $launch[$layoutApp] -ErrorAction Stop}}
$deadline=[DateTime]::UtcNow.AddSeconds(22)
do{
  foreach($layoutApp in $layoutApps){if(-not $found[$layoutApp]){$found[$layoutApp]=Find-LayoutWindow $layoutApp}}
  if($found[$layoutApps[0]] -and $found[$layoutApps[1]]){break}
  Start-Sleep -Milliseconds 150
}while([DateTime]::UtcNow -lt $deadline)
foreach($layoutApp in $layoutApps){if(-not $found[$layoutApp]){throw "$layoutApp did not expose a normal app window. The windows were not rearranged."}}
$leftWidth=[int][Math]::Floor($work.Width/2);$rightWidth=$work.Width-$leftWidth
try{
  foreach($layoutApp in $layoutApps){[CodyAppLayout]::Restore($found[$layoutApp])};Start-Sleep -Milliseconds 200
  [CodyAppLayout]::Place($found[$layoutApps[0]],$work.Left,$work.Top,$leftWidth,$work.Height)
  [CodyAppLayout]::Place($found[$layoutApps[1]],$work.Left+$leftWidth,$work.Top,$rightWidth,$work.Height)
  Start-Sleep -Milliseconds 300
  if(-not [CodyAppLayout]::Fits($found[$layoutApps[0]],$work.Left,$work.Top,$leftWidth,$work.Height) -or -not [CodyAppLayout]::Fits($found[$layoutApps[1]],$work.Left+$leftWidth,$work.Top,$rightWidth,$work.Height)){throw 'An app could not fit its half of the screen. Its previous position has been restored.'}
  [CodyAppLayout]::Focus($found[$layoutApps[0]])
  $resultWindows=@(foreach($layoutApp in $layoutApps){$window=$found[$layoutApp];$bounds=[CodyAppLayout]::Visible($window);@{app=$layoutApp;pid=$window.Pid;side=$(if($layoutApp -eq $layoutApps[0]){'left'}else{'right'});bounds=@{x=$bounds.Left;y=$bounds.Top;width=$bounds.Width;height=$bounds.Height};reused=(-not $launch.ContainsKey($layoutApp))}})
  @{arranged=$true;windows=$resultWindows;workArea=@{x=$work.Left;y=$work.Top;width=$work.Width;height=$work.Height}}|ConvertTo-Json -Compress -Depth 5
}catch{
  foreach($layoutApp in $layoutApps){[CodyAppLayout]::Rollback($found[$layoutApp])};throw
}
