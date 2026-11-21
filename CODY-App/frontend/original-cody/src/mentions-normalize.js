'use strict';
const {cloudWordPresentation}=require('./plugin-catalog');
const isMentionable=item=>item?.kind==='plugin'||item?.kind==='skill'||
 (item?.id==='tool:computer-use'&&['tool','computer'].includes(item.kind));
// Treat backend capability lists as untrusted catalog data. A picker entry
// never grants permissions; the dispatcher still authorises actual actions.
function normalizeMentions(source,local=[]){
 const remote=Array.isArray(source)?source:Array.isArray(source?.items)?source.items:[];
 const seen=new Set(local.map(x=>x.id)),results=local.filter(isMentionable);
 for(const raw of remote.slice(0,250)){
  const item=cloudWordPresentation(raw);
  if(!isMentionable(item)||typeof item.id!=='string'||!/^[a-z\d][\w.:/-]{0,159}$/i.test(item.id)||seen.has(item.id)||
     typeof item.name!=='string'||!item.name.trim())continue;
  const kind=item.id==='tool:computer-use'?'plugin':item.kind;
  const defaultIcon=item.id==='tool:computer-use'?'mouse-pointer-2':kind==='skill'?'file-text':'plug';
  const icon=typeof item.icon==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(item.icon)?item.icon:defaultIcon;
  const logo=typeof item.logo==='string'&&/^https:\/\/[^\s]{1,500}$/i.test(item.logo)?item.logo:undefined;
  results.push({id:item.id,name:item.name.trim().slice(0,80),description:String(item.description||'').slice(0,240),kind,icon,...(logo?{logo}:{})});
  seen.add(item.id);
 }
 return results;
}
module.exports={normalizeMentions};
