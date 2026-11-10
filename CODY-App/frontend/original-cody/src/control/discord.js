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
  const request=commandText(input,{imperativeOnly:true});
  if(/^(?:leave|disconnect(?: me)?(?: from)?|hang up(?: on| in)?) (?:(?:my|the|current) )?discord(?: (?:voice )?(?:call|channel))?$/i.test(request)||
    /^(?:leave|disconnect(?: me)?(?: from)?|hang up|end) (?:(?:my|the|current) )?(?:discord (?:voice )?call|(?:call|voice call|voice channel) (?:on|in) discord)$/i.test(request)||
    /^discord[:,]? (?:(?:leave|disconnect|hang up)(?: me)?|(?:leave|hang up|end) (?:the |my )?(?:call|voice call|voice channel))$/i.test(request))
    return {action:'discord.leave',args:{}};
  const discordStop=/^discord[:,]? (.+)$/i.exec(request)?.[1]??/^(.+?) (?:on|in) discord$/i.exec(request)?.[1];
  if(/^(?:stop|end) (?:(?:my|the) )?(?:screen[ -]?shar(?:e|ing)|sharing (?:(?:my|the) )?screen)$/i.test(discordStop??request)||
    discordStop&&/^(?:stop|end) (?:(?:my|the) )?(?:stream(?:ing)?|share|sharing)$/i.test(discordStop)||
    /^(?:stop|end) (?:(?:my|the) )?discord (?:screen[ -]?shar(?:e|ing)|stream)$/i.test(request))
    return {action:'discord.stop-share',args:{}};
  const explicitShare=prefix??/^(.+?)\s+(?:on|in|to)\s+discord$/i.exec(text)?.[1];
  const shareText=explicitShare??'';
  const screenShare=/^(?:start )?screen[ -]?shar(?:e|ing)(?:\s+(.+))?$/i.exec(shareText);
  if(screenShare&&!screenShare[1])return {action:'discord.share',args:{picker:true}};
  const share=explicitShare
    ?screenShare?.[1]??/^(?:share|stream|start sharing|start streaming)\s+(.+)$/i.exec(shareText)?.[1]
    :/^(?:share|start sharing)\s+((?:(?:my|the)\s+)?(?:entire\s+)?screen(?:\s+.+)?)$/i.exec(request)?.[1];
  if(!share)return null;
  const target=(explicitShare?share.replace(/\s+(?:app|application|window)$/i,''):share).replace(/^(?:my|the)\s+/i,'');
  const display=/^(?:entire\s+)?(?:screen|monitor|display)(?:\s+(?:number\s+)?#?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten))?$/i.exec(target);
  if(display){
    const screen=display[1]?(screenNumbers[display[1].toLowerCase()]??Number(display[1])):1;
    if(screen>=1&&screen<=32)return {action:'discord.share',args:{screen}};
  }
  if(explicitShare&&!display&&validApp(target))return {action:'discord.share',args:{app:target}};
  return null;
}

function discordVoice(feature,state){
  return {action:'discord.voice',args:{feature:feature.toLowerCase()==='mute'?'mute':'deafen',state}};
}

function validateDiscordArgs(action,args){
  if(action==='discord.leave'||action==='discord.stop-share'){
    if(Object.keys(args).length===0)return {};
    throw Error(action==='discord.leave'?'Leaving Discord does not take any arguments.':'Stopping a Discord share does not take any arguments.');
  }
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
  const clean=validateDiscordArgs(action,args);
  const json=JSON.stringify(action==='discord.leave'?{leave:true}:action==='discord.stop-share'?{stopShare:true}:clean);
  const output=await runner(`try { & ${psQuote(script)} -Request ${psQuote(json)} } catch { [Console]::Error.WriteLine($_.Exception.GetBaseException().Message); exit 1 }`,{timeout:30000,signal});
  const result=JSON.parse(output);
  if(action==='discord.leave'){
    if(result.status==='left')return {reply:'Disconnected.',card:'Disconnected'};
    if(result.status==='not-connected')return {reply:'No active call.',card:'No active call'};
    throw Error('Discord did not confirm that you left the call.');
  }
  if(action==='discord.stop-share'){
    if(result.status==='stopped')return {reply:'Screen share stopped.',card:'Share stopped'};
    if(result.status==='not-sharing')return {reply:'You’re not sharing on Discord.',card:'No active share'};
    throw Error('Discord did not confirm that the screen share stopped.');
  }
  if(action==='discord.voice'){
    if(typeof result.enabled!=='boolean'||args.state!=='toggle'&&result.enabled!==(args.state==='on'))throw Error('Discord did not confirm the requested voice state.');
    const card=args.feature==='mute'?(result.enabled?'Muted':'Unmuted'):(result.enabled?'Deafened':'Undeafened');
    return {reply:card+'.',card,...(args.feature==='mute'?{micMuted:result.enabled,micChanged:result.changed===true}:{})};
  }
  if(args.picker===true){
    if(result.status==='picker')return {reply:'Pick a source in Discord.',card:'Pick source'};
    throw Error('Discord did not confirm that the share picker opened.');
  }
  const target=args.screen?'screen '+args.screen:args.app;
  if(result.status==='started')return {reply:`Sharing ${target}.`,card:'Sharing'};
  if(result.status==='selected')return {reply:'Check the preview, then choose Go Live.',card:'Check Discord'};
  if(result.status==='review')return {reply:`Select ${target} in Discord.`,card:'Check Discord'};
  if(result.status==='requested')return {reply:'Check if the stream started.',card:'Check Discord'};
  throw Error('Discord did not confirm a screen share action.');
}

module.exports={parseDiscordCommand,validateDiscordArgs,runDiscordCommand};
