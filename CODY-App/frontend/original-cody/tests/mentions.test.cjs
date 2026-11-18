'use strict';

const {EventEmitter}=require('node:events');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {routeRequest}=require('../src/router');
const {installNativeIpc}=require('../src/native-ipc');

function fixture({unavailable=false}={}){
  const engine=new EventEmitter(),handlers=new Map(),calls=[],messages=[];
  const webContents={mainFrame:{}};
  const w={webContents};
  const catalog=[{id:'plugin:higgsfield',name:'Higgsfield',kind:'plugin',description:'Connected creative tools.',icon:'plug'}];
  engine.connected=true;
  engine.refresh=async()=>({signedIn:true});
  engine.request=async(command,args)=>{
    calls.push({command,args});
    if(command==='mentions-list')return catalog;
    if(command==='mentions-check'&&unavailable)throw Error('This capability is unavailable.');
    return {};
  };
  installNativeIpc({
    ipcMain:{removeHandler(){},handle(name,fn){handlers.set(name,fn);}},
    engine,getWindow:()=>w,getState:()=>({}),sendUI(){},
    utilities:{match:text=>routeRequest(text),run:async()=>({handled:true,reply:'Calculator result'}),observe(){}},
    store:{data:{activeChatId:'conversation',settings:{}},chat:()=>({}),
      addMessage(chatId,role,text,mode,options={}){const message={id:String(messages.length),role,text,...(role==='user'&&options.mention?{mention:options.mention}:{})};messages.push(message);return message;},
      save(){},publicState:()=>({})}
  });
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  return {invoke,messages,calls,catalog};
}

test('the mentions picker combines local tools with the native inventory',async()=>{
  const f=fixture();
  const local=await f.invoke('mentions-list',true);
  assert.ok(local.items.some(item=>item.id==='tool:calculator'));
  assert.equal(f.calls.length,0);
  const all=await f.invoke('mentions-list');
  assert.ok(all.items.some(item=>item.id==='plugin:higgsfield'));
});

test('a mentioned local tool runs only the matching action',async()=>{
  const f=fixture();
  const send=(text,capabilityId)=>f.invoke('send-message',{chatId:'conversation',text,capabilityId});
  assert.match((await send('set a timer for five minutes','tool:calculator')).error,/Calculator can’t handle/);
  assert.equal(f.messages.length,0);
  assert.deepEqual(await send('2+2','tool:calculator'),{started:true,local:true,utility:true});
  assert.ok(f.messages.some(message=>message.text==='Calculator result'));
  assert.equal(f.calls.length,0);
});

test('a selected plugin carries its stable id separately from the original request',async()=>{
  const f=fixture();
  const result=await f.invoke('send-message',{chatId:'conversation',text:'2+2',capabilityId:'plugin:higgsfield'});
  assert.equal(result.provider,'heyclicky');
  assert.deepEqual(f.calls[0],{command:'mentions-check',args:{capabilityId:'plugin:higgsfield'}});
  assert.equal(f.calls[1].command,'submit');
  assert.equal(f.calls[1].args.text,'2+2');
  assert.equal(f.calls[1].args.capabilityId,'plugin:higgsfield');
});

test('a disconnected selection is reported before sending and never falls back to a local match',async()=>{
  const f=fixture({unavailable:true});
  const result=await f.invoke('send-message',{chatId:'conversation',text:'weather in Derby',capabilityId:'plugin:higgsfield'});
  assert.equal(result.error,'This capability is unavailable.');
  assert.equal(f.messages.length,0);
  assert.deepEqual(f.calls.map(call=>call.command),['mentions-check']);
});

test('selected skill appears as structured metadata on the sent chat message',async()=>{
  const f=fixture();
  const mention={id:'plugin:higgsfield',name:'Higgsfield',icon:'plug',offset:6};
  const result=await f.invoke('send-message',{chatId:'conversation',text:'hello world',capabilityId:mention.id,mention});
  assert.equal(result.provider,'heyclicky');
  assert.deepEqual(f.messages[0].mention,mention);
  assert.equal(f.messages[0].text,'hello world');
  assert.equal(f.calls.find(call=>call.command==='submit').args.capabilityId,mention.id);
});

test('unrelated or invalid inline labels cannot impersonate a routed capability',async()=>{
  const f=fixture();
  const result=await f.invoke('send-message',{chatId:'conversation',text:'hello world',
    capabilityId:'plugin:higgsfield',mention:{id:'tool:calculator',name:'Computer Use',icon:'plug',offset:6}});
  assert.equal(result.provider,'heyclicky');
  assert.equal(f.messages[0].mention,undefined);
  assert.equal(f.calls.find(call=>call.command==='submit').args.capabilityId,'plugin:higgsfield');
});
