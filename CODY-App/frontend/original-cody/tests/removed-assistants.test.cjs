'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {StateStore}=require('../src/store');
const {installNativeIpc}=require('../src/native-ipc');

test('saved external provider settings migrate while conversation history survives',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cody-retired-assistants-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const messages=[{id:'message',role:'assistant',text:'Keep this conversation.',mode:'codex'}];
  fs.writeFileSync(path.join(directory,'cody-state.json'),JSON.stringify({
    settings:{assistantProvider:'codex',webModel:'6.1-sol:medium',model:'old-model',voiceAutoSpeak:true},
    chats:[{id:'chat',messages,codexBridgeThreadId:'old',webUrl:'https://chatgpt.com/c/old'}],
    activeChatId:'chat'
  }));
  const store=new StateStore(directory);
  assert.equal(store.data.settings.assistantProvider,'heyclicky');
  assert.equal(store.data.settings.voiceAutoSpeak,true);
  assert.equal(store.data.settings.webModel,undefined);
  assert.equal(store.data.settings.model,undefined);
  assert.deepEqual(store.chat('chat').messages,messages);
  assert.equal(store.chat('chat').webUrl,undefined);
  assert.equal(store.chat('chat').codexBridgeThreadId,undefined);
  store.settings({assistantProvider:'chatgpt',model:'another-old-model'});
  assert.equal(new StateStore(directory).data.settings.assistantProvider,'heyclicky');
});

test('retired connections expose no IPC and ordinary chat uses the native engine',async()=>{
  const handlers=new Map(),engine=new EventEmitter(),calls=[],messages=[];
  engine.connected=true;
  engine.refresh=async()=>({signedIn:true,state:'Idle'});
  engine.request=async(command,args)=>{calls.push({command,args});return {text:'Native reply'};};
  const store={data:{settings:{assistantProvider:'chatgpt'},chats:[],activeChatId:'chat'},
    chat:()=>({messages}),save(){},publicState:()=>({}),
    addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},
    updateMessage:(_chat,id,text)=>{messages.find(message=>message.id===id).text=text;}};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},
    engine,store,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
  for(const name of ['codex-usage','agent-provider-select','agent-provider-connect','open-chatgpt','web-status','web-sign-in'])
    assert.equal(handlers.has(name),false,name);
  const result=await handlers.get('send-message')({sender:webContents,senderFrame:webContents.mainFrame},{chatId:'chat',text:'Explain gravity'});
  assert.equal(result.provider,'heyclicky');
  assert.equal(calls.find(call=>call.command==='submit').args.text,'Explain gravity');
});
