'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
class TimerAlarm{
  constructor({launch=spawn}={}){this.launch=launch;this.child=null;}
  start(){
    this.stop();
    const file=path.join(__dirname,'../windows/timer-alarm.wav').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep).replace(/'/g,"''");
    const script=`$ErrorActionPreference='Stop'; $player=New-Object System.Media.SoundPlayer('${file}'); $player.Load(); $player.PlayLooping(); Start-Sleep -Seconds 60; $player.Stop()`;
    const child=this.launch('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});
    this.child=child;child.on('error',()=>{if(this.child===child)this.child=null;});child.on('exit',()=>{if(this.child===child)this.child=null;});
  }
  stop(){this.child?.kill();this.child=null;}
}
module.exports={TimerAlarm};
