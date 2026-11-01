'use strict';
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const path=require('node:path');

function phrasesFor(prefs){return [...(prefs.wakeHeyCody?['hey cody']:[]),...(prefs.wakeOkayCody?['ok cody','okay cody']:[]),...(prefs.wakeCody?['cody']:[])];}
function extractWake(text,phrases){
 const value=String(text||'').trim().replace(/[.!?]+$/,'');
 for(const phrase of [...phrases].sort((a,b)=>b.length-a.length)){
  if(value.toLowerCase()===phrase)return {phrase,command:''};
  const prefix=new RegExp('^'+phrase.replace(/ /g,'\\s+')+'(?:[,:]\\s*|\\s+)(.*)$','i').exec(value);
  if(prefix)return {phrase,command:prefix[1].trim()};
 }
 return null;
}
class WakeListener extends EventEmitter{
 constructor({canListen=()=>null,handleCommand,onWake=()=>{},spawnProcess=spawn,now=()=>Date.now(),script=path.join(__dirname,'../../windows/wake-listener.ps1')}={}){
  super();Object.assign(this,{canListen,handleCommand,onWake,spawnProcess,now,script});this.prefs={};this.phrases=[];this.enabled=false;this.mode='off';this.message='Hands-free listening is off.';this.ready=false;this.closed=false;this.failures=0;this.cooldown=0;this.armedUntil=0;this.hearingUntil=0;this.armedDeadline=0;
  this.poll=setInterval(()=>this.update(),200);this.poll.unref?.();
 }
 snapshot(){return {enabled:this.enabled,mode:this.mode,message:this.message,phrases:[...this.phrases],local:true};}
 status(mode,message){if(this.mode===mode&&this.message===message)return;this.mode=mode;this.message=message;this.emit('change',this.snapshot());}
 configure(prefs){
  const phrases=phrasesFor(prefs),changed=JSON.stringify(phrases)!==JSON.stringify(this.phrases);this.prefs=prefs;this.phrases=phrases;this.enabled=prefs.wakeWordEnabled===true;
  if(changed)this.stop();if(!this.enabled){this.stop();this.status('off','Hands-free listening is off.');}else this.update();return this.snapshot();
 }
 stop(){
  clearTimeout(this.startup);this.startup=null;clearTimeout(this.retry);this.retry=null;this.armedUntil=0;this.hearingUntil=0;this.armedDeadline=0;this.ready=false;this.wire=null;
  const child=this.child;this.child=null;if(child){try{child.stdin.end('quit\n');child.kill();}catch{}}
 }
 send(mode){if(!this.child||this.wire===mode)return;this.wire=mode;try{this.child.stdin.write(mode+'\n');}catch{this.fault('The wake listener disconnected.');}}
 start(){
  if(this.closed||this.child||this.retry||!this.enabled)return;
  this.status('starting','Starting local wake listening…');
  const script=this.script.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  const child=this.spawnProcess('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Phrases',this.phrases.join('|')],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;this.startup=setTimeout(()=>{if(this.child===child&&!this.ready)this.fault("Local wake recognition took too long to start.");},12000);this.startup.unref?.();let buffer='';
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{if(this.child!==child)return;buffer+=chunk;if(buffer.length>65536){this.fault('Invalid wake-listener response.');return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{this.receive(JSON.parse(line));}catch{}}});
  child.stdin.on?.('error',()=>{});child.stderr.on('data',()=>{});
  child.once('error',error=>{if(this.child===child)this.fault(error.message);});child.once('close',()=>{if(this.child===child)this.fault('Local speech recognition stopped.');});
 }
 fault(message){
  this.stop();this.status('error',String(message||'Wake listening is unavailable.').slice(0,220));
  if(this.enabled&&!this.closed){const delay=Math.min(15000,1000*2**Math.min(this.failures++,4));this.retry=setTimeout(()=>{this.retry=null;this.update();},delay);this.retry.unref?.();}
 }
 update(){
  if(this.closed||!this.enabled)return;
  if(!this.phrases.length){this.stop();this.status('paused','Choose at least one wake phrase.');return;}
  if(!this.child){this.start();return;}if(!this.ready)return;
  const reason=this.canListen();
  if(reason||this.handling||this.now()<this.cooldown){this.armedUntil=0;this.hearingUntil=0;this.armedDeadline=0;this.send('pause');this.status('paused',reason||'Waiting for the reply to finish…');return;}
  if(this.armedUntil&&this.now()>=this.armedUntil){this.armedUntil=0;this.hearingUntil=0;this.armedDeadline=0;this.send('wake');}
  if(this.wire==='pause'||!this.wire)this.send('listen');
  const hearing=this.now()<this.hearingUntil;
  this.status(this.armedUntil?'armed':hearing?'hearing':'listening',this.armedUntil?'Listening for your request…':hearing?'Listening…':'Listening for '+this.phrases.map(p=>p.replace('cody','Cody')).join(' / ')+'.');
 }
 receive(value){
  if(!this.enabled||this.closed||!value)return;
  if(value.type==='ready'){clearTimeout(this.startup);this.startup=null;this.ready=true;this.update();return;}
  if(value.type==='error'){this.fault(value.message);return;}
  if(value.type==='state'){if(value.mode==='listening')this.failures=0;return;}
  if(value.type==='activity'){
   if(!this.ready||this.handling||this.canListen()||this.now()<this.cooldown||!['listen','arm','wake'].includes(this.wire))return;
   // A recognizer hypothesis is not proof of the wake phrase.
   if(!value.followup||this.armedUntil<=this.now()||this.armedDeadline<=this.now())return;
   this.hearingUntil=this.now()+3500;
   if(this.armedUntil)this.armedUntil=Math.min(this.armedDeadline,this.now()+8000);
   this.update();return;
  }
  if(value.type==='speech')void this.accept(value);
 }
 async accept(value){
  if(!this.enabled||!this.ready||this.handling||this.canListen()||this.now()<this.cooldown||!['listen','arm','wake'].includes(this.wire))return false;
  if(typeof value.text!=='string'||value.text.length>2000||!Number.isFinite(value.confidence)||value.confidence<.28)return false;
  let command,match;
  if(value.followup){if(!this.armedUntil||this.now()>=this.armedUntil||value.confidence<.6)return false;command=value.text.trim();}
  else{
   match=extractWake(value.text,this.phrases);if(!match||!Number.isFinite(value.wakeConfidence)||!Number.isFinite(value.nameConfidence))return false;command=match.command;
   // Check the name itself; high confidence in the following command must
   // not make a guessed wake phrase look reliable.
   const nameMinimum=match.phrase==='cody'?.85:command?.5:match.phrase==='hey cody'?.3:.5;
   const minimum=match.phrase==='cody'?.85:.25;
   if(value.nameConfidence<nameMinimum||value.wakeConfidence<minimum||command&&value.confidence<(match.phrase==='cody'?.6:.5))return false;
  }
  if(!command){this.armedDeadline=this.now()+20000;this.armedUntil=this.now()+8000;this.send('arm');this.status('armed','Listening for your request…');this.emit('wake');try{await this.onWake();}catch{}return true;}
  const normalized=command.toLowerCase();if(this.lastCommand===normalized&&this.now()-this.lastCommandAt<3000)return false;
  this.lastCommand=normalized;this.lastCommandAt=this.now();this.handling=true;this.armedUntil=0;this.hearingUntil=0;this.armedDeadline=0;this.send('pause');this.status('processing','Sending your request…');
  try{const result=await this.handleCommand(command);if(result?.error)this.emit('diagnostic',result.error);return !result?.error;}
  catch(error){this.emit('diagnostic',error.message);return false;}
  finally{this.handling=false;this.cooldown=this.now()+900;this.update();}
 }
 close(){this.closed=true;this.enabled=false;clearInterval(this.poll);this.stop();this.status('off','Hands-free listening is off.');}
}
module.exports={WakeListener,extractWake,phrasesFor};
