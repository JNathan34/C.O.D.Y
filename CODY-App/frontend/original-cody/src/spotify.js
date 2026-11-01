'use strict';
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {excludedMediaSource}=require('./media-source');
class SpotifyMedia extends EventEmitter{
  constructor({launch=spawn,platform=process.platform}={}){super();this.launch=launch;this.platform=platform;this.child=null;this.state={available:false};this.pending=new Map();this.sequence=0;this.playbackPending=null;this.refreshTimer=null;}
  clearPlaybackPending(){clearTimeout(this.refreshTimer);this.refreshTimer=null;this.playbackPending=null;}
  receiveState(value){
    if(value.available&&excludedMediaSource(value.source))value={available:false};
    const expected=this.playbackPending;
    if(expected){
      if(value.source!==expected.source||value.playing===expected.playing||Date.now()>=expected.expiresAt)this.clearPlaybackPending();
      else value={...value,playing:expected.playing};
    }
    this.state=value;this.emit('change',this.snapshot());
  }
  confirmPlayback(action,source){
    if(!this.state.available||!source||source!==this.state.source||!['play','pause','toggle'].includes(action))return;
    const playing=action==='play'?true:action==='pause'?false:!this.state.playing;
    this.clearPlaybackPending();this.playbackPending={source,playing,expiresAt:Date.now()+1200};
    this.state={...this.state,playing};this.emit('change',this.snapshot());
    this.refreshTimer=setTimeout(()=>{if(this.child)this.child.stdin.write(JSON.stringify({action:'refresh'})+'\n');},1200);
  }
  start(){
    if(this.child||this.platform!=='win32')return;
    const file=path.join(__dirname,'../windows/spotify-media.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
    const child=this.launch('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
    let buffer='';child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>100000){this.close();return;}let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);try{const message=JSON.parse(line);if(message.state){this.receiveState(message.state);}else{const request=this.pending.get(message.id);if(request){clearTimeout(request.timeout);this.pending.delete(message.id);message.error?request.reject(Error(message.error)):request.resolve(message);}}}catch{}}});
    child.stderr.resume();child.stdin.on('error',()=>{});
    const offline=()=>{if(this.child!==child)return;this.child=null;this.clearPlaybackPending();this.state={available:false,error:'Windows media connection unavailable.'};this.emit('change',this.snapshot());for(const request of this.pending.values()){clearTimeout(request.timeout);request.reject(Error(this.state.error));}this.pending.clear();};
    child.on('error',offline);child.on('exit',offline);
  }
  snapshot(){return {...this.state};}
  command(action,{target='spotify',source,seconds}={}){
    if(!['play','pause','toggle','next','previous','seek'].includes(action))return Promise.reject(Error('Invalid media command'));
    if(!['spotify','active','current','plezy'].includes(target))return Promise.reject(Error('Invalid media target'));
    if(action==='seek'&&(!Number.isFinite(seconds)||seconds===0||Math.abs(seconds)>86400))return Promise.reject(Error('Invalid seek duration'));
    if(target==='active'&&(typeof source!=='string'||!source||source.length>512))return Promise.reject(Error('Select an available media player first.'));
    if(!this.child)return Promise.reject(Error('Open Spotify or another media player and start playback first.'));
    const id=++this.sequence;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(id);reject(Error('The media player did not respond.'));},10000);this.pending.set(id,{resolve:message=>{this.confirmPlayback(action,message.source||(target==='active'?source:/spotify/i.test(this.state.source||'')?this.state.source:null));resolve(target==='spotify'?'Spotify playback command accepted.':'Media playback command accepted.');},reject,timeout});this.child.stdin.write(JSON.stringify({id,action,target,...(target==='active'?{source}:{}),...(action==='seek'?{seconds}:{})})+'\n');});
  }
  close(){this.clearPlaybackPending();const child=this.child;this.child=null;child?.kill();for(const request of this.pending.values()){clearTimeout(request.timeout);request.reject(Error('Spotify connection closed.'));}this.pending.clear();this.state={available:false};this.emit('change',this.snapshot());}
}
module.exports={SpotifyMedia};
