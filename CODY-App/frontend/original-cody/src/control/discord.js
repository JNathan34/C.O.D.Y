'use strict';
const path=require('node:path');
const {commandText}=require('../command-text');
const {psQuote,runPowerShell}=require('./windows');

const validApp=name=>typeof name==='string'&&name.length<=80&&/^[\p{L}\p{N}][\p{L}\p{N} .+'()_-]*$/u.test(name)&&!/\b(?:and then|then|or)\b/i.test(name);
const screenNumbers={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};

function parseDiscordCommand(input){
  const text=commandText(input);
  const voice=/^(?:(toggle)\s+)?(un\s*)?(mute|deafen|defen|deaf)(?:\s+(?:me|myself|my mic|my microphone))?\s+(?:(?:on|in)\s+)?discord$/i.exec(text);
  if(voice&&!(voice[1]&&voice[2]))return {action:'discord.voice',args:{
    feature:voice[3].toLowerCase()==='mute'?'mute':'deafen',
    state:voice[1]?'toggle':voice[2]?'off':'on'
  }};
  const share=/^(?:share|stream)\s+(?:my\s+|the\s+)?(.+?)\s+(?:on|in|to)\s+discord$/i.exec(text);
  if(!share)return null;
  const target=share[1].replace(/\s+(?:app|application|window)$/i,'');
  const display=/^(?:entire\s+)?(?:screen|monitor|display)(?:\s+(?:number\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten))?$/i.exec(target);
  if(display){
    const screen=display[1]?(screenNumbers[display[1].toLowerCase()]??Number(display[1])):1;
    if(screen>=1&&screen<=32)return {action:'discord.share',args:{screen}};
  }
  if(!display&&validApp(target))return {action:'discord.share',args:{app:target}};
  return null;
}

function validateDiscordArgs(action,args){
  if(action==='discord.voice'){
    if(Object.keys(args).length===2&&['mute','deafen'].includes(args.feature)&&['on','off','toggle'].includes(args.state))return {feature:args.feature,state:args.state};
    throw Error('Choose a Discord mute or deafen action.');
  }
  if(Object.keys(args).length===1&&Number.isInteger(args.screen)&&args.screen>=1&&args.screen<=32)return {screen:args.screen};
  if(Object.keys(args).length===1&&validApp(args.app))return {app:args.app};
  throw Error('Choose a screen number or an open app to share on Discord.');
}

async function runDiscordCommand(action,args,{runner=runPowerShell,signal}={}){
  const script=path.join(__dirname,'../../windows/discord-control.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  const json=JSON.stringify(validateDiscordArgs(action,args));
  const output=await runner(`try { & ${psQuote(script)} -Request ${psQuote(json)} } catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }`,{timeout:22000,signal});
  const result=JSON.parse(output);
  if(action==='discord.voice'){
    if(typeof result.enabled!=='boolean'||args.state!=='toggle'&&result.enabled!==(args.state==='on'))throw Error('Discord did not confirm the requested voice state.');
    const label=args.feature==='mute'?(result.enabled?'muted':'unmuted'):(result.enabled?'deafened':'undeafened');
    return {reply:args.feature==='mute'?'Your Discord microphone is '+label+'.':'You are '+label+' on Discord.',card:label[0].toUpperCase()+label.slice(1)};
  }
  const target=args.screen?'screen '+args.screen:args.app;
  if(result.status==='started')return {reply:`Discord is sharing ${target}.`,card:'Sharing on Discord'};
  if(result.status==='selected')return {reply:`I selected ${target} in Discord. Check the preview and choose Go Live to start sharing.`,card:'Check Discord'};
  if(result.status==='review')return {reply:`Select ${target} in Discord and verify the preview before choosing Go Live.`,card:'Check Discord'};
  if(result.status==='requested')return {reply:`I sent Go Live for ${target}. Check Discord to confirm the stream started.`,card:'Check Discord'};
  throw Error('Discord did not confirm a screen share action.');
}

module.exports={parseDiscordCommand,validateDiscordArgs,runDiscordCommand};
