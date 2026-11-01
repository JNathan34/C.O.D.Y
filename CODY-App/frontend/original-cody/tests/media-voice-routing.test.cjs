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
