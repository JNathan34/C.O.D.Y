'use strict';

const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');

// Windows emits this event when the built-in display brightness changes,
// including changes made by laptop brightness keys and Windows Settings.
// An event subscription avoids polling PowerShell or running a speed test.
const WATCH_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Register-CimIndicationEvent -Namespace root/wmi -Query 'SELECT * FROM WmiMonitorBrightnessEvent' -SourceIdentifier CodyBrightness | Out-Null
  while ($true) {
    $event = Wait-Event -SourceIdentifier CodyBrightness
    if ($null -eq $event) { continue }
    $level = [int]$event.SourceEventArgs.NewEvent.Brightness
    [Console]::Out.WriteLine('CODY_BRIGHTNESS:' + $level)
    [Console]::Out.Flush()
    Remove-Event -EventIdentifier $event.EventIdentifier
  }
} catch {
  [Console]::Error.WriteLine('Brightness event unavailable: ' + $_.Exception.Message)
} finally {
  Unregister-Event -SourceIdentifier CodyBrightness -ErrorAction SilentlyContinue
}`;

function parseBrightnessLine(line){
  const match=/^CODY_BRIGHTNESS:(\d{1,3})$/.exec(String(line).trim());
  if(!match)return null;
  const level=Number(match[1]);
  return Number.isInteger(level)&&level>=0&&level<=100?level:null;
}

class BrightnessMonitor extends EventEmitter {
  constructor({platform=process.platform,spawnProcess=spawn}={}){
    super();
    this.platform=platform;
    this.spawnProcess=spawnProcess;
    this.child=null;
    this.lastLevel=null;
    this.buffer='';
  }
  start(){
    if(this.platform!=='win32'||this.child)return false;
    try {
      const command=Buffer.from(WATCH_SCRIPT,'utf16le').toString('base64');
      const child=this.spawnProcess('powershell.exe',
        ['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',command],
        {windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.child=child;
      child.stdout?.on('data',chunk=>{
        this.buffer+=String(chunk);
        if(this.buffer.length>8192)this.buffer=this.buffer.slice(-8192);
        let newline;
        while((newline=this.buffer.indexOf('\n'))!==-1){
          const line=this.buffer.slice(0,newline).trim();
          this.buffer=this.buffer.slice(newline+1);
          const level=parseBrightnessLine(line);
          if(level===null||level===this.lastLevel)continue;
          this.lastLevel=level;
          this.emit('change',level);
        }
      });
      child.on('error',error=>{this.emit('diagnostic',error.message);this.stop();});
      child.on('exit',()=>{if(this.child===child)this.child=null;});
      // Brightness WMI is not supported by many external monitors.
      child.stderr?.on('data',()=>{});
      return true;
    }catch(error){this.emit('diagnostic',error.message);this.stop();return false;}
  }
  stop(){
    const child=this.child;
    this.child=null;
    if(child&&!child.killed)child.kill();
  }
}
module.exports={BrightnessMonitor,parseBrightnessLine};
