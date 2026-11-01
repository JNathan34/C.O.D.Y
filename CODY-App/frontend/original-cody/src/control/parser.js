'use strict';
/** Extremely narrow direct commands. Never parse chat-model output as tool calls. */
const {commandText}=require('../command-text');
function parseDirectAction(input){
  const t=commandText(input);let m;
  const media=t.toLowerCase().replace(/[’']/g,'').replace(/^(?:hey )?cody[, ]+/,'').replace(/^(?:(?:can|could) you )?(?:please )?/,'').replace(/[.!?]+$/,'').trim();
  if(/^(?:play|resume) (?:my )?music$/.test(media))return {action:'spotify.control',args:{command:'play'}};
  if(/^(?:pause|stop) (?:my )?music$/.test(media))return {action:'spotify.control',args:{command:'pause'}};
  if(/^(?:skip|next) (?:song|track)$/.test(media))return {action:'spotify.control',args:{command:'next'}};
  if(/^previous (?:song|track)$/.test(media))return {action:'spotify.control',args:{command:'previous'}};
  if(/^(?:play|resume)(?: (?:my )?music)?(?: on)? spotify$|^spotify (?:play|resume)$/.test(media))return {action:'spotify.control',args:{command:'play'}};
  if(/^(?:pause|stop)(?: (?:my )?music)?(?: on)? spotify$|^spotify (?:pause|stop)$/.test(media))return {action:'spotify.control',args:{command:'pause'}};
  if(/^(?:skip|next)(?: (?:the )?(?:song|track))?(?: on)? spotify$|^spotify (?:skip|next)$/.test(media))return {action:'spotify.control',args:{command:'next'}};
  if(/^(?:previous|last)(?: (?:song|track))?(?: on)? spotify$|^spotify previous$/.test(media))return {action:'spotify.control',args:{command:'previous'}};
  if((m=/^(?:please\s+)?(?:open|launch|start)\s+(notepad|calculator|calc|paint|file explorer|explorer|edge|chrome|firefox|spotify|settings)(?:\s+please)?[.!]?$/i.exec(t)))return {action:'app.open',args:{app:m[1].toLowerCase()}};
  if((m=/^(?:please\s+)?(?:set\s+)?(?:the\s+)?(?:computer\s+|system\s+)?volume\s+(?:to\s+)?(100|[1-9]?\d)\s*(?:%|percent)?(?:\s+please)?[.!]?$/i.exec(t)))return {action:'audio.set',args:{level:Number(m[1])}};
  if((m=/^(?:please\s+)?(?:set\s+)?(?:the\s+)?volume\s+to\s+(100|[1-9]?\d)\s*%?(?:\s+please)?[.!]?$/i.exec(t)))return {action:'audio.set',args:{level:Number(m[1])}};
  if(/^(?:please\s+)?(?:mute|silence)(?:\s+(?:the\s+)?(?:sound|audio|volume))?(?:\s+please)?[.!]?$/i.test(t))return {action:'audio.mute',args:{muted:true}};
  if(/^(?:please\s+)?unmute(?:\s+(?:the\s+)?(?:sound|audio|volume))?(?:\s+please)?[.!]?$/i.test(t))return {action:'audio.mute',args:{muted:false}};
  if(/^(?:please\s+)?(?:show|check|tell me)\s+(?:my\s+)?(?:computer|pc|system)\s+(?:status|stats|usage)(?:\s+please)?[.!]?$/i.test(t))return {action:'system.status',args:{}};
  return null;
}
module.exports={parseDirectAction};
