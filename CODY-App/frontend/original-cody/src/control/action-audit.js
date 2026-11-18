'use strict';
const fs=require('node:fs'),path=require('node:path');
const MAX_FILE_BYTES=1024*1024,MAX_RESULTS=80;
const safeAction=value=>typeof value==='string'&&/^[a-z][a-z0-9.-]{0,79}$/i.test(value)?value:'unknown';
const safeStatus=value=>['started','completed','failed','denied','cancelled'].includes(value)?value:'unknown';
const safeOrigin=value=>['chat','ai-chat','native','local','voice','user'].includes(value)?value:'other';
function safeEntry(event={}){
 // Never persist tool arguments, typed text, destinations, browser URLs,
 // raw error messages, clipboard data, screen contents or API credentials.
 return {at:new Date().toISOString(),action:safeAction(event.action),status:safeStatus(event.status),origin:safeOrigin(event.origin)};
}
class ActionAudit{
 constructor(file){this.file=file;}
 append(event){
  const entry=safeEntry(event);
  try{
   fs.mkdirSync(path.dirname(this.file),{recursive:true});
   if(fs.existsSync(this.file)&&fs.statSync(this.file).size>MAX_FILE_BYTES){
    const records=this.recent().slice(-MAX_RESULTS);
    fs.writeFileSync(this.file,records.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
   }
   fs.appendFileSync(this.file,JSON.stringify(entry)+'\n',{encoding:'utf8',mode:0o600});
  }catch{}
  return entry;
 }
 recent(){
  try{
   const stat=fs.statSync(this.file);
   // Read the last 256 KiB only, even if a legacy log grew excessively.
   const fd=fs.openSync(this.file,'r');
   let data;
   try{
    const count=Math.min(stat.size,256*1024),buf=Buffer.alloc(count);
    fs.readSync(fd,buf,0,count,stat.size-count);
    data=buf.toString('utf8');
   }finally{fs.closeSync(fd);}
   return data.split('\n').slice(stat.size>256*1024?1:0).filter(Boolean).slice(-MAX_RESULTS).flatMap(line=>{
    try{
     const record=JSON.parse(line),entry=safeEntry(record);
     if(typeof record.at==='string'&&!Number.isNaN(Date.parse(record.at)))entry.at=record.at;
     return [entry];
    }catch{return [];}
   });
  }catch{return [];}
 }
}
module.exports={ActionAudit,safeEntry};
