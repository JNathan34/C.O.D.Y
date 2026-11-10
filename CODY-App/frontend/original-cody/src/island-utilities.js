'use strict';
const {routeRequest,localAnswer,localCard}=require('./router');
const {parseDirectAction}=require('./control/parser');
const {commandText,repairSpeechCommand}=require('./command-text');
const {parseMediaCommand}=require('./media-commands');
const {parseAppCommand}=require('./app-commands');
const {isProofreadCommand}=require('./proofread-command');
const {parseSystemCommand}=require('./control/system-settings');
const {parseDiscordCommand}=require('./control/discord');

const APP_NAMES={calc:'Calculator',calculator:'Calculator',explorer:'File Explorer','file explorer':'File Explorer',notepad:'Notepad',paint:'Paint',edge:'Microsoft Edge',chrome:'Google Chrome',firefox:'Firefox',spotify:'Spotify',settings:'Settings',plezy:'Plezy'};
const APP_ALIASES={'google chrome':'chrome','microsoft edge':'edge','mozilla firefox':'firefox','windows explorer':'file explorer'};
const DISCORD_PROGRESS={
  mute:{on:'Muting…',off:'Unmuting…',toggle:'Toggle mute…'},
  deafen:{on:'Deafening…',off:'Undeafening…',toggle:'Toggle deafen…'}
};
const discordCard=(text,icon,tooltip)=>({kind:'utility',source:'discord',text,detail:'Discord',icon,tooltip});
function requestedApp(input){
  const query=commandText(input,{preserveShow:true});
  const match=/^(?:open|launch|start)\s+(?:(?:the|my)\s+)?(.+?)(?:\s+(?:app|application))?(?:\s+for me)?$/i.exec(query);
  if(!match)return null;
  const name=match[1].trim();
  if(name.length>70||/\b(?:and|then)\b|[;&<>\\/:]/i.test(name))return null;
  return name;
}
function appLabel(name){return APP_NAMES[name.toLowerCase()]||name;}
function matchesApp(window,name){
  const normalize=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const target=normalize(name);
  const aliases={googlechrome:'chrome',microsoftedge:'msedge',edge:'msedge',firefox:'firefox',mozillafirefox:'firefox',visualstudiocode:'code',vscode:'code',microsoftword:'winword',word:'winword',calc:'calculator',fileexplorer:'explorer'};
  const process=normalize(window.process),expected=aliases[target]||target;
  if(process===expected||process===expected+'app')return true;
  const title=normalize(window.title);
  return title===target||title===normalize(appLabel(name));
}

class IslandUtilities {
  constructor({tasks,monitors,capture,rps,weather,timer,spotify,controller,showCard,clearCard,refreshMedia,audioState,showCompact=()=>{},now=()=>new Date()}){Object.assign(this,{tasks,monitors,capture,rps,weather,timer,spotify,controller,showCard,clearCard,refreshMedia,audioState,showCompact,now});}
  match(input){
    const system=parseSystemCommand(input);if(system)return {kind:'direct',...system,text:input};
    const discord=parseDiscordCommand(input);if(discord)return {kind:'direct',...discord};
    if(/^(?:(?:show|open|view)(?: me)? (?:my |the )?(?:background )?tasks|background tasks)$/i.test(commandText(input,{preserveShow:true})))return {kind:'local',action:'background-tasks'};
    if(isProofreadCommand(input))return {kind:'direct',action:'text.proofread',args:{}};
    const appLayout=parseAppCommand(input);if(appLayout)return {kind:'direct',...appLayout,text:input};
    const monitor=this.monitors?.match(input);if(monitor)return {kind:'local',action:'island-monitors',monitor};
    const capture=this.capture?.match(input);if(capture)return {kind:'local',action:'screen-capture',command:capture};
    const game=this.rps?.parse(input);if(game)return {kind:"local",action:"rps",game};
    const media=parseMediaCommand(input);if(media)return {kind:'direct',...media,text:input};
    const text=repairSpeechCommand(input),route=routeRequest(text,'chat');
    if(route.kind==='local')return route;
    const app=requestedApp(text);
    const target=app&&(APP_ALIASES[app.toLowerCase()]||app.toLowerCase());
    const direct=target&&APP_NAMES[target]?parseDirectAction("open "+target):parseDirectAction(text);
    if(direct&&['audio.set','audio.mute','spotify.control','media.control','app.open'].includes(direct.action))return {kind:'direct',...direct,text};
    let query=commandText(text).toLowerCase().replace(/'/g,'');
    query=query.replace(/^(?:turn|put) (up|down) (?:the )?(volume|music|sound)(.*)$/,'turn the $2 $1$3')
      .replace(/^(increase|raise|decrease|lower) (?:the )?(volume|music|sound)(.*)$/,(_,verb,item,tail)=>'turn the '+item+' '+(/increase|raise/.test(verb)?'up':'down')+tail)
      .replace(/^(volume|music|sound) (up|down)(.*)$/,'turn the $1 $2$3')
      .replace(/ (?:a little|a bit)$/,'');
    if(/^(?:(?:what(?:s| is)|show|check) (?:the |my |current )?)?(?:volume|volume level)$/.test(query))return {kind:'local',action:'volume-status'};
    const relative=/^(?:turn (?:the )?(?:volume|music|sound) (up|down)|(?:make (?:the )?(?:music|sound) )?(louder|quieter))(?: (?:by )?(\d{1,2})(?: percent|%)?)?$/.exec(query);
    if(relative)return {kind:'direct',action:'audio.adjust',delta:(/up|louder/.test(relative[1]||relative[2])?1:-1)*Number(relative[3]||10),text};
    return null;
  }
  cancel(){
    const operation=this.discordOperation;
    const current=operation&&operation.generation===this.generation;
    this.generation=(this.generation||0)+1;
    operation?.abort.abort();
    if(current)this.showCard(discordCard('Cancelled','circle-help'));
  }
  volumeCard(state,generation=this.generation){if(generation!==this.generation)return "";const card={kind:'utility',text:state.muted?'Muted':state.level+'%',detail:'Volume',icon:state.muted?'volume-x':'volume-2'};this.showCard(card);return state.muted?'Sound is muted.':`Volume is ${state.level}%.`;}
  mediaCard(fallback){const media=this.spotify.snapshot();this.clearCard();this.refreshMedia();if(!media.available||!media.title)this.showCard({kind:'utility',text:fallback||'No track playing',detail:'Music',icon:'music'});return media;}
  async run(input,chatId,context={}){
    const route=this.match(input);if(!route)return {handled:false};
    const discord=route.action.startsWith('discord.');
    if(discord&&this.discordOperation)return {handled:true,error:true,reply:'A Discord command is already running. Try again when it finishes.'};
    const generation=this.generation=(this.generation||0)+1;
    const show=(card,duration)=>{if(generation===this.generation)this.showCard(card,duration);};
    try{
      let reply,confirmation;
      switch(route.action){
        case 'background-tasks':if(!this.tasks)throw Error('Background tasks are unavailable.');this.tasks.open();reply='Here are your background tasks.';confirmation='Here are your tasks.';break;
        case 'island-monitors':{const result=await this.monitors.execute(route.monitor);reply=result.reply;confirmation=result.confirmation;this.clearCard();break;}
        case 'screen-capture':{
          const result=await this.capture.execute(route.command);reply=result.reply;confirmation=result.confirmation;
          if(result.path)show({kind:'utility',text:route.command==='screenshot'?'Screenshot saved':'Recording saved',detail:'Click to open',icon:'camera',captureKind:route.command==='screenshot'?'screenshot':'recording'});
          else this.clearCard();break;
        }
        case 'rps':{const state=this.rps.act(route.game);reply=state.message;confirmation=this.rps.confirmation(state);this.clearCard();break;}
        case 'time':case 'date':reply=localAnswer(route.action,this.now());show(localCard(route.action,this.now()));break;
        case 'weather':{const result=await this.weather.current(route.weather.location);reply=result.reply;show(result.card);break;}
        case 'maths':reply=route.maths.text;show({kind:'utility',text:reply,detail:'Calculator',icon:'calculator'});break;
        case 'timer':reply=this.timer.execute(route.timer,chatId);if(['start','cancel'].includes(route.timer.action))this.clearCard();this.refreshMedia();confirmation=route.timer.action==='start'?'Timer set.':route.timer.action==='cancel'?'Timer stopped.':undefined;break;
        case 'spotify-status':{const media=this.mediaCard();reply=media.available?`${media.playing?'Playing':'Paused'}: ${media.title||'Music'}${media.artist?' — '+media.artist:''}.`:'Open a music player and start a track to show it in the Island.';break;}
        case 'volume-status':reply=this.volumeCard(await this.audioState(),generation);break;
        case 'discord.voice':case 'discord.share':case 'discord.leave':{
          const sharing=route.action==='discord.share';
          const leaving=route.action==='discord.leave';
          const {feature,state,picker}=route.args;
          const icon=sharing||leaving?'external-link':feature==='deafen'?'audio-lines':'mic';
          const progress=leaving?'Disconnecting…':sharing?(picker?'Opening…':'Starting share…'):DISCORD_PROGRESS[feature][state];
          const abort=new AbortController();
          const operation=this.discordOperation={abort,generation};
          const cancelled={handled:true,cancelled:true,reply:'Action cancelled.'};
          try{
            show(discordCard(progress,icon),35000);
            const result=await this.controller.execute(route.action,route.args,{origin:'chat',signal:abort.signal});
            if(abort.signal.aborted||result.cancelled){show(discordCard('Cancelled','circle-help'));return cancelled;}
            if(!result.ok)throw Error(result.error||'Discord did not confirm the action.');
            reply=result.result.reply;
            const {card,micMuted,micChanged}=result.result;
            show({...discordCard(card,icon,reply),micMuted,micChanged});
          }catch(error){
            if(abort.signal.aborted)return cancelled;
            throw error;
          }finally{if(this.discordOperation===operation)this.discordOperation=null;}
          break;
        }
        default:{
          let action=route.action,args=route.args;
          if(action==='text.proofread'){args=context.proofreadTarget?{target:context.proofreadTarget}:{};show({kind:'utility',text:'Checking spelling…',detail:'Keeping your wording',icon:'pencil'});}
          if(action==='audio.adjust'){const state=await this.audioState();const level=Math.max(0,Math.min(100,state.level+route.delta));if(level===state.level)return {handled:true,reply:this.volumeCard(state,generation)};action='audio.set';args={level};}
          if(action==='spotify.control'&&!/\bspotify\b/i.test(route.text)){const media=this.spotify.snapshot();if(media.available&&media.source){action='media.control';args={...args,source:media.source};}}
          if(generation!==this.generation)return {handled:true,cancelled:true,reply:"Action cancelled."};
          const result=await this.controller.execute(action,args,{origin:'chat'});
          if(result.cancelled)return {handled:true,cancelled:true,reply:'Action cancelled.'};
          if(!result.ok)throw Error(result.error||'The action did not complete.');
          if(action.startsWith('system.')){reply=result.result.message;confirmation=reply;show({kind:'utility',text:action==='system.settings.open'?'Settings opened':reply,detail:action==='system.settings.open'?'Windows':'System control',icon:'settings'});}
          else if(action.startsWith('audio.')){reply=this.volumeCard(typeof result.result?.level==='number'?result.result:await this.audioState(),generation);confirmation=route.action==='audio.adjust'?(route.delta>0?"Volume up.":"Volume down."):action==='audio.mute'?(args.muted?"Muted.":"Unmuted."):"Volume set.";}
          else if(action==='spotify.control'||action==='media.control'){this.mediaCard(({play:'Playing',pause:'Paused',next:'Next track',previous:'Previous track',toggle:'Playback changed',seek:'Seeked'})[args.command]);reply=args.command==='seek'?`Skipped ${args.seconds<0?'back':'forward'} ${Math.abs(args.seconds)} seconds.`:({play:'Playing.',pause:'Paused.',next:'Skipping to the next track.',previous:'Playing the previous track.',toggle:'Playback changed.'})[args.command];confirmation=({play:'Playing.',pause:'Paused.',next:'Next track.',previous:'Previous track.',toggle:'Done.',seek:'Done.'})[args.command];}
          else if(action==='plezy.play'){reply=`Playing ${result.result?.title||args.title} on Plezy.`;confirmation='Playing.';show({kind:'utility',text:'Playing',detail:result.result?.title||args.title,icon:'play'});this.refreshMedia();}
          else if(action==='app.split'){const names=args.apps.map(appLabel);reply=`Opened ${names[0]} on the left and ${names[1]} on the right.`;confirmation='Done.';this.showCompact();show({kind:'utility',text:'Split screen',detail:names.join(' + '),icon:'external-link'});}
          else if(action==='window.pin'){const name=appLabel(args.app);reply=result.result?.wasOpen===false?`${name} isn't open.`:args.pinned?`${name} pinned on top.`:`${name} unpinned.`;confirmation=reply;this.showCompact();show({kind:'utility',text:result.result?.wasOpen===false?'Not open':args.pinned?'Pinned on top':'Unpinned',detail:name,icon:'external-link'});}
          else if(action==='text.proofread'){reply=result.result.changed?'Spelling fixed.':'No spelling mistakes found.';confirmation=reply;this.showCompact();show({kind:'utility',text:result.result.changed?'Spelling fixed':'Spelling checked',detail:result.result.app||'',icon:'check'});}
          else{reply=`Opening ${appLabel(args.app)}.`;confirmation=reply;show({kind:'utility',text:'Opened',detail:appLabel(args.app),icon:'external-link'});}
        }
      }
      return {handled:true,reply,confirmation};
    }catch(error){const reply=error.message||'That utility is unavailable.';show(discord?discordCard('Failed','shield-alert',reply):{kind:route.action==='weather'?'weather':'utility',text:'Unavailable',detail:route.action==='weather'?'Weather':'C.O.D.Y.',icon:route.action==='weather'?'cloud-off':'circle-alert',tooltip:reply});return {handled:true,reply,error:true};}
  }
  // Spoken requests are performed by HeyClicky. Mirror the outcome without
  // replaying actions (especially Next track, volume changes or app launches).
  async observe(input){
    const query=commandText(input).toLowerCase();
    const fallback=/^(?:turn|set|increase|decrease|raise|lower|adjust|make)\b.*\b(?:volume|sound|audio|music)\b/.test(query)?{action:'volume-status'}:/^(?:play|pause|resume|stop|skip|next|previous)\b.*\b(?:music|song|track|spotify)\b/.test(query)?{action:'spotify-status'}:null;
    const target=requestedApp(input);
    const route=this.match(input)||fallback||(target?{action:"app.open",args:{app:target}}:null);if(!route)return;
    const generation=this.generation=(this.generation||0)+1;
    try{
      if(route.action==='volume-status')this.volumeCard(await this.audioState(),generation);
      else if(route.action==='spotify-status')this.mediaCard();
      else if(['time','date','weather','maths'].includes(route.action))await this.run(input);
      else if(route.action.startsWith('audio.'))this.volumeCard(await this.audioState());
      else if(['spotify.control','media.control'].includes(route.action))this.mediaCard();
      else if(route.action==='app.open'){
        const result=await this.controller.execute('app.list',{}, {origin:'chat'});
        if(generation!==this.generation)return;
        if(result.ok&&Array.isArray(result.result)&&result.result.some(window=>matchesApp(window,route.args.app)))this.showCard({kind:'utility',text:'Opened',detail:appLabel(route.args.app),icon:'external-link'});
      }
      
    }catch{}
  }
}
module.exports={IslandUtilities};
