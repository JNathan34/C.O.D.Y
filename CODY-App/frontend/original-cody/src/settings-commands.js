'use strict';

const {commandText}=require('./command-text');

const tabs=new Map(Object.entries({
  general:'general',memory:'memory',voice:'voice',audio:'voice',playback:'voice',
  microphone:'microphone',appearance:'appearance',accessibility:'accessibility',shortcuts:'shortcuts',
  keyboard:'shortcuts',cursor:'cursor',behaviour:'behaviour',behavior:'behaviour',plugins:'integrations',
  agents:'agents',permissions:'permissions',updates:'updates',developer:'developer'
}));
const viewOnly=new Map(Object.entries({'audio output':'Audio output','output device':'Audio output','microphone device':'Microphone','speech speed':'Speech speed','push to talk':'Push to talk','check for updates':'Check for updates','automatic updates':'Check automatically','local memory only':'Local memory only','agent folder':'Agent folder','allow agent usage':'Allow agent usage','enable computer control':'Enable computer control','access level':'Access level'}));
const options=values=>({values,convert:value=>values.includes(value)?value:undefined});
function percent({min,max,step=1,choices,divisor=1}){
  return {
    values:choices?choices.map(value=>`${value}%`):[`${min}% to ${max}%${step>1?` in ${step}% steps`:''}`],
    convert(value){
      const match=/^(\d{1,3})(?:\s*(?:%|percent))?$/.exec(value);
      if(!match)return;
      const number=Number(match[1]);
      if(choices?choices.includes(number):number>=min&&number<=max&&(number-min)%step===0)return number/divisor;
    }
  };
}
const entries=[];
function setting(key,label,aliases,format=options(['on','off'])){
  for(const name of [label.toLowerCase(),...aliases])entries.push([name,{key,label,...format}]);
}
setting('speechSubtitles','On-screen subtitles',['subtitles','captions']);
setting('wakeWordEnabled','Hands-free listening',['wake word','wake words','listen for cody','hands free listening']);
setting('microphoneMuted','Microphone mute',['microphone muted','mic mute']);
setting('launchAtLogin','Launch at login',['start with windows','launch on startup']);
setting('hideFloatingCursor','Hide floating cursor',['hide cursor']);
setting('screenHighlight','Screen highlight',[]);
setting('cursorTracking','Cursor tracking',['occasionally follow mouse']);
setting('reactiveExpressions','Facial reactions',[]);
setting('funReactions','Playful emotions',['playful reactions']);
setting('shakeToDetach','Shake to detach',[]);
setting('quickMessageEnabled','AltGr quick message',['quick message','send a phrase with altgr']);
setting('fontScale','Font size',['text size'],percent({choices:[90,100,115,130,150]}));
setting('guiScale','GUI size',['interface size','ui size'],percent({choices:[90,100,110,125]}));
setting('cursorSize','Cursor size',['pointer size'],percent({min:50,max:200,step:25}));
setting('voiceVolume','Voice volume',['cody voice volume','speech volume','playback volume'],percent({min:0,max:300,divisor:100}));
setting('islandSize','Island size',['compact island size'],options(['small','medium','large']));
setting('visibility','Island visibility',[],{values:['always visible','activity only','on hover'],convert:value=>new Map([['always visible','always'],['always','always'],['activity only','activity'],['on hover','hover']]).get(value)});
setting('revealStyle','Reveal style',['island reveal style'],options(['liquid','simple','none']));
setting('animationSpeed','Animation speed',['island animation speed'],{values:['slow','normal','fast','reduced motion'],convert:value=>value==='reduced motion'?'off':options(['slow','normal','fast','off']).convert(value)});
const preferences=new Map(entries);

function openSettings(destination='general',query=''){
  return {kind:'local',action:'app-settings.open',destination,query};
}
function changeSetting(name,value){
  const pref=preferences.get(name.replace(/^(?:the|my) /,''));
  if(!pref)return null;
  let converted=pref.convert(value);
  if(pref.values[0]==='on')converted=converted==='on'?true:converted==='off'?false:undefined;
  return {kind:'local',action:'app-settings.change',key:pref.key,value:converted,
    reply:converted===undefined?`For ${pref.label.toLowerCase()}, choose ${pref.values.join(', ')}.`:`${pref.label} set to ${value}.`};
}

function parseSettingsCommand(input){
  const text=commandText(input,{preserveShow:true}).toLowerCase().replace(/\bc[.\s]*o[.\s]*d[.\s]*y\.?(?:'s)?\s+/g,'').replace(/\bon screen\b/g,'on-screen');
  let match=/^(?:set|change|adjust) (.+?) to (.+)$/.exec(text);
  if(match)return changeSetting(match[1],match[2]);
  match=/^(?:turn|switch) (on|off) (.+)$/.exec(text);
  if(match)return changeSetting(match[2],match[1]);
  match=/^(?:turn|switch) (.+) (on|off)$/.exec(text);
  if(match)return changeSetting(match[1],match[2]);
  match=/^(enable|disable) (.+)$/.exec(text);
  if(match)return changeSetting(match[2],match[1]==='enable'?'on':'off');
  match=/^(mute|unmute) (?:the |my )?(?:microphone|mic)$/.exec(text);
  if(match)return changeSetting('microphone mute',match[1]==='mute'?'on':'off');
  if(/^(?:open|show|show me|view|go to|change) (?:my |the |app )?settings$/.test(text))return openSettings();
  match=/^(?:search(?: in)? settings for|find(?: the)?|(?:show(?: me)?|open) settings for) (.+)$/.exec(text);
  if(match){
    const query=match[1].replace(/ settings?$/,'');
    if(text.startsWith('find')&&!/ settings?$/.test(text)&&!preferences.has(query)&&!viewOnly.has(query))return null;
    return openSettings(tabs.get(query),tabs.has(query)?'':preferences.get(query)?.label||viewOnly.get(query)||query);
  }
  match=/^(?:show(?: me)?|open|view|go to) (?:the |my )?(.+?)( settings?)?$/.exec(text);
  if(!match)return null;
  const [,name,suffix]=match;
  if(tabs.has(name))return openSettings(tabs.get(name));
  if(preferences.has(name)||viewOnly.has(name)||suffix)return openSettings('general',preferences.get(name)?.label||viewOnly.get(name)||name);
  return null;
}

module.exports={parseSettingsCommand};
