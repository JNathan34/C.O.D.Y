'use strict';
// Untrusted model output is DATA, never script. At most one tightly typed action
// is accepted, and only when the current human request independently authorises
// that category of computer operation. Browser JS has no control API access.
const {ACTIONS}=require('./policy');

const SUPPORTED=Object.freeze({
  'app.open': {type:'launch',example:{app:'notepad'}},
  'audio.set': {type:'audio',example:{level:35}},
  'audio.mute': {type:'audio',example:{muted:true}},
  'system.status': {type:'status',example:{}},
  'window.list': {type:'windows',example:{}},
  'window.focus': {type:'windows',example:{pid:1234}},
  'keyboard.hotkey': {type:'keyboard',example:{hotkey:'ctrl+s'}},
  'keyboard.type': {type:'keyboard',example:{text:'hello'}},
  'mouse.move': {type:'mouse',example:{x:500,y:500}},
  'mouse.click': {type:'mouse',example:{button:'left'}},
  'clipboard.read': {type:'clipboard',example:{}},
  'clipboard.write': {type:'clipboard',example:{text:'example'}},
  'screen.capture': {type:'screen',example:{}},
  'files.list': {type:'files',example:{path:'.'}},
  'files.read': {type:'files',example:{path:'notes.txt'}},
  'files.write': {type:'files',example:{path:'notes.txt',text:'hello'}}
});
const DENY_EXPLANATION=/^(?:(?:how|why|what|when|where|explain|describe|teach|show me how|write (?:a |an )?(?:guide|tutorial|script|command|example)|give me (?:a |an )?(?:guide|tutorial|script|command|example))\b)/i;
function requestedComputerCategories(message){
  if(typeof message!=='string')return new Set();
  const t=message.trim().replace(/^["'“”]+|["'“”]+$/g,'');
  if(!t || t.length>25000 || DENY_EXPLANATION.test(t))return new Set();
  const commandStart=/^(?:(?:hey\s+)?c\.?o\.?d\.?y[.,:!?]*\s*)?(?:(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:please\s+)?(?:i\s+(?:want|need)\s+you\s+to\s+)|(?:please\s+)?)?/i;
  const q=t.replace(commandStart,'').trim();
  // Anchored against the *human's* own request, not the model's text. Intent
  // categories are deliberately narrow: discussion ABOUT tools isn't a command.
  const categories=new Set();
  if(/^(?:open|launch|start|bring up|run the app|start up)\s+(?!a (?:guide|script|command|tutorial)\b)/i.test(q))categories.add('launch');
  if(/^(?:(?:set|change|adjust|turn|increase|decrease|lower|raise)\s+(?:(?:my|the|system|computer)\s+)?(?:volume|sound)|(?:mute|unmute)\b|(?:volume|sound)\s+(?:to|up|down|at)\b)/i.test(q))categories.add('audio');
  if(/^(?:check|show|tell me|display|report|get)\s+(?:(?:my|the|computer|pc|system)\s+)?(?:cpu|ram|memory|system status|system stats|computer status|computer stats|pc status)\b/i.test(q))categories.add('status');
  if(/^(?:list|show|focus|switch to|activate)\s+(?:(?:my|the|open|running)\s+)?(?:windows|window|apps|application)\b/i.test(q))categories.add('windows');
  if(/^(?:type|press|send (?:the )?(?:keys|shortcut)|use (?:the )?shortcut)\b/i.test(q))categories.add('keyboard');
  if(/^(?:move (?:the )?(?:mouse|cursor)|click|right.click|left.click)\b/i.test(q))categories.add('mouse');
  if(/^(?:read|copy|write|set|replace|paste|show|clear)\s+(?:(?:my|the)\s+)?clipboard\b/i.test(q))categories.add('clipboard');
  if(/^(?:capture|take|grab|save|show me)\s+(?:a |the )?(?:screenshot|screen capture|picture of my screen)\b/i.test(q))categories.add('screen');
  if(/^(?:read|write|create|save|list|show|open|edit|update)\s+(?:(?:my|the|a)\s+)?(?:files?|folders?|directory|documents?|notes\.txt)\b/i.test(q) && !/^open\s+file explorer\b/i.test(q))categories.add('files');
  return categories;
}
function eligibleActions(humanMessage,permissions){
  if(!permissions?.enabled)return [];
  const wanted=requestedComputerCategories(humanMessage);
  return Object.entries(SUPPORTED).filter(([name,cap])=>
    wanted.has(cap.type) && !!ACTIONS[name] && !!permissions[ACTIONS[name].permission] &&
    (name!=='audio.set'||/\b(?:100|[1-9]?\d)\b/.test(humanMessage)) &&
    (name!=='audio.mute'||/\b(?:mute|unmute)\b/i.test(humanMessage))
  ).map(([name])=>name);
}
function exampleForAction(name,humanMessage){
  if(name==='app.open'){
    const aliases=['notepad','calculator','calc','paint','file explorer','explorer','edge','chrome','firefox','spotify','settings'];
    const match=aliases.find(x=>new RegExp('(?:^|[^a-z0-9])'+x.replace(' ','\\s+')+'(?:$|[^a-z0-9])','i').test(humanMessage));
    if(match)return {app:match};
  }
  if(name==='audio.set'){
    const match=String(humanMessage).match(/\b(100|[1-9]?\d)\s*%?/);
    if(match)return {level:Number(match[1])};
  }
  if(name==='audio.mute')return {muted:!/(?:^|\W)unmute(?:$|\W)/i.test(humanMessage)};
  return SUPPORTED[name].example;
}
function buildWebActionPrompt(humanMessage,permissions){
  const allowed=eligibleActions(humanMessage,permissions);
  if(!allowed.length)return {prompt:humanMessage,allowed:[]};
  // This is *ordinary user text* in the website composer, not a system prompt.
  // Backend must verify every field independent of whether the model follows it.
  const contract=`C.O.D.Y app control instructions (provided by the desktop app, not the human):
For this request ONLY, the human may be asking C.O.D.Y to control Windows. If the human actually requests one permitted computer action, briefly reply in natural language, then put exactly ONE raw plaintext line at the very end (NOT inside a Markdown code block):
CODY_ACTION_JSON: {"action":"app.open","args":{"app":"notepad"}}
Use the exact prefix CODY_ACTION_JSON: followed by a single-line JSON object with keys action and args. No code fences, Markdown, or extra text after that line.
You may choose ONLY these exact actions: ${allowed.map(name=>`${name} ${JSON.stringify(exampleForAction(name,humanMessage))}`).join('; ')}.
Never output an action for an explanation, example, quotation, or non-action request. Do not claim anything has been executed; the C.O.D.Y application verifies permission, may ask the human, and displays the actual result. Do not output shell commands or multiple actions.

HUMAN MESSAGE:
`;
  return {prompt:contract+humanMessage,allowed};
}
function matchesHumanArguments(human,action,args){
  const text=String(human||'').toLowerCase();
  if(action==='app.open'){
    if(typeof args.app!=='string')return false;
    const wanted=args.app.toLowerCase().trim();
    const aliases={calc:['calculator','calc'],calculator:['calculator','calc'],explorer:['file explorer','explorer'],
      'file explorer':['file explorer','explorer']};
    const names=aliases[wanted]||[wanted];
    // App names must be present in the human's actual message; the model cannot
    // decide to launch an unrelated permitted application.
    return names.some(name=>new RegExp('(?:^|[^a-z0-9])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])').test(text));
  }
  if(action==='audio.set'){
    // Audio level must be supplied by the human; don't invent an arbitrary volume.
    return Number.isInteger(args.level)&&new RegExp('(?:^|\\D)'+String(args.level)+'(?:\\D|$)').test(text);
  }
  if(action==='audio.mute')return typeof args.muted==='boolean' && (args.muted?!/\bunmute\b/i.test(text):/\bunmute\b/i.test(text));
  return true;
}
function parseActionReply(reply,{allowed=[],limit=2048,humanMessage=null}={}){
  if(typeof reply!=='string'||reply.length>300000)return {visible:'',action:null,error:'Invalid response'};
  // Exact block at the very end, so example snippets or quoted action plans
  // elsewhere in the answer can never trigger a Windows operation.
  // Prefer a plaintext line because ChatGPT's rendered Markdown DOM strips
  // literal backticks from fenced blocks. Fenced output is a fallback only.
  const line=/(?:^|\n)CODY_ACTION_JSON:[ \t]*(\{[^\n]*\})[ \t]*(?=\s*$)/.exec(reply);
  const fenced=/(?:^|\n)```cody-action[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?=\s*$)/.exec(reply);
  const m=line||fenced;
  if(!m){
    const hasMarker=/(?:^|\n)(?:CODY_ACTION_JSON:|```cody-action)/.test(reply);
    return {visible:stripTrailingActionDraft(reply,{enabled:allowed.length>0}),action:null,error:hasMarker?'Incomplete or malformed action marker':null};
  }
  const visible=reply.slice(0,m.index).trimEnd();
  if(!allowed.length)return {visible,action:null,error:'No computer-control action authorised by this request'};
  if(m[1].length>limit)return {visible,action:null,error:'Action payload too large'};
  let body;try{body=JSON.parse(m[1]);}catch{return {visible,action:null,error:'Invalid action JSON'};}
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['action','args'].includes(k)) ||
    !Object.hasOwn(body,'action')||!Object.hasOwn(body,'args')||typeof body.action!=='string' ||
    !body.args||typeof body.args!=='object'||Array.isArray(body.args) || !allowed.includes(body.action) || !SUPPORTED[body.action]){
    return {visible,action:null,error:'Model requested an unapproved action'};
  }
  if(humanMessage!==null && !matchesHumanArguments(humanMessage,body.action,body.args))return {visible,action:null,error:'Action arguments did not match the human request'};
  return {visible,action:{action:body.action,args:body.args},error:null};
}
function stripTrailingActionDraft(text,{enabled=true}={}){
  if(!enabled)return String(text||'');
  // Hide only an assistant's trailing cody-action stanza while it streams.
  // Do not hide ordinary code fences used in programming answers.
  return String(text||'').replace(/(?:^|\n)(?:```cody-action\b|CODY_ACTION_JSON:)[\s\S]*$/i,'').trimEnd();
}
module.exports={SUPPORTED,requestedComputerCategories,eligibleActions,exampleForAction,buildWebActionPrompt,parseActionReply,stripTrailingActionDraft,matchesHumanArguments};
