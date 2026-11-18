'use strict';
// Treat backend capability lists as untrusted catalog data. A picker entry
// never grants permissions; the dispatcher still authorises actual actions.
function normalizeMentions(source,local=[]){
 const remote=Array.isArray(source)?source:Array.isArray(source?.items)?source.items:[];
 const seen=new Set(local.map(x=>x.id)),results=[...local];
 for(const item of remote.slice(0,250)){
  if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[a-z\d][\w.:/-]{0,159}$/i.test(item.id)||seen.has(item.id)||
     typeof item.name!=='string'||!item.name.trim())continue;
  const kind=['plugin','skill','tool','computer','agent'].includes(item.kind)?item.kind:'tool';
  const icon=typeof item.icon==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(item.icon)?item.icon:'plug';
  const logo=typeof item.logo==='string'&&/^https:\/\/[^\s]{1,500}$/i.test(item.logo)?item.logo:undefined;
  results.push({id:item.id,name:item.name.trim().slice(0,80),description:String(item.description||'').slice(0,240),kind,icon,...(logo?{logo}:{})});
  seen.add(item.id);
 }
 return results;
}
module.exports={normalizeMentions};
