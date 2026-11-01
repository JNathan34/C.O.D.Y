'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {IslandUtilities}=require('../src/island-utilities');
const {captureCommand}=require('../src/screen-capture');
const {installNativeIpc}=require('../src/native-ipc');
for(const [text,action]of [['take a screenshot','screenshot'],['start screen recording','start'],['pause screen recording','pause'],['stop recording','stop']])test(`spoken screen command is claimed before AI and executed once: ${text}`,async()=>{
  const handlers=new Map(),calls=[],actions=[],engine=new EventEmitter();engine.connected=true;engine.status={state:'Idle'};
  engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
  const capture={match:captureCommand,execute:async action=>{actions.push(action);return {reply:'Completed.',confirmation:'Done.'};}};
  const utilities=new IslandUtilities({capture,clearCard(){},showCard(){}}),messages=[],settings={voiceAutoSpeak:false};
  const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},updateMessage(){},save(){},publicState:()=>({settings})};
  const webContents={mainFrame:{}};installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,sendUI(){},getState:()=>({}),getWindow:()=>({webContents}),utilities,capture});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  await invoke('native-begin');const turn=calls.find(call=>call.command==='begin').args.turn;
  engine.emit('classify-utility',{turn,text});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);
  await invoke('native-end');assert.deepEqual(actions,[action]);assert.equal(calls.some(call=>call.command==='submit'),false);assert.equal(invoke('state').busy,false);
});
