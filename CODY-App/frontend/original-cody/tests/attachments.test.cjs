'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Attachments}=require('../src/attachments');
function fixture({encodeImage,thumbnail=async()=>null,largeThumbnail,excerpt}={}){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-attachments-')),chats=[{id:'one'},{id:'two'}];let saved;
  const store={directory:folder,data:{chats},chat:id=>chats.find(chat=>chat.id===id),save:()=>{saved=JSON.stringify(chats);}},changes=[];
  const manager=new Attachments({store,encodeImage,thumbnail,largeThumbnail,excerpt,onChange:state=>changes.push(state)});
  const file=(name='notes.txt')=>{const file=path.join(folder,name);fs.writeFileSync(file,'User content stays in the source file.');return file;};
  return {folder,chats,manager,changes,store,file,saved:()=>saved,close(){for(const name of fs.readdirSync(folder)){const target=path.join(folder,name);if(fs.statSync(target).isDirectory())fs.rmdirSync(target);else fs.unlinkSync(target);}fs.rmdirSync(folder);}};
}
test('sent previews use the message attachment and can load older history records',async()=>{
  const requested=[];
  const f=fixture({largeThumbnail:async file=>{requested.push(file);return 'image';},excerpt:async file=>{requested.push(file);return 'Slide outline';}});
  try{
    const image=f.file('photo.png'),slides=f.file('outline.pptx');
    f.chats[0].messages=[{id:'old',attachments:[{path:image,name:'photo.png'},{path:slides,name:'outline.pptx'}]}];
    assert.equal((await f.manager.messagePreview('one','old',0)).image,'image');
    assert.equal((await f.manager.messagePreview('one','old',1)).text,'Slide outline');
    assert.equal((await f.manager.messagePreview('one','old',1)).text,'Slide outline');
    assert.deepEqual(requested,[fs.realpathSync.native(image),fs.realpathSync.native(slides)]);
    await assert.rejects(f.manager.messagePreview('two','old',1),/unavailable/);
    await assert.rejects(f.manager.messagePreview('one','old',image),/unavailable/);
    fs.unlinkSync(slides);
    assert.deepEqual(await f.manager.messagePreview('one','old',1),{missing:true});
  }finally{f.close();}
});
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

test('clearing a sent batch preserves later drops, reattachments and other chats',async()=>{
  const f=fixture();try{
    const file=f.file(),first=await f.manager.add('one',[file]),batch=await f.manager.prepare('one');
    await f.manager.remove('one',first.items[0].id);await f.manager.add('one',[file,f.file('later.txt')]);await f.manager.add('two',[file]);
    await f.manager.clearSent('one',batch.ids);
    assert.deepEqual((await f.manager.snapshot('one')).items.map(file=>file.name),['notes.txt','later.txt']);assert.equal((await f.manager.snapshot('two')).items.length,1);assert.equal(fs.existsSync(file),true);
  }finally{f.close();}
});

function sendingFixture(){
  const f=fixture(),{EventEmitter}=require('node:events'),{installNativeIpc}=require('../src/native-ipc'),handlers=new Map(),wc={mainFrame:{}},events=[],calls=[],external=[];
  let sequence=0,resolveReply;
  for(const chat of f.chats)chat.messages=[];
  Object.assign(f.store,{data:{chats:f.chats,activeChatId:'one',settings:{assistantProvider:'heyclicky'}},publicState(){return this.data;},addMessage(id,role,text){const message={id:String(++sequence),role,text};this.chat(id).messages.push(message);return message;},updateMessage(id,key,text){this.chat(id).messages.find(message=>message.id===key).text=text;}});
  const engine=new EventEmitter();engine.status={state:'Idle'};engine.refresh=async()=>({signedIn:true});engine.request=(command,args)=>{calls.push({command,args});if(command==='submit')return new Promise(resolve=>resolveReply=resolve);return Promise.resolve(command==='end'?{utilityText:'Read the file'}:{});};
  const bindings=installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store:f.store,attachments:f.manager,sendUI:(...value)=>events.push(value),getWindow:()=>({webContents:wc}),utilities:{match:()=>null,cancel(){},observe(){}},submitExternal:async request=>{external.push(request);return {started:true};}});
  return {...f,engine,calls,events,bindings,external,finish:()=>resolveReply({text:'Read the file.'}),send:(text='Read the file')=>handlers.get('send-message')({sender:wc,senderFrame:wc.mainFrame},{chatId:'one',text})};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('an accepted message clears composer attachments immediately and retains sent history',async()=>{
  const f=sendingFixture();try{
    const file=f.file();await f.manager.add('one',[file]);assert.equal((await f.send()).started,true);
    assert.deepEqual(await f.manager.paths('one'),[]);assert.deepEqual(f.chats[0].messages[0].attachments.map(file=>file.name),['notes.txt']);assert.deepEqual(f.calls.find(call=>call.command==='submit').args.files,[fs.realpathSync.native(file)]);assert.deepEqual(f.changes.at(-1).items,[]);
    f.finish();await tick();await f.send();assert.equal(f.calls.filter(call=>call.command==='submit')[1].args.files,undefined);f.finish();await tick();assert.equal(fs.existsSync(file),true);
  }finally{f.close();}
});
test('rejected sends keep staged files for retry',async()=>{
  for(const reason of ['signed-out','missing']){
    const f=sendingFixture();try{
      const file=f.file();await f.manager.add('one',[file]);
      if(reason==='signed-out')f.engine.refresh=async()=>({signedIn:false});
      if(reason==='missing')fs.unlinkSync(file);
      assert.ok((await f.send()).error);assert.equal((await f.manager.snapshot('one')).items.length,1);assert.equal(f.calls.some(call=>call.command==='submit'),false);
    }finally{f.close();}
  }
});
test('a file-only message uses the selected chat provider and includes the staged batch',async()=>{
  for(const provider of ['codex','chatgpt']){
    const f=sendingFixture();try{
      f.store.data.settings.assistantProvider=provider;
      const file=f.file('presentation.pptx');await f.manager.add('one',[file]);
      assert.equal((await f.send('')).started,true);
      assert.equal(f.external[0].mode,provider);
      assert.match(f.external[0].text,/review the attached files/i);
      assert.deepEqual(f.external[0].attachmentBatch.paths,[fs.realpathSync.native(file)]);
      assert.equal(f.calls.some(call=>call.command==='submit'),false);
    }finally{f.close();}
  }
});

test('a pasted image stays in the intended chat and is kept only while referenced',async()=>{
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const f=fixture({encodeImage:bytes=>bytes.equals(png)?png:null,thumbnail:async()=>`data:image/png;base64,${png.toString('base64')}`});
  try{
    await assert.rejects(f.manager.addImage('two',new Uint8Array([0])),/could not read/);
    const {items:[item]}=await f.manager.addImage('two',png);
    assert.equal(item.name,'Pasted image.png');
    assert.match(item.preview,/^data:image\/png;base64,/);
    assert.equal((await f.manager.snapshot('one')).items.length,0);
    const sent=await f.manager.prepare('two');
    f.chats[1].messages=[{attachments:sent.items}];
    await f.manager.clearSent('two',sent.ids);
    await f.manager.prunePastes();
    assert.deepEqual(fs.readFileSync(item.path),png);
    f.chats[1].messages=[];
    await f.manager.prunePastes();
    assert.equal(fs.existsSync(item.path),false);
  }finally{f.close();}
});
test('voice cancellation preserves staged files; submitting the transcript clears them',async()=>{
  const f=sendingFixture();try{
    await f.manager.add('one',[f.file()]);await f.bindings.beginVoice();await f.bindings.cancel();assert.equal((await f.manager.snapshot('one')).items.length,1);
    await f.bindings.beginVoice();const end=f.bindings.endVoice();await tick();await f.manager.queue;
    assert.equal((await f.manager.snapshot('one')).items.length,0);assert.equal(f.chats[0].messages.find(message=>message.role==='user').attachments[0].name,'notes.txt');f.finish();await end;
  }finally{f.close();}
});
