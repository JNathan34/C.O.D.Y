'use strict';
const {taskCategories}=require('./tool-loop');
const FOLLOWUP=/^(?:yes|ye|yep|yeah|ok(?:ay)?|go ahead|proceed|do it|try again|retry|continue|carry on|resume|please do|run it)(?:[.! ]*)$/i;
function resolveTask(human,chat,{now=Date.now(),maxAgeMs=20*60*1000}={}){
 const text=String(human||'').trim();
 if(!FOLLOWUP.test(text))return {task:text,resumed:false};
 const prior=Array.isArray(chat?.messages)?chat.messages:[];
 // Only inherit an explicit previous HUMAN request. Never derive authority
 // from assistant/page/tool messages or unrelated chat history.
 const users=prior.filter(m=>m.role==='user');
 let previous;
 for(let i=users.length-1;i>=Math.max(0,users.length-5);i--){
  if(!FOLLOWUP.test(users[i].text.trim())){previous=users[i];break;}
 }
 if(!previous||!taskCategories(previous.text).length)return {task:text,resumed:false};
 const age=now-Date.parse(previous.at);
 if(!Number.isFinite(age)||age<0||age>maxAgeMs)return {task:text,resumed:false};
 return {task:previous.text,resumed:true,followUp:text};
}
module.exports={resolveTask};
