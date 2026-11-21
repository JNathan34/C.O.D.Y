'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {IslandUtilities}=require('../src/island-utilities');const {installNativeIpc}=require('../src/native-ipc');
for(const [text,action]of [['pause','media.control'],['play','media.control'],['skip 2 mins','media.control'],['play Iron Man on Plezy','plezy.play'],['Resume the mental list on Plezy.','plezy.play'],['resume The Mentalist on Plex','plezy.play'],['pause on Plex','media.control'],['skip 2 mins on Plex','media.control'],['open Plex','app.open'],['open Firefox and Plezy in split screen','app.split']])test(`spoken media request stays local: ${text}`,async()=>{
  const engine=new EventEmitter(),calls=[],actions=[],handlers=new Map(),messages=[];engine.connected=true;engine.status={state:'Idle'};
  engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
  const utilities=new IslandUtilities({spotify:{snapshot:()=>({available:true,title:'Iron Man',source:'Plezy'})},controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true,result:{title:'Iron Man'}};}},showCard(){},clearCard(){},refreshMedia(){}});
  const settings={voiceAutoSpeak:false},store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},updateMessage(){},save(){},publicState:()=>({settings})};
  const webContents={mainFrame:{}};installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  await invoke('native-begin');const turn=calls.find(call=>call.command==='begin').args.turn;engine.emit('classify-utility',{turn,text});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);await invoke('native-end');assert.equal(actions.length,1);assert.equal(actions[0].action,action);assert.equal(calls.some(call=>call.command==='submit'),false);
  if(action==='media.control'&&/on Plex/i.test(text))assert.equal(actions[0].args.target,'plezy');
  if(action==='app.open')assert.equal(actions[0].args.app,'plezy');
});

test('typed and spoken “whose watching plex” make one direct lookup per turn',async()=>{
  const text='whose watching plex',engine=new EventEmitter(),calls=[],handlers=new Map(),messages=[];
  engine.connected=true;
  engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
  engine.refresh=()=>assert.fail('Plex activity should stay local');
  let lookups=0;
  const utilities=new IslandUtilities({selfHosted:{plexSessions:async()=>{lookups++;return {count:0,sessions:[]};}},showCard(){}});
  const store={data:{settings:{},activeChatId:'chat'},chat:()=>({messages}),
    addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},save(){},publicState:()=>({})};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  assert.equal((await invoke('send-message',{chatId:'chat',text})).utility,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lookups,1);
  assert.match(messages.at(-1).text,/Nobody is watching Plex/);
  assert.deepEqual(calls,[]);
  await invoke('native-begin');
  engine.emit('classify-utility',{turn:calls[0].args.turn,text});
  await invoke('native-end');
  assert.equal(lookups,2);
  assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);
  assert.ok(!calls.some(call=>call.command==='submit'));
});
