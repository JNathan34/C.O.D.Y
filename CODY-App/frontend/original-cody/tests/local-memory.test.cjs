'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {MemoryService}=require('../src/memory/service');
const {installNativeIpc}=require('../src/native-ipc');

test('private notes use their own local source and remain searchable after a restart',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cody-memory-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const cipher={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:buffer=>buffer.toString()};
  let memory=new MemoryService({directory,cipher});
  try{
    memory.addSource({label:'Older shared source',kind:'local-memory',permissions:{codex:true,heyclicky:true}});
    const imported=memory.addSource({label:'Account import',kind:'conversation-history'});
    memory.import(imported.id,[{text:'My name is Shared Account.'}]);
    assert.equal(memory.saveLocal('My name is Local Tester.').added,1);
    assert.equal(memory.saveLocal('My name is Local Tester.').duplicates,1);
    assert.throws(()=>memory.saveLocal('password: test-only-secret'),/credential/);
    assert.equal(memory.context('my name','codex').records.length,0);
    assert.equal(memory.context('my name','heyclicky').records.length,0);
  }finally{memory.close();}
  memory=new MemoryService({directory,cipher});
  try{
    const notes=memory.localNotes('name');
    assert.deepEqual(notes.map(note=>note.text),['My name is Local Tester.']);
    memory.deleteRecord(notes[0].id);
    assert.deepEqual(memory.localNotes(),[]);
  }finally{memory.close();}
});

function fixture(){
  const handlers=new Map(),engine=new EventEmitter(),messages=[],calls=[],notes=[];
  let localOnly=false;
  engine.connected=true;
  engine.status={state:'Idle'};
  engine.refresh=async()=>({state:'Idle',signedIn:true});
  engine.request=async(command,args)=>{
    calls.push([command,args]);
    if(command==='memory-mode-configure'){localOnly=args.localOnly;return {localOnly};}
    if(command==='end')return {utilityText:'Remember that my name is Voice Test'};
    return {};
  };
  const store={data:{settings:{assistantProvider:'heyclicky'},activeChatId:'chat'},chat:()=>({messages}),save(){},publicState:()=>({messages}),
    addMessage:(_chat,role,text,provider)=>{const message={id:String(messages.length),role,text,provider};messages.push(message);return message;},
    updateMessage:(_chat,id,text)=>{messages.find(message=>message.id===id).text=text;}};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,sendUI(){},getWindow:()=>({webContents}),
    getState:()=>({}),localMemoryOnly:()=>localOnly,saveLocalMemory:text=>{notes.push(text);return {added:1};},
    utilities:{match:text=>text==='what is the time',run:async()=>({reply:'It is noon.'})},
    submitExternal:async value=>{calls.push(['external',value]);return {external:true};}});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  return {invoke,engine,store,calls,messages,notes};
}

test('the switch keeps typed memories and basic commands local and pauses HeyClicky requests',async()=>{
  const {invoke,store,calls,messages,notes}=fixture();
  const send=text=>invoke('send-message',{chatId:'chat',text});
  assert.deepEqual(await invoke('memory-mode-state'),{localOnly:false});
  assert.deepEqual(await invoke('memory-mode-configure',true),{localOnly:true});
  assert.deepEqual(await send('Remember that my name is Private Test'),{local:true});
  assert.deepEqual(notes,['my name is Private Test']);
  assert.equal(messages.some(message=>message.text.includes('Private Test')),false);
  assert.match((await send('Answer a question')).error,/Claude through HeyClicky is paused/);
  assert.equal((await send('what is the time')).utility,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.at(-1).text,'It is noon.');
  assert.deepEqual(calls.map(([command])=>command),['memory-mode-configure']);
  store.data.settings.assistantProvider='codex';
  assert.deepEqual(await send('Use the other connection'),{external:true});
  assert.deepEqual(await invoke('memory-mode-configure',false),{localOnly:false});
  store.data.settings.assistantProvider='heyclicky';
  assert.equal((await send('Answer a question')).provider,'heyclicky');
  assert.equal(calls.at(-1)[0],'submit');
});

test('voice memory requests in local mode neither submit to HeyClicky nor duplicate the note in chat',async()=>{
  const {invoke,engine,calls,messages,notes}=fixture();
  await invoke('memory-mode-configure',true);
  await invoke('native-begin');
  const [,begin]=calls.at(-1);
  assert.equal(begin.utilityOnly,true);
  const text='Remember that my name is Voice Test';
  engine.emit('transcript',{turn:begin.turn,text});
  engine.emit('classify-utility',{turn:begin.turn,text});
  assert.equal(calls.at(-1)[1].handled,true);
  await invoke('native-end');
  assert.match(messages.at(-1).text,/Type this memory/);
  assert.equal(messages.some(message=>message.text.includes('Voice Test')),false);
  assert.equal(calls.some(([command])=>command==='submit'||command==='speak'),false);
  assert.deepEqual(notes,[]);
});
