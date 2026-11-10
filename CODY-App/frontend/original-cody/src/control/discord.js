'use strict';
const path=require('node:path');
const {commandText}=require('../command-text');
const {psQuote,runPowerShell}=require('./windows');

const validApp=name=>typeof name==='string'&&name.length<=80&&/^[\p{L}\p{N}][\p{L}\p{N} .+'()_-]*$/u.test(name)&&!/\b(?:and then|then|or)\b/i.test(name);
const screenNumbers={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};

function parseDiscordCommand(input){
  const text=commandText(input);
  const prefix=/^discord[:,]?\s+(.+)$/i.exec(text)?.[1];
  const voiceText=prefix??
    /^(.+?)\s+(?:(?:on|in)\s+)?discord$/i.exec(text)?.[1]??
    /^((?:toggle\s+)?(?:un[ -]*)?mute)\s+(?:my\s+)?discord(?:'s)?\s+(?:mic|microphone)$/i.exec(text)?.[1]??'';
  const voice=/^(?:(toggle)\s+)?(un[ -]*)?(mute|deafen|defen|deaf)(?:\s+(?:me|myself|my mic|my microphone))?$/i.exec(voiceText);
  if(voice&&!(voice[1]&&voice[2]))return discordVoice(voice[3],voice[1]?'toggle':voice[2]?'off':'on');
  const switchVoice=/^(?:turn|switch)\s+(?:(on|off)\s+(mute|deafen|defen|deaf)|(mute|deafen|defen|deaf)\s+(on|off))$/i.exec(voiceText);
  if(switchVoice)return discordVoice(switchVoice[2]||switchVoice[3],(switchVoice[1]||switchVoice[4]).toLowerCase());
  const shareText=prefix??/^(.+?)\s+(?:on|in|to)\s+discord$/i.exec(text)?.[1]??'';
  const screenShare=/^(?:start )?screen[ -]?shar(?:e|ing)(?:\s+(.+))?$/i.exec(shareText);
  if(screenShare&&!screenShare[1])return {action:'discord.share',args:{picker:true}};
  const share=screenShare?.[1]??/^(?:share|stream|start sharing|start streaming)\s+(.+)$/i.exec(shareText)?.[1];
  if(!share)return null;
  const target=share.replace(/^(?:my|the)\s+/i,'').replace(/\s+(?:app|application|window)$/i,'');
  const display=/^(?:entire\s+)?(?:screen|monitor|display)(?:\s+(?:number\s+)?#?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten))?$/i.exec(target);
  if(display){
    const screen=display[1]?(screenNumbers[display[1].toLowerCase()]??Number(display[1])):1;
    if(screen>=1&&screen<=32)return {action:'discord.share',args:{screen}};
  }
  if(!display&&validApp(target))return {action:'discord.share',args:{app:target}};
  return null;
}

function discordVoice(feature,state){
  return {action:'discord.voice',args:{feature:feature.toLowerCase()==='mute'?'mute':'deafen',state}};
}

function validateDiscordArgs(action,args){
  if(action==='discord.voice'){
    if(Object.keys(args).length===2&&['mute','deafen'].includes(args.feature)&&['on','off','toggle'].includes(args.state))return {feature:args.feature,state:args.state};
    throw Error('Choose a Discord mute or deafen action.');
  }
  if(Object.keys(args).length===1&&args.picker===true)return {picker:true};
  if(Object.keys(args).length===1&&Number.isInteger(args.screen)&&args.screen>=1&&args.screen<=32)return {screen:args.screen};
  if(Object.keys(args).length===1&&validApp(args.app))return {app:args.app};
  throw Error('Choose a screen number or an open app to share on Discord.');
}

async function runDiscordCommand(action,args,{runner=runPowerShell,signal}={}){
  const script=path.join(__dirname,'../../windows/discord-control.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  const json=JSON.stringify(validateDiscordArgs(action,args));
  const output=await runner(`try { & ${psQuote(script)} -Request ${psQuote(json)} } catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }`,{timeout:30000,signal});
  const result=JSON.parse(output);
  if(action==='discord.voice'){
    if(typeof result.enabled!=='boolean'||args.state!=='toggle'&&result.enabled!==(args.state==='on'))throw Error('Discord did not confirm the requested voice state.');
    const label=args.feature==='mute'?(result.enabled?'muted':'unmuted'):(result.enabled?'deafened':'undeafened');
    return {reply:args.feature==='mute'?'Your Discord microphone is '+label+'.':'You are '+label+' on Discord.',card:label[0].toUpperCase()+label.slice(1)};
  }
  if(args.picker===true){
    if(result.status==='picker')return {reply:'Choose a screen or app in the Discord share picker.',card:'Pick source'};
    throw Error('Discord did not confirm that the share picker opened.');
  }
  const target=args.screen?'screen '+args.screen:args.app;
  if(result.status==='started')return {reply:`Discord is sharing ${target}.`,card:'Sharing'};
  if(result.status==='selected')return {reply:`I selected ${target} in Discord. Check the preview and choose Go Live to start sharing.`,card:'Check Discord'};
  if(result.status==='review')return {reply:`Select ${target} in Discord and verify the preview before choosing Go Live.`,card:'Check Discord'};
  if(result.status==='requested')return {reply:`I sent Go Live for ${target}. Check Discord to confirm the stream started.`,card:'Check Discord'};
  throw Error('Discord did not confirm a screen share action.');
}

module.exports={parseDiscordCommand,validateDiscordArgs,runDiscordCommand};
