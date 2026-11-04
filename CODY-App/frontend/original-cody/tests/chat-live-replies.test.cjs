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
