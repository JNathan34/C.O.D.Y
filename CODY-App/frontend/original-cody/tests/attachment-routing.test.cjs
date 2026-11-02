'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
function fixture(options={}){
  const engine=new EventEmitter(),handlers=new Map(),calls=[],messages=[],webContents={mainFrame:{}},files=['C:\\fixtures\\picture.png'];
  engine.connected=true;engine.status={state:'Idle'};engine.refresh=async()=>({signedIn:true});engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:options.words||'What is in this picture?'}:command==='begin'?{textTarget:options.target}:{text:'A blue robot.'};};
  const chat={messages},store={data:{settings:{voiceAutoSpeak:false},activeChatId:'one'},chat:id=>id==='one'?chat:null,save(){},publicState:()=>({}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},updateMessage:(_id,id,text)=>messages.find(message=>message.id===id).text=text};
  let adds=0;const attachments={prepare:async()=>({paths:files,ids:['picture']}),clearSent:async()=>({chatId:'one',items:[]}),paths:async()=>files,snapshot:async()=>({chatId:'one',items:[]}),add:async()=>{adds++;return {chatId:'one',items:[{name:'picture.png'}]};}};
  const utilityCalls=[];
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,sendUI(){},getState:()=>({}),getWindow:()=>({webContents}),utilities:{match:()=>options.proofread?{action:'text.proofread'}:null,observe(){},run:async(...args)=>{utilityCalls.push(args);return {reply:'Spelling fixed.'};}},attachments,captureTextEnabled:()=>Boolean(options.proofread)});
  return {engine,calls,messages,files,attachments,utilityCalls,added:()=>adds,invoke:(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args)};
}
test('attaching stages files without sending the AI a message',async()=>{
  const f=fixture();await f.invoke('attachments-add',f.files);assert.equal(f.added(),1);assert.equal(f.calls.length,0);assert.equal(f.messages.length,0);
});
test('voice proofreading uses the field captured before transcription and bypasses general AI',async()=>{
 const f=fixture({proofread:true,words:'spell check this',target:'1988199e-7d3f-407a-b34c-14b27fe81234'});await f.invoke('native-begin');assert.equal(f.calls.find(c=>c.command==='begin').args.captureText,true);await f.invoke('native-end');assert.equal(f.utilityCalls[0][2].proofreadTarget,'1988199e-7d3f-407a-b34c-14b27fe81234');assert.equal(f.calls.some(c=>c.command==='submit'),false);
});
test('a failed voice target capture never silently falls back to a different text box',async()=>{
 const f=fixture({proofread:true,words:'proofread this'});await f.invoke('native-begin');await assert.rejects(f.invoke('native-end'),/text box/);assert.equal(f.utilityCalls.length,0);assert.equal(f.calls.some(c=>c.command==='submit'),false);
});
test('typed questions send real file paths through the native attachment pipeline and retain names in history',async()=>{
  const f=fixture();await f.invoke('send-message',{chatId:'one',text:'What is in this picture?'});await new Promise(resolve=>setImmediate(resolve));
  const submit=f.calls.find(call=>call.command==='submit');assert.deepEqual(submit.args.files,f.files);assert.equal(submit.args.speak,false);assert.equal(f.messages[0].attachments[0].name,'picture.png');
});
test('voice questions are transcribed first and then submitted with attachments, rather than becoming a text-only turn',async()=>{
  const f=fixture();await f.invoke('native-begin');const begin=f.calls.find(call=>call.command==='begin');assert.equal(begin.args.utilityOnly,true);
  f.engine.emit('classify-utility',{turn:begin.args.turn,text:'What is in this picture?'});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.find(call=>call.command==='utility-route').args.handled,true);
  await f.invoke('native-end');const submits=f.calls.filter(call=>call.command==='submit');assert.equal(submits.length,1);assert.deepEqual(submits[0].args.files,f.files);assert.equal(submits[0].args.speak,true);
});
test('later file-work reports return to their originating chat once, after the initial reply has finished',async()=>{
  const f=fixture();await f.invoke('send-message',{chatId:'one',text:'Summarise this file.'});await new Promise(resolve=>setImmediate(resolve));
  const turn=f.calls.find(call=>call.command==='submit').args.turn,report={turn,taskId:'task-one',text:'The file has 17 rows.'};
  f.engine.emit('job-report',report);f.engine.emit('job-report',report);assert.equal(f.messages.filter(message=>message.text===report.text).length,1);
  f.engine.emit('job-report',{turn:'another-chat',taskId:'task-other',text:'Unrelated result'});assert.equal(f.messages.some(message=>message.text==='Unrelated result'),false);
});
