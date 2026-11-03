'use strict';
const {EventEmitter}=require('node:events'),{spawn}=require('node:child_process');
const {phrasesFor}=require('./wake-listener');
function stripWakeText(text){return String(text||'').trim().replace(/^(?:(?:hey|ok(?:ay)?)[,\s]*)?(?:c[.\s]*o[.\s]*d[.\s]*y|codey|codi)\b[\s,.:;!?-]*/i,'').trim();}
function isListeningCancellation(text){
 const value=stripWakeText(text).toLowerCase().replace(/[’]/g,"'").replace(/[.!?,;]+$/,'').trim();
 const command="(?:cancel(?: (?:that|this|(?:this|the|my) request))?|stop(?: listening)?|never ?mind|forget (?:it|that))";
 if(new RegExp('^(?:(?:please|can you|could you|would you)(?: please)? )?'+command+'(?: please)?$').test(value))return true;
 if(new RegExp('(?:^|[,.!?;] |\\b(?:actually|no|sorry|wait) )'+command+'(?: please)?$').test(value))return true;
 const ending=new RegExp(' (?:'+command+')(?: please)?$').exec(value);if(!ending)return false;
 const before=value.slice(0,ending.index).trim();
 // Keep requests about cancellation and literal text as normal requests.
 if(/^(?:how|why|what|explain|describe|tell me (?:how|why|what))\b/.test(before))return false;
 if(/\b(?:to|i|you|we|they|the|a|an|my|your|our|their|word|phrase|say|says|said|type|write|named|called|labelled|labeled|button|click|press|select|choose|tap|label|read|spell|don't|not)\s*$/.test(before))return false;
 if(/["'“”‘’]/.test(before))return false;
 return true;
}
function endPauseMs(text,learned=0){
 const value=stripWakeText(text).toLowerCase().replace(/[’]/g,"'").trim(),plain=value.replace(/[.!?,;:]+$/,'');
 if(!plain)return 1800;
 if(/(?:\b(?:um|uh|erm|hmm|well)|\blet me (?:think|see)|\bhold on|\bone (?:moment|second))$/.test(plain))return Math.max(3200,learned);
 if(/\b(?:and|or|but|because|so|then|to|with|for|from|of|the|a|an|my|your|that|which|if|when|while|can|could|would|should|is|are|was|were|want|need|please)$/.test(plain)||/[,;:]$/.test(value))return Math.max(2600,learned);
 return Math.max(/[.!?]$/.test(value)?1050:1400,learned);
}
class KeywordWakeListener extends EventEmitter{
 constructor({launch,canListen=()=>null,canCapture=()=>null,beginVoice,endVoice,cancelVoice,onWake=()=>{},spawnProcess=spawn,now=Date.now}={}){
  super();Object.assign(this,{launch,canListen,canCapture,beginVoice,endVoice,cancelVoice,onWake,spawnProcess,now});this.enabled=false;this.capture=false;this.opening=false;this.finishing=false;this.phrases=[];this.mode='off';this.message='Hands-free listening is off.';this.epoch=0;this.generation=0;this.cooldown=0;this.failures=0;this.poll=setInterval(()=>this.update(),100);this.poll.unref?.();
 }
 snapshot(){return {enabled:this.enabled,mode:this.mode,message:this.message,phrases:[...this.phrases],local:true,detector:'keyword'};}
 setMuted(muted){this.muted=Boolean(muted);if(this.muted){this.stop();this.status('paused','C.O.D.Y. microphone is muted. Press Ctrl + Alt + M to unmute.');}else this.update();}
 status(mode,message){if(mode===this.mode&&message===this.message)return;this.mode=mode;this.message=message;this.emit('change',this.snapshot());}
 configure(prefs){const phrases=phrasesFor(prefs),changed=JSON.stringify(phrases)!==JSON.stringify(this.phrases);this.phrases=phrases;this.enabled=prefs.wakeWordEnabled===true;if(changed||!this.enabled)this.stop();if(!this.enabled)this.status('off','Hands-free listening is off.');else this.update();return this.snapshot();}
 stop(){
  this.generation++;this.finishing=false;this.aborting=false;clearTimeout(this.startup);clearTimeout(this.retry);this.retry=null;this.ready=false;this.wire=null;this.confirmed=null;this.lastState=null;this.cancelCandidate=null;
  const pending=this.pending;this.pending=null;if(pending){clearTimeout(pending.timer);pending.reject(Error('Wake listener stopped.'));}
  const child=this.child;this.child=null;if(child)try{child.stdin.end(JSON.stringify({mode:'quit',epoch:++this.epoch})+'\n');child.kill();}catch{}
  if(this.capture||this.opening){this.capture=false;this.opening=false;void this.cancelVoice?.().catch(error=>this.emit('diagnostic',error.message));}
 }
 fault(message){this.stop();this.status('error',String(message).slice(0,220));if(this.enabled&&!this.closed){this.retry=setTimeout(()=>{this.retry=null;this.update();},Math.min(15000,1000*2**Math.min(this.failures++,4)));this.retry.unref?.();}}
 start(){
  if(this.muted)return;
  if(this.child||this.retry||this.closed)return;
  this.status('starting','Starting local wake detection…');let child;
  try{const launch=this.launch(this.phrases);child=this.spawnProcess(launch.command,launch.args,{...launch.options,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){this.fault(error.message);return;}
  this.child=child;let buffer='';child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{if(this.child!==child)return;buffer+=chunk;if(buffer.length>300000){this.fault('Invalid wake listener response.');return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{this.receive(JSON.parse(line));}catch{}}});
  child.stdin.on?.('error',()=>{});child.stderr.on('data',()=>{});
  child.once('error',error=>{if(this.child===child)this.fault(error.message);});child.once('close',()=>{if(this.child===child)this.fault('Local wake detection stopped.');});
  this.startup=setTimeout(()=>{if(this.child===child&&!this.ready)this.fault('Local wake detection took too long to start.');},15000);this.startup.unref?.();
 }
 request(mode){
  if(this.pending?.mode===mode)return this.pending.promise;
  if(this.wire===mode&&this.confirmed===this.epoch)return Promise.resolve(this.lastState);
  if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('Wake microphone mode changed.'));this.pending=null;}
  const epoch=++this.epoch;this.wire=mode;this.confirmed=null;
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});
  const timer=setTimeout(()=>{if(this.pending?.epoch===epoch)this.fault('Wake microphone did not acknowledge '+mode+'.');},4000);timer.unref?.();this.pending={epoch,mode,resolve,reject,promise,timer};
  try{this.child.stdin.write(JSON.stringify({mode,epoch})+'\n');}catch(error){this.fault(error.message);}return promise;
 }
 update(){
  if(this.muted)return;
  if(this.closed||!this.enabled)return;
  if(!this.phrases.length){this.stop();this.status('paused','Choose at least one wake phrase.');return;}
  if(!this.child){this.start();return;}if(!this.ready)return;
  if(this.cancelCandidate&&(this.capture||this.finishing)&&this.now()-this.cancelCandidate.since>=250&&this.now()-this.lastSpeech>=200){void this.abort('Cancelled. Say a wake phrase when ready.');return;}
  if(this.capture){const reason=this.canCapture();if(reason){void this.abort(reason);return;}this.tickCapture();return;}
  if(this.opening||this.finishing)return;
  const reason=this.canListen();if(reason||this.now()<this.cooldown){void this.request('pause');this.status('paused',reason||this.cooldownMessage||'Waiting for the reply to finish…');return;}
  void this.request('listen');if(this.confirmed===this.epoch)this.status('listening','Ready for '+this.phrases.map(p=>p.replace('cody','Cody')).join(' / ')+'.');
 }
 receive(value){
  if(this.muted)return;
  if(!this.enabled||this.closed||!value)return;
  if(value.type==='ready'){clearTimeout(this.startup);this.ready=true;this.update();return;}
  if(value.type==='error'){this.fault(value.message);return;}
  if(value.type==='state'){
   if(value.epoch!==this.epoch)return;this.confirmed=value.epoch;this.lastState=value;
   if(this.pending?.epoch===value.epoch){clearTimeout(this.pending.timer);this.pending.resolve(value);this.pending=null;}
   if(value.mode==='listening')this.failures=0;this.update();return;
  }
  if(value.type==='wake'&&value.epoch===this.epoch&&this.confirmed===this.epoch&&this.wire==='listen'&&this.phrases.includes(value.phrase))void this.wake();
 }
 async wake(){
  if(this.muted)return false;
  if(this.opening||this.capture||this.finishing||this.canListen()||this.now()<this.cooldown)return false;
  const generation=this.generation;this.opening=true;this.status('arming','Opening the microphone…');
  try{
   const state=await this.request('pause');if(generation!==this.generation||!this.enabled||this.canListen())return false;
   const result=await this.beginVoice({wake:true,audioPrefix:state.audioPrefix||undefined});
   if(generation!==this.generation||!this.enabled){await this.cancelVoice();return false;}
   if(!result?.listening)throw Error(result?.error||'Voice recognition did not start. Check your microphone and HeyClicky sign-in.');
   this.capture=true;this.started=this.now();this.lastSpeech=0;this.heardSpeech=false;this.speechFrames=0;this.noise=.02;this.transcript='';this.cancelCandidate=null;this.levels=[];this.lastTranscriptAt=this.started;this.pauseTolerance=0;this.status('armed','Listening for your request…');
   try{await this.onWake();}catch{}return true;
  }catch(error){if(generation===this.generation){this.emit('diagnostic',error.message);this.cooldown=this.now()+1500;this.status('error',error.message);await this.cancelVoice?.().catch(()=>{});}return false;}
  finally{if(generation===this.generation)this.opening=false;}
 }
 meter(value){
  if(!this.capture||value.state!=='Listening'||this.now()-this.started<450)return;
  if(typeof value.voiceActive==='boolean'){
   if(value.voiceActive){if(this.heardSpeech&&this.transcript&&this.now()-this.lastSpeech>=700)this.pauseTolerance=Math.min(2600,Math.max(this.pauseTolerance,this.now()-this.lastSpeech+300));this.heardSpeech=true;this.lastSpeech=this.now();}
   return;
  }
  const level=Math.max(0,Math.min(1,Number(value.level)||0));
  this.levels.push(level);if(this.levels.length>15)this.levels.shift();
  // A steady fan/hum should not keep the recording open indefinitely.
  const average=this.levels.reduce((a,b)=>a+b,0)/this.levels.length;
  const steady=this.levels.length>=12&&average<.25&&Math.max(...this.levels)-Math.min(...this.levels)<Math.max(.008,average*.18);
  if(steady)this.noise=Math.max(this.noise,average);
  const threshold=Math.max(.055,Math.min(.4,this.noise*2.8+.01));
  if(!steady&&level>threshold){
   this.speechFrames++;
   if(this.speechFrames>=2){
    if(this.heardSpeech&&this.transcript&&this.now()-this.lastSpeech>=700)this.pauseTolerance=Math.min(2600,Math.max(this.pauseTolerance,this.now()-this.lastSpeech+300));
    this.heardSpeech=true;this.lastSpeech=this.now();
   }
  }else{this.speechFrames=0;if(!steady&&level<threshold)this.noise=this.noise*.96+Math.min(level,.06)*.04;}
 }
 heard(text){
  if(!this.capture&&!this.finishing)return;
  const raw=String(text||'').trim();
  if(isListeningCancellation(raw)){
   const value=stripWakeText(raw);if(this.cancelCandidate?.text!==value)this.cancelCandidate={text:value,since:this.now()};
   // Do not wait for the normal sentence-ending pause for a stop command.
   if(!this.lastSpeech)this.lastSpeech=this.now();return;
  }
  this.cancelCandidate=null;
  if(!this.capture||/^(?:hey|ok|okay|cody|hey[ ,]+cody|ok(?:ay)?[ ,]+cody)[.!?,]*$/i.test(raw))return;
  const value=stripWakeText(raw);if(!value||value===this.transcript)return;
  if(this.transcript&&this.now()-this.lastSpeech>=700)this.pauseTolerance=Math.min(2600,Math.max(this.pauseTolerance,this.now()-this.lastSpeech+300));
  this.transcript=value;this.heardSpeech=true;this.lastSpeech=this.now();this.lastTranscriptAt=this.now();
 }
 phase(state){if(this.capture&&!this.finishing&&state==='Idle')void this.abort('Ready for a wake phrase.');}
 tickCapture(){
  const elapsed=this.now()-this.started,quiet=this.now()-this.lastSpeech;
  if(elapsed>=90000){void this.finishCapture();return;}
  if(this.heardSpeech&&quiet>=endPauseMs(this.transcript,this.pauseTolerance)&&this.now()-this.lastTranscriptAt>=450){void this.finishCapture();}
  else if(!this.heardSpeech&&elapsed>=8000)void this.abort('No request heard. Ready for a wake phrase.');
 }
 async finishCapture(){
  if(!this.capture||this.finishing)return;
  if(this.cancelCandidate){void this.abort('Cancelled. Say a wake phrase when ready.');return;}
  const generation=this.generation;this.capture=false;this.finishing=true;this.status('processing','Sending your request…');
  try{await this.endVoice();}catch(error){if(generation===this.generation){this.emit('diagnostic',error.message);await this.cancelVoice?.().catch(()=>{});}}
  finally{if(generation===this.generation){this.finishing=false;this.cooldown=this.now()+1000;this.cooldownMessage='Waiting for the reply to finish…';this.update();}}
 }
 async abort(message){
  if(this.aborting||!this.capture&&!this.opening&&!this.finishing)return;
  this.capture=false;this.opening=false;this.cancelCandidate=null;const generation=++this.generation;this.finishing=true;this.aborting=true;
  this.status('paused',message);
  try{await this.cancelVoice();}catch(error){this.emit('diagnostic',error.message);}
  finally{this.aborting=false;if(generation===this.generation){this.finishing=false;this.cooldown=this.now()+700;this.cooldownMessage=message;this.update();}}
 }
 close(){this.closed=true;this.enabled=false;clearInterval(this.poll);this.stop();this.status('off','Hands-free listening is off.');}
}
module.exports={KeywordWakeListener,stripWakeText,isListeningCancellation,endPauseMs};
