'use strict';
const {createHash}=require('node:crypto');
function digest(value){return createHash('sha256').update(value).digest('hex');}
function safeExportTime(seconds){
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>4102444800)return null;
  return new Date(seconds*1000).toISOString();
}
function chunks(text){const clean=String(text).replace(/\r\n/g,'\n').trim();const result=[];for(let i=0;i<clean.length;i+=1400)result.push(clean.slice(i,i+1400));return result;}
function parseImport(text,name){if(Buffer.byteLength(text)>20*1024*1024)throw Error('Import must be under 20 MiB. Select a smaller export part.');
 let value;try{value=JSON.parse(text);}catch{if(/\.json$/i.test(name))throw Error('Invalid JSON export');}
 let entries=[];
 if(Array.isArray(value)&&value.some(c=>c?.mapping)){
  for(const conversation of value){if(!conversation?.mapping)continue;const mapping=conversation.mapping,chain=[],seen=new Set();let id=conversation.current_node;
   while(id&&mapping[id]&&!seen.has(id)){seen.add(id);chain.push(mapping[id]);id=mapping[id].parent;}
   // Only the selected branch, never discarded alternate responses.
   for(const node of chain.reverse()){const msg=node.message,role=msg?.author?.role;if(!['user','assistant'].includes(role))continue;
    const content=(msg.content?.parts||[]).filter(p=>typeof p==='string').join('\n');
    for(const part of chunks(content))entries.push({text:part,title:conversation.title||'Imported conversation',origin:{conversationId:conversation.id||conversation.conversation_id||'',messageId:msg.id||node.id,role},kind:'conversation-history',sourceTime:safeExportTime(msg.create_time)});
   }
  }
 }else if(value?.format==='cody-memory-v1'&&Array.isArray(value.records)){
  entries=value.records.map(r=>{
   if(!r||typeof r!=='object'||typeof r.text!=='string'||!r.text.trim())
    throw Error('The C.O.D.Y. memory export contains an invalid record.');
   return {text:r.text,title:typeof r.title==='string'?r.title.slice(0,200):'C.O.D.Y. import',
     kind:typeof r.kind==='string'?r.kind:'imported-memory',
     origin:r.origin&&typeof r.origin==='object'&&!Array.isArray(r.origin)?r.origin:{},
     sourceTime:typeof r.sourceTime==='string'&&!Number.isNaN(Date.parse(r.sourceTime))?r.sourceTime:null};
  });
 }else if(value!==undefined)throw Error('Select conversations.json, a C.O.D.Y. memory export, or a text/Markdown summary.');
 else entries=chunks(text).map(part=>({text:part,title:name,kind:/^AGENTS\.md$/i.test(name)?'project-context':'imported-memory',origin:{file:name},sourceTime:null}));
 if(entries.length>15000)throw Error('Too many entries. Select a smaller export part.');
 return entries.filter(e=>e.text?.trim()).map(e=>({...e,fingerprint:digest(JSON.stringify([e.kind,e.origin,e.text]))}));
}
module.exports={parseImport,digest,safeExportTime};
