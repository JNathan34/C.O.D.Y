'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
test('a growing spoken reply follows the bottom using the position before the update',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/island/renderer/assistant.js'),'utf8');
 const message={id:'reply',role:'assistant',text:'First line'},node={dataset:{messageId:'reply'}},log={scrollHeight:500,clientHeight:200,scrollTop:300};
 const context={app:{data:{activeChatId:'chat',chats:[{id:'chat',messages:[message]}]}},$:id=>id==='conversation'?log:{children:[node]},displayText:text=>text,window:{},island:{renderMessage:()=>{log.scrollHeight+=400;}}};
 vm.runInNewContext(source.slice(source.indexOf('  function updateMessage('),source.indexOf('  function busy(')),context);
 context.updateMessage('chat','reply','First line. Second spoken line.');assert.equal(log.scrollTop,900);assert.equal(message.text,'First line. Second spoken line.');
 // Reading older messages must not be interrupted by the stream.
 log.scrollTop=20;context.updateMessage('chat','reply',' More text',true);assert.equal(log.scrollTop,20);assert.ok(message.text.endsWith(' More text'));
});

test('the chat composer stays editable while an active reply is spoken',async()=>{
 const renderer=file=>fs.readFileSync(path.join(__dirname,'../src/island/renderer',file),'utf8');
 const assistant=renderer('assistant.js'),ui=renderer('ui.js');
 const input={value:'',disabled:false,style:{},scrollHeight:24},sendButton={};
 const elements={'quick-input':input,'panel-send':sendButton,'core-stop':{},'new-chat':{},'core-history':{}};
 const island={getState:()=>'speaking',updateInput:()=>context.updateInput()};
 const context={app:{},island,$:id=>elements[id],input,sendButton,renderHistory(){},window:{CODYIsland:island}};
 vm.runInNewContext(assistant.slice(assistant.indexOf('  function busy('),assistant.indexOf('  function renderPermissions(')),context);
 vm.runInNewContext(ui.slice(ui.indexOf('  function updateInput('),ui.indexOf('  function clearTransition(')),context);
 vm.runInNewContext(ui.slice(ui.indexOf('  async function sendPrompt('),ui.indexOf('  // Preferences shown here')),context);

 context.busy(true);
 assert.equal(input.disabled,false);
 assert.equal(elements['core-stop'].hidden,false);
 input.value='My follow-up';
 context.updateInput();
 assert.equal(sendButton.disabled,true);
 await context.sendPrompt();
 assert.equal(input.value,'My follow-up');
 context.busy(false);
 assert.equal(input.value,'My follow-up');
 assert.equal(sendButton.disabled,false);
});

function rendererVoice(cancel,begin){
 const source=fs.readFileSync(path.join(__dirname,'../ui/native-voice-ui.js'),'utf8');
 const calls=[],phases=[],listeners=new Map(),window={dispatchEvent:event=>phases.push(event.detail.phase)};
 vm.runInNewContext(source,{window,document:{getElementById:()=>null,addEventListener(){}},CustomEvent:function(_name,options){this.detail=options.detail;}});
 const voice=window.CODYVoice.attach({api:{on:(event,callback)=>listeners.set(event,callback),voice:{
  status:async()=>({signedIn:true}),voices:async()=>({voices:[]}),
  cancel:()=>{calls.push('cancel');return cancel();},begin:()=>{calls.push('begin');return begin();},
  end:async()=>{calls.push('end');return {listening:false};}
 }},$:()=>null,toast:error=>assert.fail(error),getApp:()=>({busy:false,data:{settings:{}}})});
 return {voice,calls,phases,nativePhase:state=>listeners.get('native-phase')({state})};
}

test('push-to-talk shows startup before the previous speech stops and ignores its final Idle event',async()=>{
 let stopSpeech;
 const fixture=rendererVoice(()=>new Promise(resolve=>stopSpeech=resolve),async()=>({listening:true}));
 fixture.nativePhase('Responding');
 const starting=fixture.voice.press();
 assert.equal(fixture.voice.getPhase(),'starting');
 assert.deepEqual(fixture.calls,['cancel']);
 fixture.nativePhase('Idle');
 assert.equal(fixture.voice.getPhase(),'starting');
 stopSpeech();await starting;
 assert.deepEqual(fixture.phases,['speaking','starting','listening']);
 assert.deepEqual(fixture.calls,['cancel','begin']);
});

test('letting go during speech cancellation does not start a late recording',async()=>{
 let stopSpeech;
 const fixture=rendererVoice(()=>new Promise(resolve=>stopSpeech=resolve),async()=>({listening:true}));
 fixture.nativePhase('Responding');
 const starting=fixture.voice.press();await fixture.voice.release();
 stopSpeech();await starting;
 assert.equal(fixture.voice.getPhase(),'idle');
 assert.deepEqual(fixture.calls,['cancel']);
});

test('releasing push-to-talk during microphone startup waits for capture before ending it',async()=>{
 let micReady;
 const fixture=rendererVoice(async()=>{},()=>new Promise(resolve=>micReady=resolve));
 const starting=fixture.voice.press(),releasing=fixture.voice.release();
 fixture.nativePhase('Listening');
 assert.equal(fixture.voice.getPhase(),'thinking');
 assert.deepEqual(fixture.calls,['begin']);
 micReady({listening:true});await Promise.all([starting,releasing]);
 assert.equal(fixture.voice.getPhase(),'idle');
 assert.deepEqual(fixture.calls,['begin','end']);
});

function voiceFixture(){
 const engine=new EventEmitter(),events=[],messages=[],calls=[];let result={text:'Full spoken reply.'};
 engine.status={state:'Idle'};engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?result:command==='begin'?{listening:true}:{};};
 const chat={id:'chat',messages},store={data:{settings:{},activeChatId:'chat',chats:[chat]},chat:()=>chat,save(){},publicState:()=>({chats:[chat]}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},updateMessage:(_id,id,text)=>{messages.find(message=>message.id===id).text=text;}};
 const bindings=installNativeIpc({ipcMain:{removeHandler(){},handle(){}},engine,store,sendUI:(event,data)=>events.push({event,data}),getState:()=>({}),getWindow:()=>null,utilities:{observe(){}}});
 return {engine,bindings,messages,events,calls,setResult:value=>result=value};
}
test('spoken reply lines are published immediately while the voice turn is still active',async()=>{
 const f=voiceFixture();await f.bindings.beginVoice();const turn=f.calls.find(call=>call.command==='begin').args.turn;
 f.engine.emit('response',{turn,text:'First spoken line.'});assert.equal(f.messages[0].text,'First spoken line.');assert.equal(f.events.at(-1).event,'message-added');assert.equal(f.bindings.isBusy(),true);
 f.engine.emit('response',{turn,text:'First spoken line. Second spoken line.'});assert.equal(f.events.at(-1).event,'message-replace');assert.equal(f.messages.length,1);
});
test('voice completion reconciles the final reply before chat refresh without a later message',async()=>{
 const f=voiceFixture();await f.bindings.beginVoice();const turn=f.calls.find(call=>call.command==='begin').args.turn;
 f.engine.emit('response',{turn,text:'Partial spoken reply.'});await f.bindings.endVoice();
 assert.equal(f.messages[0].text,'Full spoken reply.');const replaced=f.events.findIndex(event=>event.event==='message-replace');const refreshed=f.events.findIndex(event=>event.event==='chats-changed');assert.ok(replaced>=0&&replaced<refreshed);assert.equal(f.messages.length,1);
});
test('an empty voice capture never copies a previous session reply into chat',async()=>{
 const f=voiceFixture();f.setResult({text:'Previous session reply.'});await f.bindings.beginVoice();await f.bindings.endVoice();assert.equal(f.messages.length,0);
});
