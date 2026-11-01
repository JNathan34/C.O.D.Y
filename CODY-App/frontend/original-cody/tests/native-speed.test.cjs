'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
function setup(){
  const handlers=new Map(),calls=[],runs=[];const engine=new EventEmitter();engine.connected=true;engine.status={state:'Idle'};engine.refresh=async()=>({signedIn:true});engine.request=async(command,args)=>{calls.push({command,args});if(command==='speak')return new Promise(()=>{});if(command==='end')return {utilityText:'turn the volume up'};return {};};
  const settings={voiceAutoSpeak:true};const messages=[];const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const m={id:String(messages.length),role,text};messages.push(m);return m;},updateMessage:()=>{},save:()=>{},publicState:()=>({settings})};
  const utilities={match:text=>text==='turn the volume up'?{action:'audio.adjust'}:null,run:async text=>{runs.push(text);return {reply:'Volume is 51%.',confirmation:"Volume up."};},cancel(){},observe:async()=>{}};
  const webContents={mainFrame:{}};installNativeIpc({ipcMain:{removeHandler(){},handle:(n,fn)=>handlers.set(n,fn)},engine,store,sendUI:()=>{},getState:()=>({}),getWindow:()=>({webContents}),utilities});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  return {engine,calls,runs,invoke,messages};
}
test('utility result unlocks the interface while speech is still pending',async()=>{const s=setup();await s.invoke('send-message',{chatId:'chat',text:'turn the volume up'});await new Promise(r=>setImmediate(r));assert.equal(s.invoke('state').busy,false);assert.ok(s.calls.some(c=>c.command==='speak'&&c.args.text==="Volume up."));assert.equal(s.calls.some(c=>c.command==='submit'),false);});
test('recognised voice utility runs locally once and avoids an AI submission',async()=>{const s=setup();await s.invoke('native-begin');const turn=s.calls.find(c=>c.command==='begin').args.turn;s.engine.emit('classify-utility',{turn,text:'turn the volume up'});await new Promise(r=>setImmediate(r));assert.equal(s.calls.find(c=>c.command==='utility-route').args.handled,true);await s.invoke('native-end');assert.deepEqual(s.runs,['turn the volume up']);assert.equal(s.calls.some(c=>c.command==='submit'),false);assert.equal(s.invoke('state').busy,false);});
test('compound or unfamiliar spoken requests remain with the native AI',async()=>{const s=setup();await s.invoke('native-begin');const turn=s.calls.find(c=>c.command==='begin').args.turn;s.engine.emit('classify-utility',{turn,text:'turn the volume up and explain how speakers work'});await new Promise(r=>setImmediate(r));assert.equal(s.calls.find(c=>c.command==='utility-route').args.handled,false);});

test('Ctrl+Alt can interrupt active computer control and a spoken stop is acknowledged locally',async()=>{
 const s=setup();await s.invoke('native-begin');
 s.engine.request=async(command,args)=>{s.calls.push({command,args});if(command==='drive-state')return{active:true};if(command==='end')return{controlStopped:true,transcript:'cancel',text:''};return{};};
 await s.invoke('native-begin');assert.ok(s.calls.some(c=>c.command==='drive-stop'));assert.equal(s.calls.filter(c=>c.command==='begin').length,2);
 await s.invoke('native-end');assert.equal(s.messages.at(-1).text,'Stopped.');assert.equal(s.calls.some(c=>c.command==='submit'),false);assert.equal(s.invoke('state').busy,false);
});
