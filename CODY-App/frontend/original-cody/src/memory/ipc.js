'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {parseImport}=require('./import');
const LOCAL_FORMAT='cody-local-memory-v1';
const MAX_BACKUP_BYTES=20*1024*1024;
const BACKUP_FILTERS=[{name:'C.O.D.Y. memory backup',extensions:['json']}];

async function readLocalBackup(file){
 const handle=await fs.open(file,'r');
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size>MAX_BACKUP_BYTES)throw Error('Choose a memory backup of 20 MiB or less.');
  const chunks=[];
  for await(const chunk of handle.createReadStream({end:MAX_BACKUP_BYTES,autoClose:false}))chunks.push(chunk);
  const contents=Buffer.concat(chunks);
  if(contents.length>MAX_BACKUP_BYTES)throw Error('Choose a memory backup of 20 MiB or less.');
  let backup;
  try{backup=JSON.parse(contents.toString('utf8').replace(/^\uFEFF/,''));}
  catch{throw Error('The memory backup is not valid JSON.');}
  if(backup?.format!==LOCAL_FORMAT||!Array.isArray(backup.notes))throw Error('Choose a local memory backup exported from C.O.D.Y.');
  return backup.notes;
 }finally{await handle.close();}
}

async function writeLocalBackup(file,notes){
 const contents=JSON.stringify({format:LOCAL_FORMAT,notes},null,2)+'\n';
 if(Buffer.byteLength(contents)>MAX_BACKUP_BYTES)throw Error('The memory backup exceeds 20 MiB.');
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{
  await fs.writeFile(temporary,contents,{encoding:'utf8',flag:'wx',mode:0o600});
  await fs.rename(temporary,file);
 }finally{await fs.unlink(temporary).catch(()=>{});}
}

function registerMemoryIpc({ipcMain,dialog,window,authorise,memory,error,codex,onAccessChange=()=>{},withFileDialog=action=>action()}){
 const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{authorise(event);if(!memory)throw Error(error||'Memory is unavailable');return fn(...args);});
 let backupBusy=false;
 const backup=(name,action)=>handle(name,async()=>{
  if(backupBusy)throw Error('A memory backup is already in progress.');
  backupBusy=true;
  try{return await action();}finally{backupBusy=false;}
 });
 ipcMain.handle('memory-status',event=>{authorise(event);return {available:!!memory,reason:error||'',liveChatGPT:false,retrieval:'Offline search with concept matching (experimental).',sources:memory?memory.sources():[]};});
 handle('memory-search',(query,sourceId)=>query?memory.search(query,{sourceId}):memory.records({sourceId}).slice(-100).reverse());
 handle('memory-local-notes',query=>memory.localNotes(query));
 handle('memory-local-save',text=>memory.saveLocal(text));
 backup('memory-local-import',async()=>{
  const selected=await withFileDialog(()=>dialog.showOpenDialog(window(),{title:'Import local memories',properties:['openFile'],filters:BACKUP_FILTERS}));
  if(selected.canceled)return {cancelled:true};
  return memory.restoreLocalNotes(await readLocalBackup(selected.filePaths[0]));
 });
 backup('memory-local-export',async()=>{
  const notes=memory.exportLocalNotes();
  const selected=await withFileDialog(()=>dialog.showSaveDialog(window(),{title:'Export local memories as readable JSON',defaultPath:'cody-local-memory.json',filters:BACKUP_FILTERS}));
  if(selected.canceled)return {cancelled:true};
  await writeLocalBackup(selected.filePath,notes);
  return {exported:true,count:notes.length};
 });
 handle('memory-source',(id,patch)=>{const value=memory.configure(id,patch);onAccessChange();return value;});
 handle('memory-delete-source',id=>{const value=memory.deleteSource(id);onAccessChange();return value;});
 handle('memory-delete-record',id=>{const value=memory.deleteRecord(id);onAccessChange();return value;});
 handle('memory-update',(id,text)=>{const value=memory.update(id,text);onAccessChange();return value;});
 handle('memory-save',({text,permissions={},project=''}={})=>{let source=memory.sources().find(s=>s.kind==='local-memory'&&s.project===project&&JSON.stringify(s.permissions)===JSON.stringify({codex:permissions.codex===true,heyclicky:permissions.heyclicky===true,chatgpt:permissions.chatgpt===true}));if(!source)source=memory.addSource({label:'My C.O.D.Y. memories',kind:'local-memory',permissions,project});return memory.import(source.id,[{text,kind:'local-memory',origin:{enteredByUser:true}}]);});
 handle('memory-import',async()=>{
  const selection=await dialog.showOpenDialog(window(),{title:'Import selected memory or project context',properties:['openFile'],filters:[{name:'ChatGPT conversations.json, memory export or text summary',extensions:['json','txt','md']}]});if(selection.canceled)return {cancelled:true};
  const file=selection.filePaths[0],stat=await fs.stat(file);if(stat.size>20*1024*1024)throw Error('Select an extracted JSON export part or text file under 20 MiB.');
  const entries=parseImport(await fs.readFile(file,'utf8'),path.basename(file));const label=path.basename(file),kind=entries[0]?.kind==='project-context'?'project-context':entries[0]?.kind==='conversation-history'?'conversation-history':'imported-memory';
  const project=kind==='project-context'?path.dirname(file):'';let source=memory.sources().find(s=>s.label===label&&s.kind===kind&&s.project===project);if(!source)source=memory.addSource({label,kind,project});else {memory.configure(source.id,{permissions:{}});onAccessChange();}let totals={added:0,duplicates:0,skippedSecrets:0};
  for(let i=0;i<entries.length;i+=100){const result=memory.import(source.id,entries.slice(i,i+100));for(const key of Object.keys(totals))totals[key]+=result[key];await new Promise(resolve=>setImmediate(resolve));}
  return {...totals,sourceId:source.id,localOnly:true};
 });
 handle('memory-export',async()=>{const selected=await dialog.showSaveDialog(window(),{title:'Export decrypted C.O.D.Y. memories',defaultPath:'cody-memory.json',filters:[{name:'JSON',extensions:['json']}]});if(selected.canceled)return {cancelled:true};await fs.writeFile(selected.filePath,JSON.stringify(memory.export(),null,2),{encoding:'utf8',mode:0o600});return {exported:true};});
 handle('memory-codex-list',cursor=>codex.list(cursor));
 handle('memory-codex-import',async id=>{const result=await codex.read(id),thread=result.thread;if(!thread)throw Error('Codex session not found');const label=('Codex: '+String(thread.name||thread.preview||'Session').slice(0,100)+' ['+id+']').slice(0,200);let source=memory.sources().find(s=>s.label===label&&s.kind==='codex-history'&&s.project===(thread.cwd||''));if(!source)source=memory.addSource({label,kind:'codex-history',project:thread.cwd||''});else {memory.configure(source.id,{permissions:{}});onAccessChange();}const entries=[];
  for(const turn of thread.turns||[])for(const item of turn.items||[]){if(!['userMessage','agentMessage'].includes(item.type))continue;const text=item.text||(item.content||[]).filter(c=>c.type==='text'||c.type==='inputText').map(c=>c.text).join('\n');for(let offset=0;offset<text.length;offset+=1400)entries.push({text:text.slice(offset,offset+1400),kind:'codex-history',origin:{threadId:id,turnId:turn.id,itemId:item.id,role:item.type}});}
  if(!entries.length)throw Error('This Codex version returned no importable conversation items. The original session was not changed.');return {...memory.import(source.id,entries),sourceId:source.id,partial:result.partial===true,localOnly:true};
 });
}
module.exports={registerMemoryIpc};
