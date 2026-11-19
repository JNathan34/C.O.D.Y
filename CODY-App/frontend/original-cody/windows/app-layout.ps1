param([Parameter(Mandatory=$true)][string]$AppsJson,[ValidateSet('split','pin','status','focus','manage')][string]$Mode='split',[bool]$Topmost=$true,[string]$OptionsJson='{}')
$ErrorActionPreference='Stop'
[string[]]$layoutApps=ConvertFrom-Json -InputObject $AppsJson
$options=ConvertFrom-Json -InputObject $OptionsJson
$processNames=@{
  firefox=@('firefox');plezy=@('plezy');chrome=@('chrome');edge=@('msedge');notepad=@('notepad');paint=@('mspaint');calculator=@('CalculatorApp','Calculator','calc');'file explorer'=@('explorer');spotify=@('Spotify');settings=@('SystemSettings')
  word=@('WINWORD');discord=@('Discord')
}
if($Mode -eq 'split' -and ($layoutApps.Count -lt 2 -or $layoutApps.Count -gt 4 -or @($layoutApps | Select-Object -Unique).Count -ne $layoutApps.Count)){throw 'Split screen requires two to four different supported apps.'}
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
  public sealed class Window {public IntPtr Handle;public int Pid;public string Process,Title;public Placement Original;}
  private delegate bool EnumCallback(IntPtr hwnd,IntPtr state);
  [DllImport("user32.dll")]private static extern bool EnumWindows(EnumCallback callback,IntPtr state);
  [DllImport("user32.dll")]private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]private static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]private static extern int GetWindowText(IntPtr hwnd,StringBuilder value,int length);
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
  [DllImport("user32.dll")]private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")]private static extern int GetWindowLong(IntPtr hwnd,int index);
  [DllImport("user32.dll")]private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")]private static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")]private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")]private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")]private static extern int Frame(IntPtr hwnd,int attribute,out Rect rect,int size);
  [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")]private static extern int Attribute(IntPtr hwnd,int attribute,out int value,int size);
  public static void UsePhysicalPixels(){SetProcessDpiAwarenessContext(new IntPtr(-4));SetThreadDpiAwarenessContext(new IntPtr(-4));}
  public static Rect WorkArea(){Point point;if(!GetCursorPos(out point))throw new Exception("Cannot locate the current screen.");var info=new MonitorInfo{Size=Marshal.SizeOf(typeof(MonitorInfo))};if(!GetMonitorInfo(MonitorFromPoint(point,2),ref info))throw new Exception("Cannot read the screen work area.");return info.Work;}
  public static Window[] FindAll(string[] names,bool explorer){
    var found=new List<Window>();
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
          var title=new StringBuilder(512);GetWindowText(hwnd,title,title.Capacity);
          found.Add(new Window{Handle=hwnd,Pid=(int)pid,Process=process.ProcessName,Title=title.ToString(),Original=placement});
          return true;
        }
      }catch{return true;}
    },IntPtr.Zero);return found.ToArray();
  }
  public static void Check(Window window){uint pid;GetWindowThreadProcessId(window.Handle,out pid);if(pid!=window.Pid||!IsWindowVisible(window.Handle))throw new Exception("An app window closed or changed before layout.");}
  public static Rect Visible(Window window){Check(window);Rect rect;if(Frame(window.Handle,9,out rect,Marshal.SizeOf(typeof(Rect)))==0)return rect;if(GetWindowRect(window.Handle,out rect))return rect;throw new Exception("Cannot read app window bounds.");}
  public static void Restore(Window window){Check(window);ShowWindow(window.Handle,9);}
  public static bool Foreground(Window window){return GetForegroundWindow()==window.Handle;}
  public static bool Minimized(Window window){Check(window);return IsIconic(window.Handle);}
  public static void ChangeState(Window window,int state){
    Check(window);ShowWindow(window.Handle,state);
    System.Threading.Thread.Sleep(160);Check(window);
    bool minimized=IsIconic(window.Handle),maximized=IsZoomed(window.Handle);
    if(state==6?!minimized:state==3?!maximized:minimized||maximized)
      throw new Exception("Windows did not confirm the requested window state.");
  }
  public static void Place(Window window,int left,int top,int width,int height){
    Check(window);Rect outer;if(!GetWindowRect(window.Handle,out outer))throw new Exception("Cannot read app window bounds.");var visible=Visible(window);
    int l=Math.Max(0,visible.Left-outer.Left),t=Math.Max(0,visible.Top-outer.Top),r=Math.Max(0,outer.Right-visible.Right),b=Math.Max(0,outer.Bottom-visible.Bottom);
    if(!SetWindowPos(window.Handle,IntPtr.Zero,left-l,top-t,width+l+r,height+t+b,0x250))throw new Exception("Windows refused to arrange an app window.");
  }
  public static bool Fits(Window window,int left,int top,int width,int height){var bounds=Visible(window);return Math.Abs(bounds.Left-left)<=4&&Math.Abs(bounds.Top-top)<=4&&Math.Abs(bounds.Width-width)<=4&&Math.Abs(bounds.Height-height)<=4;}
  public static void Rollback(Window window){if(window==null)return;try{Check(window);var placement=window.Original;SetWindowPlacement(window.Handle,ref placement);}catch{}}
  public static bool Focus(Window window){Check(window);SetForegroundWindow(window.Handle);System.Threading.Thread.Sleep(140);return GetForegroundWindow()==window.Handle;}
  public static bool IsPinned(Window window){Check(window);return (GetWindowLong(window.Handle,-20)&8)!=0;}
  public static void Pin(Window window,bool pinned){Check(window);if(pinned&&IsIconic(window.Handle))ShowWindow(window.Handle,9);if(IsPinned(window)==pinned)return;if(!SetWindowPos(window.Handle,new IntPtr(pinned?-1:-2),0,0,0,0,0x213))throw new Exception("Windows refused to change the always-on-top setting.");if(IsPinned(window)!=pinned)throw new Exception("Windows did not confirm the always-on-top setting.");}
}
'@
[CodyAppLayout]::UsePhysicalPixels()
$work=[CodyAppLayout]::WorkArea()
function Get-LayoutWindows([string]$Name){[CodyAppLayout]::FindAll([string[]]$processNames[$Name],$Name -eq 'file explorer')}
function Find-LayoutWindow([string]$Name,[string]$Title){
  $matches=@(Get-LayoutWindows $Name)
  if($Title){
    $exact=@($matches | Where-Object Title -EQ $Title)
    if($exact.Count){$matches=$exact}
    else{$matches=@($matches | Where-Object {$_.Title.IndexOf($Title,[StringComparison]::OrdinalIgnoreCase) -ge 0})}
    if(-not $matches.Count){throw "No $Name window matches '$Title'."}
  }
  if($matches.Count -le 1){return $matches | Select-Object -First 1}
  $active=$matches | Where-Object {[CodyAppLayout]::Foreground($_)} | Select-Object -First 1
  if($active -and -not $Title){return $active}
  $choices=($matches | Select-Object -First 5 | ForEach-Object {$_.Title}) -join '; '
  throw "Which $Name window? Put its title in quotes. Matching windows: $choices"
}
function Resolve-LayoutLaunch([string]$Name){
  if($Name -eq 'plezy'){$candidate=Join-Path $env:LOCALAPPDATA 'Programs\Plezy\plezy.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate};throw 'Plezy is not installed at its normal location.'}
  if($Name -eq 'spotify'){return 'spotify:'};if($Name -eq 'settings'){return 'ms-settings:'}
  $executables=@{firefox='firefox.exe';chrome='chrome.exe';edge='msedge.exe';notepad='notepad.exe';paint='mspaint.exe';calculator='calc.exe';'file explorer'='explorer.exe';word='winword.exe';discord='discord.exe'}
  $exe=$executables[$Name]
  foreach($registryPath in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\$exe","HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\$exe","HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\$exe")){
    $item=Get-Item -LiteralPath $registryPath -ErrorAction SilentlyContinue
    if($item){$candidate=[string]$item.GetValue('');if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){return $candidate}}
  }
  $relative=@{firefox='Mozilla Firefox\firefox.exe';chrome='Google\Chrome\Application\chrome.exe';edge='Microsoft\Edge\Application\msedge.exe'}
  if($relative.ContainsKey($Name)){foreach($installRoot in @($env:ProgramFiles,[Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),$env:LOCALAPPDATA)){if($installRoot){$candidate=Join-Path $installRoot $relative[$Name];if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}}}}
  $command=Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if($command){return $command.Source}
  $displayNames=@{firefox=@('Firefox','Mozilla Firefox');chrome=@('Google Chrome');edge=@('Microsoft Edge');word=@('Word','Microsoft Word')}
  $names=if($displayNames.ContainsKey($Name)){$displayNames[$Name]}else{$Name}
  $entries=@(Get-StartApps | Where-Object {$names -contains $_.Name} | Select-Object -Property AppID -Unique)
  if($entries.Count -eq 1){return "shell:AppsFolder\$($entries[0].AppID)"}
  throw "$Name is not installed or could not be located."
}
function Start-LayoutApp([string]$LaunchPath,[string]$Argument){
  if($LaunchPath.StartsWith('shell:AppsFolder\')){
    if($Argument){throw 'This installed app does not expose a new-window launch command.'}
    Start-Process -FilePath explorer.exe -ArgumentList ('"'+$LaunchPath+'"') -ErrorAction Stop
  }elseif($Argument){
    Start-Process -FilePath $LaunchPath -ArgumentList $Argument -ErrorAction Stop
  }else{
    Start-Process -FilePath $LaunchPath -ErrorAction Stop
  }
}
if($Mode -eq 'focus'){
  $app=$layoutApps[0];$window=$null;$before=@();$argument=''
  if($options.newWindow){
    $switches=@{firefox='-new-window about:blank';chrome='--new-window about:blank';edge='--new-window about:blank';word='/w';'file explorer'='/n'}
    if(-not $switches.ContainsKey($app)){throw "$app does not support an explicit new-window command."}
    $argument=$switches[$app]
    $existing=@(Get-LayoutWindows $app)
    $before=@($existing | ForEach-Object {$_.Handle})
    if($existing.Count){$existingExecutable=(Get-Process -Id $existing[0].Pid -ErrorAction SilentlyContinue).Path}
  }else{$window=Find-LayoutWindow $app ([string]$options.title)}
  $reused=($null -ne $window)
  if(-not $window){
    $launchPath=if($existingExecutable){$existingExecutable}else{Resolve-LayoutLaunch $app}
    Start-LayoutApp $launchPath $argument
    $deadline=[DateTime]::UtcNow.AddSeconds(20)
    do{
      $window=Get-LayoutWindows $app | Where-Object {$before -notcontains $_.Handle} | Select-Object -First 1
      if($window){break}
      Start-Sleep -Milliseconds 150
    }while([DateTime]::UtcNow -lt $deadline)
    if(-not $window){throw "$app was launched but no usable window appeared."}
  }
  if([CodyAppLayout]::Minimized($window)){[CodyAppLayout]::Restore($window)}
  if(-not [CodyAppLayout]::Focus($window)){throw "Windows did not confirm that $app was focused. It may require manual activation."}
  @{app=$app;pid=$window.Pid;title=$window.Title;focused=$true;reused=$reused;launched=(-not $reused)} | ConvertTo-Json -Compress;return
}
if($Mode -eq 'manage'){
  $app=$layoutApps[0];$operation=[string]$options.operation
  if($operation -eq 'inspect'){
    $windows=@(Get-LayoutWindows $app | Where-Object {-not $options.title -or $_.Title.IndexOf([string]$options.title,[StringComparison]::OrdinalIgnoreCase) -ge 0} |
      ForEach-Object {@{title=$_.Title;pid=$_.Pid;minimized=[CodyAppLayout]::Minimized($_)}})
    $running=$null -ne (Get-Process -Name $processNames[$app] -ErrorAction SilentlyContinue | Select-Object -First 1)
    @{app=$app;operation=$operation;windows=$windows;running=$running} | ConvertTo-Json -Compress -Depth 4;return
  }
  $window=Find-LayoutWindow $app ([string]$options.title)
  if(-not $window){throw "$app has no open window."}
  switch($operation){
    'focus' {
      if([CodyAppLayout]::Minimized($window)){[CodyAppLayout]::Restore($window)}
      if(-not [CodyAppLayout]::Focus($window)){throw "Windows did not confirm that $app was focused."}
    }
    'restore' {[CodyAppLayout]::ChangeState($window,9)}
    'minimize' {[CodyAppLayout]::ChangeState($window,6)}
    'maximize' {[CodyAppLayout]::ChangeState($window,3)}
    {$_ -in 'move','resize'} {
      Add-Type -AssemblyName System.Windows.Forms
      $target=[Windows.Forms.Screen]::FromHandle($window.Handle)
      if($operation -eq 'move'){
        $device='\\.\DISPLAY'+[int]$options.display
        $target=[Windows.Forms.Screen]::AllScreens | Where-Object DeviceName -EQ $device | Select-Object -First 1
        if(-not $target){throw "Monitor $($options.display) is unavailable."}
      }
      $area=$target.WorkingArea
      try{
        [CodyAppLayout]::Restore($window)
        $bounds=[CodyAppLayout]::Visible($window)
        $source=[Windows.Forms.Screen]::FromHandle($window.Handle).WorkingArea
        $width=[Math]::Min($bounds.Width,$area.Width);$height=[Math]::Min($bounds.Height,$area.Height)
        if($operation -eq 'resize'){
          $width=[int]$options.width;$height=[int]$options.height
          if($width -lt 1 -or $height -lt 1 -or $width -gt $area.Width -or $height -gt $area.Height){throw 'The requested size does not fit the monitor work area.'}
        }
        $x=$area.Left+[Math]::Max(0,[Math]::Min($bounds.Left-$source.Left,$area.Width-$width))
        $y=$area.Top+[Math]::Max(0,[Math]::Min($bounds.Top-$source.Top,$area.Height-$height))
        [CodyAppLayout]::Place($window,$x,$y,$width,$height)
        Start-Sleep -Milliseconds 300
        $bounds=[CodyAppLayout]::Visible($window)
        if(-not [CodyAppLayout]::Fits($window,$x,$y,$width,$height) -or $bounds.Left -lt $area.Left -or $bounds.Top -lt $area.Top -or $bounds.Right -gt $area.Right -or $bounds.Bottom -gt $area.Bottom){throw 'The window could not fit the requested position and size.'}
      }catch{[CodyAppLayout]::Rollback($window);throw}
    }
    default {throw 'Unsupported window operation.'}
  }
  @{app=$app;operation=$operation;title=$window.Title;pid=$window.Pid;verified=$true;display=$options.display} | ConvertTo-Json -Compress;return
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
$ratio=if($null -ne $options.ratio){[double]$options.ratio}else{0.5}
if($ratio -lt 0.2 -or $ratio -gt 0.8 -or ($ratio -ne 0.5 -and $layoutApps.Count -ne 2)){throw 'Invalid layout ratio.'}
if($options.titles -and $options.titles.Count -ne $layoutApps.Count){throw 'Invalid window titles.'}
for($i=0;$i -lt $layoutApps.Count;$i++){
  $layoutApp=$layoutApps[$i];$title=if($options.titles){[string]$options.titles[$i]}
  $found[$layoutApp]=Find-LayoutWindow $layoutApp $title
  if(-not $found[$layoutApp]){$launch[$layoutApp]=Resolve-LayoutLaunch $layoutApp}
}
foreach($layoutApp in $layoutApps){if($launch.ContainsKey($layoutApp)){Start-LayoutApp $launch[$layoutApp]}}
$deadline=[DateTime]::UtcNow.AddSeconds(22)
do{
  foreach($layoutApp in $layoutApps){if(-not $found[$layoutApp]){$found[$layoutApp]=Find-LayoutWindow $layoutApp}}
  if(@($layoutApps | Where-Object {-not $found[$_]}).Count -eq 0){break}
  Start-Sleep -Milliseconds 150
}while([DateTime]::UtcNow -lt $deadline)
foreach($layoutApp in $layoutApps){if(-not $found[$layoutApp]){throw "$layoutApp did not expose a normal app window. The windows were not rearranged."}}
$leftWidth=[int][Math]::Floor($work.Width*$ratio)
$rowHeight=if($layoutApps.Count -eq 2){$work.Height}else{[int][Math]::Floor($work.Height/2)}
$slots=@(
  @{x=$work.Left;y=$work.Top;width=$leftWidth;height=$rowHeight;side='left'}
  @{x=$work.Left+$leftWidth;y=$work.Top;width=$work.Width-$leftWidth;height=$rowHeight;side='right'}
)
if($layoutApps.Count -eq 3){$slots+=@{x=$work.Left;y=$work.Top+$rowHeight;width=$work.Width;height=$work.Height-$rowHeight;side='bottom'}}
if($layoutApps.Count -eq 4){
  $slots+=@{x=$work.Left;y=$work.Top+$rowHeight;width=$leftWidth;height=$work.Height-$rowHeight;side='bottom-left'}
  $slots+=@{x=$work.Left+$leftWidth;y=$work.Top+$rowHeight;width=$work.Width-$leftWidth;height=$work.Height-$rowHeight;side='bottom-right'}
}
try{
  foreach($layoutApp in $layoutApps){[CodyAppLayout]::Restore($found[$layoutApp])};Start-Sleep -Milliseconds 200
  for($i=0;$i -lt $layoutApps.Count;$i++){
    $slot=$slots[$i]
    [CodyAppLayout]::Place($found[$layoutApps[$i]],$slot.x,$slot.y,$slot.width,$slot.height)
  }
  Start-Sleep -Milliseconds 300
  for($i=0;$i -lt $layoutApps.Count;$i++){
    $slot=$slots[$i]
    if(-not [CodyAppLayout]::Fits($found[$layoutApps[$i]],$slot.x,$slot.y,$slot.width,$slot.height)){throw "$($layoutApps[$i]) could not fit its part of the screen."}
  }
  [void][CodyAppLayout]::Focus($found[$layoutApps[0]])
  $resultWindows=@(for($i=0;$i -lt $layoutApps.Count;$i++){
    $layoutApp=$layoutApps[$i];$window=$found[$layoutApp];$bounds=[CodyAppLayout]::Visible($window)
    @{app=$layoutApp;pid=$window.Pid;title=$window.Title;side=$slots[$i].side;bounds=@{x=$bounds.Left;y=$bounds.Top;width=$bounds.Width;height=$bounds.Height};reused=(-not $launch.ContainsKey($layoutApp))}
  })
  @{arranged=$true;windows=$resultWindows;workArea=@{x=$work.Left;y=$work.Top;width=$work.Width;height=$work.Height}}|ConvertTo-Json -Compress -Depth 5
}catch{
  foreach($layoutApp in $layoutApps){[CodyAppLayout]::Rollback($found[$layoutApp])};throw
}
