'use strict';
const {spawn} = require('node:child_process');
const os=require('node:os');
const path=require('node:path');

const APP_WHITELIST=Object.freeze({
  notepad:'notepad.exe',calculator:'calc.exe',calc:'calc.exe',paint:'mspaint.exe',
  'file explorer':'explorer.exe',explorer:'explorer.exe',edge:'msedge.exe',
  chrome:'chrome.exe',firefox:'firefox.exe',spotify:'spotify:',settings:'ms-settings:',
  plezy:path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Programs','Plezy','plezy.exe')
});
const HOTKEYS=Object.freeze({
  'ctrl+c':[0x11,0x43], 'ctrl+v':[0x11,0x56], 'ctrl+x':[0x11,0x58],
  'ctrl+z':[0x11,0x5a], 'ctrl+a':[0x11,0x41], 'alt+tab':[0x12,0x09],
  'ctrl+s':[0x11,0x53], 'ctrl+l':[0x11,0x4c], 'ctrl+f':[0x11,0x46],
  'win+d':[0x5b,0x44], 'win+left':[0x5b,0x25], 'win+right':[0x5b,0x27],
  'win+up':[0x5b,0x26], 'win+down':[0x5b,0x28],
  'esc':[0x1b], 'enter':[0x0d], 'tab':[0x09], 'shift+tab':[0x10,0x09],
  'space':[0x20], 'backspace':[0x08], 'left':[0x25], 'right':[0x27], 'up':[0x26], 'down':[0x28]
});

function psQuote(v){return "'"+String(v).replace(/'/g,"''")+"'";}
function runPowerShell(script,opts={}){
  return new Promise((resolve,reject)=>{
    if(process.platform!=='win32'&&!opts.allowNonWindows) return reject(Error('Windows control requires Windows'));
    if(opts.signal?.aborted)return reject(Error('Action cancelled.'));
    const proc=(opts.spawn||spawn)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(`$ErrorActionPreference='Stop';\n${script}`,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='',finished=false;
    const done=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result);};
    const abort=()=>{proc.kill();done(Error('Action cancelled.'));};
    const timer=setTimeout(()=>{proc.kill();done(Error('Windows command timed out'));},opts.timeout||12000);
    opts.signal?.addEventListener('abort',abort,{once:true});
    proc.stdout.on('data',part=>{out+=part.toString();if(out.length>1_000_000){proc.kill();done(Error('Command output exceeded limit'));}});
    proc.stderr.on('data',part=>{err+=part.toString();if(err.length>16_000)err=err.slice(0,16_000);});
    proc.on('error',done);
    proc.on('close',code=>done(code===0?null:Error((err||out||`Windows command exited with ${code}`).slice(0,1500)),out.trim()));
  });
}
// Windows Core Audio endpoint COM interop: compiled in-memory within PowerShell, no install required.
const AUDIO_TYPES=String.raw`
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow,int stateMask,out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow,int role,out IMMDevice device);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid,int clsctx,IntPtr activationParams,[MarshalAs(UnmanagedType.IUnknown)]out object instance);
  [PreserveSig] int OpenPropertyStore(int access,out IntPtr props);
  [PreserveSig] int GetId(out IntPtr id);
  [PreserveSig] int GetState(out int state);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
  [PreserveSig] int GetChannelCount(out int count);
  [PreserveSig] int SetMasterVolumeLevel(float level,ref Guid context);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level,ref Guid context);
  [PreserveSig] int GetMasterVolumeLevel(out float level);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel,float level,ref Guid context);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel,float level,ref Guid context);
  [PreserveSig] int GetChannelVolumeLevel(uint channel,out float level);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel,out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,ref Guid context);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);
}
public static class CodyAudio {
  static IAudioEndpointVolume Endpoint(){
    IMMDeviceEnumerator enumerator=(IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice device; Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0,1,out device));
    Guid iid=typeof(IAudioEndpointVolume).GUID;object obj;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid,23,IntPtr.Zero,out obj));
    return (IAudioEndpointVolume)obj;
  }
  public static string State(){float level;bool muted;var endpoint=Endpoint();Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out level));Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));return "{\"level\":"+Math.Round(level*100)+",\"muted\":"+(muted?"true":"false")+"}";}
  public static void SetVolume(int percent){Guid ctx=Guid.Empty;Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(percent/100f,ref ctx));}
  public static void SetMute(bool muted){Guid ctx=Guid.Empty;Marshal.ThrowExceptionForHR(Endpoint().SetMute(muted,ref ctx));}
}
`;
const USER32=String.raw`
using System;
using System.Runtime.InteropServices;
public class CodyNativeInput {
 [DllImport("user32.dll", SetLastError=true)] public static extern bool SetForegroundWindow(IntPtr handle);
 [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr extra);
}
`;
function addType(source){return `Add-Type -TypeDefinition ${psQuote(source)} -ErrorAction Stop;`}
function audioSet(level){return `${addType(AUDIO_TYPES)} [CodyAudio]::SetVolume(${level}); 'Volume: ${level}%'`}
function audioMute(muted){return `${addType(AUDIO_TYPES)} [CodyAudio]::SetMute($${muted?'true':'false'}); 'Audio ${muted?'muted':'unmuted'}'`}
function openApp(app){
 const executable=APP_WHITELIST[app];if(!executable)throw Error('Application is not on the approved list');
 if(app==='firefox')return String.raw`
$firefoxPath=$null
foreach($registryPath in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe','HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe')){
 $registryItem=Get-Item -LiteralPath $registryPath -ErrorAction SilentlyContinue
 if($registryItem){$candidate=[string]$registryItem.GetValue('');if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){$firefoxPath=$candidate;break}}
}
if(-not $firefoxPath){
 foreach($installRoot in @($env:ProgramFiles,[Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),$env:LOCALAPPDATA)){
  if($installRoot){$candidate=Join-Path $installRoot 'Mozilla Firefox\firefox.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$firefoxPath=$candidate;break}}
 }
}
if(-not $firefoxPath){$firefoxCommand=Get-Command firefox.exe -ErrorAction SilentlyContinue;if($firefoxCommand){$firefoxPath=$firefoxCommand.Source}}
if(-not $firefoxPath){throw 'Firefox is not installed or could not be located. Install Firefox, then try again.'}
Start-Process -FilePath $firefoxPath -ErrorAction Stop
'Launched firefox'`;
 return `Start-Process -FilePath ${psQuote(executable)}; 'Launched ${app.replace(/[^a-z ]/g,'')}'`;
}
const processList=String.raw`@(Get-Process | Select-Object -First 90 @{Name='pid';Expression={$_.Id}},@{Name='name';Expression={$_.ProcessName}}) | ConvertTo-Json -Compress -Depth 3`;
const windowList=String.raw`@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 100 @{Name='pid';Expression={$_.Id}},@{Name='title';Expression={$_.MainWindowTitle}},@{Name='process';Expression={$_.ProcessName}}) | ConvertTo-Json -Compress -Depth 3`;
function showWindow(pid,code){if(![3,6].includes(code))throw Error('Unsupported window action');return `${addType(USER32)} $p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.MainWindowHandle -eq 0){throw 'Window not found'}; Add-Type -TypeDefinition ${psQuote('using System; using System.Runtime.InteropServices; public class CodyShowWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int cmd); }')} -ErrorAction Stop; [CodyShowWindow]::ShowWindowAsync($p.MainWindowHandle,${code}) | Out-Null; 'Window updated'`; }
function closeApp(pid){return `$p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.MainWindowHandle -eq 0){throw 'Application has no main window'}; $allowed=@('notepad','calc','calculator','mspaint','explorer','msedge','chrome','firefox','spotify'); if($allowed -notcontains $p.ProcessName.ToLowerInvariant()){throw 'Only approved applications may be closed'}; if(-not $p.CloseMainWindow()){throw 'Application refused close request'}; 'Close requested (application may ask to save)'`; }
function focusWindow(pid){return `${addType(USER32)} $p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.MainWindowHandle -eq 0){throw 'Process has no visible window'}; if(-not [CodyNativeInput]::SetForegroundWindow($p.MainWindowHandle)){throw 'Windows refused to focus the window'}; 'Window focused'`;}
function mouseMove(x,y){return `${addType(USER32)} if(-not [CodyNativeInput]::SetCursorPos(${x},${y})){throw 'Unable to move cursor'}; 'Cursor moved'`;}
function mouseClick(button){const down=button==='right'?8:button==='middle'?32:2;const up=button==='right'?16:button==='middle'?64:4;return `${addType(USER32)} [CodyNativeInput]::mouse_event(${down},0,0,0,[UIntPtr]::Zero);[CodyNativeInput]::mouse_event(${up},0,0,0,[UIntPtr]::Zero); 'Clicked ${button}'`;}
function hotkey(name){if(!HOTKEYS[name])throw Error('Unsupported shortcut');const keys=HOTKEYS[name];const downs=keys.map(n=>`[CodyNativeInput]::keybd_event(${n},0,0,[UIntPtr]::Zero);`).join('');const ups=[...keys].reverse().map(n=>`[CodyNativeInput]::keybd_event(${n},0,2,[UIntPtr]::Zero);`).join('');return `${addType(USER32)} ${downs} Start-Sleep -Milliseconds 50;${ups} 'Shortcut sent'`;}
// SendKeys supports common ASCII text. Brackets and reserved characters must be escaped.
function typeText(text){if(/[^\x09\x0a\x0d\x20-\x7e]/.test(text))throw Error('Keyboard typing supports ASCII text only in this version');const escaped=text.replace(/[+^%~()[\]{}]/g,c=>'{'+c+'}').replace(/\r?\n/g,'{ENTER}');return `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(escaped)}); 'Text typed'`;}
async function audioState(){return JSON.parse(await runPowerShell(`${addType(AUDIO_TYPES)} [CodyAudio]::State()`));}
async function systemStatus(){
  const cpus=os.cpus();const idle=cpus.reduce((n,c)=>n+c.times.idle,0),total=cpus.reduce((n,c)=>n+Object.values(c.times).reduce((a,b)=>a+b,0),0);
  await new Promise(resolve=>setTimeout(resolve,150));
  const cpus2=os.cpus();const idle2=cpus2.reduce((n,c)=>n+c.times.idle,0),total2=cpus2.reduce((n,c)=>n+Object.values(c.times).reduce((a,b)=>a+b,0),0);
  const cpuPercent=(total2-total)>0?Math.round(100*(1-(idle2-idle)/(total2-total))):null;
  return {platform:os.platform(),architecture:os.arch(),hostname:os.hostname(),cpu:cpus[0]?.model||'Unknown',cpuPercent,ramTotalGB:+(os.totalmem()/2**30).toFixed(1),ramUsedGB:+((os.totalmem()-os.freemem())/2**30).toFixed(1)};
}
module.exports={audioState,APP_WHITELIST,HOTKEYS,psQuote,runPowerShell,audioSet,audioMute,openApp,windowList,processList,showWindow,closeApp,focusWindow,mouseMove,mouseClick,hotkey,typeText,systemStatus};
