'use strict';
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const MAX_SECONDS=24*60*60;

function durationSeconds(input){
  if(/(^|[\s,])-\s*\d/.test(input))return null;
  let text=input.toLowerCase().replace(/-/g,' ').replace(/\ban? (hour|minute|second) and a half\b/g,'1.5 $1').replace(/\bhalf (?:an? )?(hour|minute|second)\b/g,'0.5 $1').replace(/\ba quarter (?:of an? )?hour\b/g,'15 minutes');
  const ones={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
  const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
  text=text.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?: (one|two|three|four|five|six|seven|eight|nine))?\b/g,(_,t,o)=>String(tens[t]+(ones[o]||0)));
  text=text.replace(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g,w=>String(ones[w]));
  text=text.replace(/\b(\d+) and 1 half\b/g,(_,n)=>String(Number(n)+.5));
  let total=0,count=0;
  const rest=text.replace(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g,(_,n,unit)=>{count++;total+=Number(n)*(unit.startsWith('h')?3600:unit.startsWith('m')?60:1);return '';}).replace(/\band\b/g,'').replace(/[\s,]/g,'');
  return !rest&&count&&Number.isInteger(total)&&total>0&&total<=MAX_SECONDS?total:null;
}
function parseTimerRequest(input){
  const text=String(input||'').toLowerCase().trim().replace(/[’']/g,'').replace(/^(?:hey\s+)?c\.?o\.?d\.?y[,.!?:]*\s*/,'').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/,'').replace(/[.!?]+$/,'').replace(/\s+please$/,'').trim();
  if(/^(?:cancel|stop|clear|dismiss|delete) (?:my |the |a )?(?:timer|alarm)$/.test(text))return {action:'cancel'};
  if(/^(?:(?:how much|what) time is left(?: on (?:my |the )?timer)?|(?:show|check) (?:my |the )?timer|timer status)$/.test(text))return {action:'status'};
  const match=/^(?:set|start) (?:me )?(?:(?:a|the) )?timer(?: for)?(?: (.+))?$/.exec(text)||/^(?:set|start) (?:me )?(?:a )?(.+?) timer$/.exec(text);
  if(!match)return null;
  const seconds=durationSeconds(match[1]||'');
  return seconds?{action:'start',seconds}:{action:'invalid'};
}
function durationLabel(seconds){
  return [[3600,'hour'],[60,'minute'],[1,'second']].map(([unit,label])=>{const n=Math.floor(seconds/unit);seconds%=unit;return n?`${n} ${label}${n===1?'':'s'}`:'';}).filter(Boolean).join(' ');
}
class DesktopTimer extends EventEmitter{
  constructor({file,now=Date.now,schedule=setTimeout,unschedule=clearTimeout}={}){super();this.file=file;this.now=now;this.schedule=schedule;this.unschedule=unschedule;this.value=null;this.handle=null;}
  snapshot(){return this.value?{...this.value}:null;}
  persist(){if(this.file){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.value),'utf8');fs.renameSync(this.file+'.tmp',this.file);}}
  restore(){
    if(this.file&&fs.existsSync(this.file)){
      const value=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(value&&['running','finished'].includes(value.status)&&Number.isFinite(value.deadline)&&Number.isInteger(value.seconds)&&value.seconds>0&&value.seconds<=MAX_SECONDS)this.value=value;
    }
    this.arm();return this.snapshot();
  }
  arm(){this.unschedule(this.handle);this.handle=null;if(this.value?.status==='running'){this.handle=this.schedule(()=>{if(this.now()<this.value.deadline){this.arm();return;}this.value.status='finished';this.handle=null;try{this.persist();}catch(error){this.emit('error',error);}this.emit('change',this.snapshot());this.emit('finished',this.snapshot());},Math.max(0,Math.min(MAX_SECONDS*1000,this.value.deadline-this.now())));this.handle?.unref?.();}}
  execute(request,chatId){
    if(request.action==='invalid')return 'Tell me a duration between 1 second and 24 hours, for example: set a timer for five minutes.';
    if(request.action==='status')return !this.value?'There is no timer running.':this.value.status==='finished'?'Your timer has finished.':`${durationLabel(Math.max(1,Math.ceil((this.value.deadline-this.now())/1000)))} left on your timer.`;
    if(request.action==='cancel'){
      if(!this.value)return 'There is no timer to cancel.';
      this.unschedule(this.handle);this.handle=null;this.value=null;this.persist();this.emit('change',null);return 'Timer cleared.';
    }
    if(request.action!=='start'||!Number.isInteger(request.seconds)||request.seconds<=0||request.seconds>MAX_SECONDS)throw Error('Invalid timer duration');
    const replacing=this.value?.status==='running';
    this.value={status:'running',seconds:request.seconds,deadline:this.now()+request.seconds*1000,chatId};
    this.persist();this.arm();this.emit('change',this.snapshot());
    return `${replacing?'Replaced your previous timer. ':''}Timer set for ${durationLabel(request.seconds)}.`;
  }
  close(){this.unschedule(this.handle);this.handle=null;}
}
module.exports={DesktopTimer,parseTimerRequest,durationSeconds,durationLabel};
