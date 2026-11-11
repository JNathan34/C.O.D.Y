'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
function fixture(transcript){const handlers=new Map(),calls=[],actions=[],messages=[],engine=new EventEmitter();engine.status={state:'Idle'};engine.connected=true;
 engine.request=async(command,args)=>{calls.push({command,args});if(command==='begin')return{listening:true};if(command==='wake-audio')return{accepted:true};if(command==='end')return{utilityText:transcript,transcript};if(command==='submit')return{text:'Completed.'};return{};};
 const chat={messages},store={data:{settings:{},activeChatId:'chat'},chat:()=>chat,addMessage:(_id,role,text)=>{const m={id:String(messages.length),role,text};messages.push(m);return m;},updateMessage(_id,id,text){messages.find(m=>m.id===id).text=text;},save(){},publicState:()=>({})};
 const webContents={mainFrame:{}},bindings=installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,sendUI(){},getState:()=>({}),getWindow:()=>({webContents}),utilities:{match:text=>text==='what is the time'?{action:'time'}:null,run:async text=>{actions.push(text);return{reply:'12:00'};},observe(){},cancel(){}}});return{bindings,calls,actions,messages,engine};
}
test('wake handoff sends buffered audio and routes an addressed time request locally',async()=>{const f=fixture('Hey Cody, what is the time');await f.bindings.beginVoice({wake:true,audioPrefix:'AAAA'});const begin=f.calls.find(c=>c.command==='begin');assert.equal(begin.args.audioPrefix,'AAAA');assert.equal(begin.args.utilityOnly,true);await f.bindings.endWakeVoice();assert.deepEqual(f.actions,['what is the time']);assert.equal(f.calls.some(c=>c.command==='submit'),false);assert.equal(f.bindings.isBusy(),false);});
test('streamed audio is forwarded only to its active wake turn',async()=>{
 const f=fixture('Hey Cody what is the time');
 assert.deepEqual(await f.bindings.forwardWakeAudio('AQI='),{accepted:false});
 await f.bindings.beginVoice({wake:true,streamedAudio:true,audioPrefix:'AAA='});
 const begin=f.calls.find(call=>call.command==='begin').args;
 assert.equal(begin.streamedAudio,true);
 assert.deepEqual(await f.bindings.forwardWakeAudio('AQI='),{accepted:true});
 assert.deepEqual(f.calls.find(call=>call.command==='wake-audio').args,{turn:begin.turn,pcm:'AQI='});
 const cancelling=f.bindings.cancelWakeVoice();
 assert.deepEqual(await f.bindings.forwardWakeAudio('AwQ='),{accepted:false});
 await cancelling;
 await f.bindings.beginVoice();
 assert.deepEqual(await f.bindings.forwardWakeAudio('BQY='),{accepted:false});
 await f.bindings.cancel();
});
test('a wake address alone never becomes an AI request',async()=>{const f=fixture('Hey Cody');await f.bindings.beginVoice({wake:true});await f.bindings.endWakeVoice();assert.equal(f.calls.some(c=>c.command==='submit'),false);assert.deepEqual(f.actions,[]);assert.equal(f.bindings.isBusy(),false);});
test('arbitrary wake requests use normal native speech recognition before submitting once',async()=>{const f=fixture('Okay Cody explain gravity');await f.bindings.beginVoice({wake:true});await f.bindings.endWakeVoice();const submit=f.calls.filter(c=>c.command==='submit');assert.equal(submit.length,1);assert.equal(submit[0].args.text,'explain gravity');assert.equal(submit[0].args.speak,true);});
test('wake cleanup cannot cancel or end a manually started voice request',async()=>{const f=fixture('hello');await f.bindings.beginVoice();await f.bindings.cancelWakeVoice();await f.bindings.endWakeVoice();assert.equal(f.calls.some(c=>['cancel','end'].includes(c.command)),false);assert.equal(f.bindings.isBusy(),true);await f.bindings.cancel();});
test('wake transcript updates remove the address and preserve command words in chat',async()=>{const f=fixture('Hey Cody tell me a joke');await f.bindings.beginVoice({wake:true});const turn=f.calls.find(c=>c.command==='begin').args.turn;f.engine.emit('transcript',{turn,text:'Hey Cody'});assert.equal(f.messages.length,0);f.engine.emit('transcript',{turn,text:'Hey Cody tell me a joke'});assert.equal(f.messages[0].text,'tell me a joke');await f.bindings.cancelWakeVoice();});

for(const phrase of ['cancel','Hey Cody cancel','open Firefox actually cancel','never mind'])test('final transcript stop guard prevents a late cancellation from reaching tools or AI: '+phrase,async()=>{const f=fixture(phrase);await f.bindings.beginVoice({wake:true});const result=await f.bindings.endWakeVoice();assert.equal(result.cancelled,true);assert.equal(f.calls.some(c=>c.command==='submit'),false);assert.deepEqual(f.actions,[]);assert.equal(f.bindings.isBusy(),false);});
