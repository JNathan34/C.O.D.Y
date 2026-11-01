'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Attachments}=require('../src/attachments');
function fixture(){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-attachments-')),chats=[{id:'one'},{id:'two'}];let saved;
  const store={chat:id=>chats.find(chat=>chat.id===id),save:()=>{saved=JSON.stringify(chats);}},changes=[];
  const manager=new Attachments({store,thumbnail:async()=>null,onChange:state=>changes.push(state)});
  const file=(name='notes.txt')=>{const file=path.join(folder,name);fs.writeFileSync(file,'User content stays in the source file.');return file;};
  return {folder,chats,manager,changes,store,file,saved:()=>saved,close(){for(const name of fs.readdirSync(folder)){const target=path.join(folder,name);if(fs.statSync(target).isDirectory())fs.rmdirSync(target);else fs.unlinkSync(target);}fs.rmdirSync(folder);}};
}
test('drop stages deduplicated paths and metadata without copying content or submitting anything',async()=>{
  const f=fixture();try{const file=f.file(),state=await f.manager.add('one',[file,file]);assert.equal(state.items.length,1);assert.equal(state.items[0].name,'notes.txt');assert.equal(f.chats[1].attachments,undefined);assert.doesNotMatch(f.saved(),/User content stays/);assert.deepEqual(await f.manager.paths('one'),[fs.realpathSync.native(file)]);}finally{f.close();}
});
test('folders and non-file paths fail clearly, and a later valid drop still works',async()=>{
  const f=fixture();try{fs.mkdirSync(path.join(f.folder,'directory'));await assert.rejects(f.manager.add('one',[path.join(f.folder,'directory')]),/individual files/);await assert.rejects(f.manager.add('one',['https://example.com/file']),/your computer/);assert.equal((await f.manager.add('one',[f.file()])).items.length,1);}finally{f.close();}
});
test('ten-file native cap preserves accepted files and explains the rest',async()=>{
  const f=fixture();try{const files=Array.from({length:12},(_,i)=>f.file(i+'.txt'));const state=await f.manager.add('one',files);assert.equal(state.items.length,10);assert.match(state.notice,/10 files/);}finally{f.close();}
});
test('removal is serial with a concurrent add and cannot reappear in later snapshots',async()=>{
  const f=fixture();try{const first=await f.manager.add('one',[f.file()]);const add=f.manager.add('one',[f.file('two.txt')]),remove=f.manager.remove('one',first.items[0].id);await Promise.all([add,remove]);assert.deepEqual((await f.manager.snapshot('one')).items.map(file=>file.name),['two.txt']);}finally{f.close();}
});
test('missing files remain removable and never silently reach a question',async()=>{
  const f=fixture();try{const file=f.file(),state=await f.manager.add('one',[file]);fs.unlinkSync(file);assert.equal((await f.manager.snapshot('one')).items[0].missing,true);await assert.rejects(f.manager.paths('one'),/no longer available/);await f.manager.remove('one',state.items[0].id);assert.deepEqual(await f.manager.paths('one'),[]);}finally{f.close();}
});
