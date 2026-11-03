'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
const {RpsVoice}=require('../src/rps-voice');
const {KeywordWakeListener}=require('../src/voice/keyword-wake-listener');
const read=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
test('holding Ctrl+Alt+M toggles once; releasing M permits the next toggle',()=>{
 const source=read('island/main.js'),values=[];
 const context={settings:{microphoneMuted:false},muteShortcutHeld:false,setMicrophoneMuted:value=>{values.push(value);context.settings.microphoneMuted=value;}};
 vm.runInNewContext(source.slice(source.indexOf('function handleHotkey('),source.indexOf('module.exports=')),context);
 context.handleHotkey('mute');context.handleHotkey('mute');assert.deepEqual(values,[true]);
 context.handleHotkey('mute-up');context.handleHotkey('mute');assert.deepEqual(values,[true,false]);
});
test('muted push-to-talk never emits a start request',()=>{
 const source=read('island/main.js'),events=[];
 const context={settings:{microphoneMuted:true,startListeningOnHotkey:true,enableHotkey:true},hotkeyHeld:false,emit:(...args)=>events.push(args)};
 vm.runInNewContext(source.slice(source.indexOf('function onModifierEvent('),source.indexOf('function createIsland(')),context);
 context.onModifierEvent('DOWN');context.onModifierEvent('UP');assert.deepEqual(events,[]);
});
function fixture(){
 const engine=new EventEmitter(),handlers=new Map(),calls=[],messages=[];let muted=true;
 engine.status={state:'Idle'};engine.request=async(command,args)=>{calls.push({command,args});return command==='begin'?{listening:true}:{};};
 const webContents={mainFrame:{}},settings={voiceAutoSpeak:false};
 const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},save(){},updateMessage(){},publicState:()=>({settings})};
 const bindings=installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities:{match:()=>({action:'local'}),run:async()=>({handled:true,reply:'Typed command still works.'})},getWindow:()=>({webContents}),getState:()=>({}),sendUI(){},isMicrophoneMuted:()=>muted});
 return {bindings,calls,engine,messages,setMuted:value=>muted=value,invoke:(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args)};
}
test('manual and wake voice starts are blocked while muted, and ending cannot submit audio',async()=>{
 const f=fixture();await assert.rejects(f.invoke('native-begin'),/muted/);await assert.rejects(f.bindings.beginVoice({wake:true}),/muted/);
 assert.equal((await f.bindings.endVoice()).muted,true);assert.equal(f.calls.length,0);
 f.setMuted(false);assert.equal((await f.bindings.beginVoice()).listening,true);assert.equal(f.calls.filter(x=>x.command==='begin').length,1);
});
test('muting cancels active voice capture without submitting a partial recording',async()=>{
 const f=fixture();f.setMuted(false);await f.bindings.beginVoice();f.engine.status.state='Listening';f.setMuted(true);
 await f.bindings.muteVoice();await f.bindings.endVoice();
 assert.ok(f.calls.some(x=>x.command==='cancel'));assert.equal(f.calls.some(x=>x.command==='end'),false);
});
test('typed commands remain usable while the microphone is muted',async()=>{
 const f=fixture();const result=await f.invoke('send-message',{chatId:'chat',text:'What is the time?'});await new Promise(r=>setImmediate(r));
 assert.equal(result.local,true);assert.equal(f.messages.at(-1).text,'Typed command still works.');assert.equal(f.calls.some(x=>x.command==='begin'),false);
});
test('game voice cannot start while muted',async()=>{
 const engine=new EventEmitter(),calls=[];engine.request=async command=>calls.push(command);
 const game={active:true,phase:'ready',setVoice(){}};const voice=new RpsVoice({engine,game,isMicrophoneMuted:()=>true});
 await voice.start();assert.equal(voice.running,false);assert.deepEqual(calls,[]);
});
test('muting closes wake detection and unmuting restores only an enabled listener',()=>{
 const children=[],listener=new KeywordWakeListener({launch:()=>({command:'native',args:[]}),spawnProcess:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stdout.setEncoding=()=>{};c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.end=()=>{};c.kill=()=>{c.killed=true;};children.push(c);return c;}});
 try{listener.configure({wakeWordEnabled:true,wakeHeyCody:true});assert.equal(children.length,1);listener.setMuted(true);assert.equal(children[0].killed,true);listener.update();listener.start();assert.equal(children.length,1);listener.setMuted(false);assert.equal(children.length,2);
 listener.configure({wakeWordEnabled:false});listener.setMuted(true);listener.setMuted(false);assert.equal(children.length,2);
 }finally{listener.close();}
});
test('muted indicator survives ordinary preference updates and rapid remuting cancels the restore timer',()=>{
 const source=read('island/renderer/ui.js'),timers=new Map();let timer=0;
 const context={microphoneMuted:false,microphoneStateKnown:false,microphoneRestoreTimer:null,body:{dataset:{}},micButton:{setAttribute(){}},document:{dispatchEvent(){}},CustomEvent:function(){},stopMicrophone(){},stopMicTest(){},wakeUp(){},setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source.slice(source.indexOf('function applyMicrophoneMute('),source.indexOf('const presence=')),context);
 context.applyMicrophoneMute(true);assert.equal(context.body.dataset.microphone,'muted');assert.equal(context.micButton.disabled,true);
 context.applyMicrophoneMute(false);assert.equal(context.body.dataset.microphone,'restored');const pending=timer;
 context.applyMicrophoneMute(false);assert.equal(timer,pending);
 context.applyMicrophoneMute(true);assert.equal(timers.has(pending),false);assert.equal(context.body.dataset.microphone,'muted');
 context.applyMicrophoneMute(false);timers.get(timer)();assert.equal(context.body.dataset.microphone,'on');
});
