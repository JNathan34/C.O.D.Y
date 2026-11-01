'use strict';
/** No local AI. Only exact, deterministic patterns bypass cloud inference. */
const path = require('node:path');
const {parseTimerRequest}=require('./timer');
const {quickMaths}=require('./quick-maths');
const {parseWeatherRequest}=require('./weather');
const {commandText}=require('./command-text');

function routeRequest(input, requestedMode = 'chat') {
  const text = String(input || '').trim();
  if (!text) return { kind: 'invalid' };
  // Explicit Agent mode stays explicit. Clock/date queries need no cloud model.
  if (requestedMode === 'agent') return {kind:'codex',mode:'agent'};
  const command=commandText(text),query=command.toLowerCase().replace(/'/g,'').replace(/\s+/g,' ');
  const weather=parseWeatherRequest(command);if(weather)return {kind:'local',action:'weather',weather};
  const timer=parseTimerRequest(command);if(timer)return {kind:'local',action:'timer',timer};
  const maths=quickMaths(command);if(maths)return {kind:'local',action:'maths',maths};
  if(/^(?:what(?:s| is) playing(?: (?:on spotify|now))?|what song is (?:this|playing)|(?:show (?:me )?)?spotify|whats playing)$/.test(query))return {kind:'local',action:'spotify-status'};
  if (/^(?:(?:what(?:s| is) (?:the )?(?:current )?time)|what time (?:is it|it is)|(?:the )?(?:current )?time)(?: (?:now|right now))?$/.test(query))return {kind:'local',action:'time'};
  if (/^(?:what(?:s| is) (?:the )?(?:current |todays )?date|what(?:s| is) today(?:s date)?|what date is it(?: today)?|what day is (?:it|today)(?: today)?|(?:the |current |todays )?date)$/.test(query))return {kind:'local',action:'date'};
  if (requestedMode === 'chatgpt') return {kind:'chatgpt-web'};
  return {kind:'codex',mode:'chat'};
}
function isExpensive(input) {
  const s = String(input||'').toLowerCase();
  return s.length > 1600 || /\b(?:build (?:me )?(?:a |an )?(?:complete|full|entire)|create (?:an |a )?(?:entire|complete) (?:app|website|project)|analyse (?:all|every)|scan (?:the )?(?:whole|entire)|refactor (?:the )?(?:whole|entire)|deploy|migrate (?:everything|the entire)|bulk|run a full)\b/.test(s);
}
function localAnswer(action, now = new Date()) {
  const opts = action==='time' ? {hour:'numeric',minute:'2-digit',hourCycle:'h12'} : {weekday:'long',day:'numeric',month:'long',year:'numeric'};
  const result=new Intl.DateTimeFormat('en-GB',opts).format(now).replace(/\s+/g,' ').replace(/\b(am|pm)\b/g,part=>part.toUpperCase());
  return action==='time'?`It is ${result}.`:`Today is ${result}.`;
}
function localCard(action,now=new Date()){
  if(action==='time')return {kind:'time',text:localAnswer('time',now).replace(/^It is /,'').replace(/\.$/,''),detail:'Local time',icon:'clock'};
  return {kind:'date',text:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(now),detail:new Intl.DateTimeFormat('en-GB',{weekday:'long'}).format(now),icon:'calendar-days'};
}
function suggestedTitle(text){return String(text||'').replace(/\s+/g,' ').trim().slice(0,54)||'New chat';}
function validateFolder(folder){return typeof folder==='string' && path.isAbsolute(folder) && folder.length < 1024;}
module.exports = {routeRequest,isExpensive,localAnswer,localCard,suggestedTitle,validateFolder};
