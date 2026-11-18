'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {validatePlan}=require('../src/control/word-document');
const {WordSession}=require('../src/word-session');
const {installNativeIpc}=require('../src/native-ipc');
const {ComputerController}=require('../src/control/controller');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

const target={document:'Notes.docx',fullName:'C:\\Docs\\Notes.docx',window:'123',fingerprint:'unchanged',start:0,end:0};
const paragraph={type:'paragraph',text:'Cody helps with voice and local document commands.',style:'normal'};

test('Word plan accepts only attached images and explicit output paths',()=>{
  assert.throws(()=>validatePlan({steps:[{type:'sessions_spawn'}]}),/specific request/);
  assert.throws(()=>validatePlan({steps:[{type:'picture',image:0,path:'C:\\secret.png'}]}),/Attach/);
  const image='C:\\Pictures\\chosen.png';
  assert.equal(validatePlan({steps:[{type:'picture',image:0,wrap:'square',align:'right'}]},{images:[image]}).steps[0].path,image);
  assert.throws(()=>validatePlan({steps:[{type:'save-as',path:'C:\\missing.docx'}]},{allowSave:true}),/Specify/);
  assert.throws(()=>validatePlan({steps:[{type:'save'}]}),/Ask to save/);
  assert.throws(()=>validatePlan({steps:[{type:'save'},paragraph]},{allowSave:true}),/follow/);
  assert.throws(()=>validatePlan({steps:[{type:'paragraph',text:'hi',fontSize:1000}]}),/font/);
});

function fixture({changed=false,planner,voiceText}={}){
  const engine=new EventEmitter(),handlers=new Map(),calls=[],edits=[],messages=[];
  const wc={mainFrame:{}};
  let reads=0;
  const controller={
    readWord:async()=>({ok:true,target:{...target,...(changed&&reads++?{window:'456'}:{})},context:{paragraphs:[]}}),
    execute:async(action,args)=>{edits.push({action,args});return {ok:true,result:{document:'Notes.docx'}};}
  };
  engine.request=async(command,args)=>{
    calls.push({command,args});
    if(command==='begin'||command==='utility-route')return {};
    if(command==='end')return {utilityText:voiceText};
    assert.equal(command,'word-plan','document drafting cannot reach general submit or agent actions');
    const count=calls.filter(call=>call.command==='word-plan').length;
    return planner?planner(args,count):count===1?{question:'What should the document be about?'}:{steps:[paragraph]};
  };
  installNativeIpc({
    ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,controller,
    utilities:{match:()=>null},getWindow:()=>({webContents:wc}),getState:()=>({}),
    sendUI(){},store:{data:{activeChatId:'one',settings:{},chats:[]},chat:()=>({}),save(){},publicState:()=>({}),
      addMessage(chatId,role,text){const message={id:String(messages.length),role,text};messages.push(message);return message;}}
  });
  const send=(text,capabilityId='')=>handlers.get('send-message')({sender:wc,senderFrame:wc.mainFrame},{chatId:'one',text,capabilityId});
  const settled=async()=>{
    for(let i=0;i<100;i++){
      const state=await handlers.get('state')({sender:wc,senderFrame:wc.mainFrame});
      if(!state.busy)return;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw Error('Word request did not finish');
  };
  const invoke=(name,...args)=>handlers.get(name)({sender:wc,senderFrame:wc.mainFrame},...args);
  return {send,settled,calls,edits,messages,invoke,engine};
}

test('reported two-turn Word request generates a plan and edits the same open document locally',async()=>{
  const f=fixture();
  assert.equal((await f.send('put some pictures and words in this document make it look like a proper document')).word,true);
  await f.settled();
  assert.match(f.messages.at(-1).text,/What should/);
  assert.equal(f.edits.length,0);
  assert.equal((await f.send('just make it about you cody')).word,true);
  await f.settled();
  assert.match(f.calls[1].args.text,/proper document[\s\S]*about you cody/);
  assert.equal(f.edits[0].action,'word.document');
  assert.equal(f.edits[0].args.target.window,target.window);
  assert.match(f.messages.at(-1).text,/local Word commands/);
});

test('a follow-up cannot silently switch to a different Word document',async()=>{
  const f=fixture({changed:true});
  await f.send('make a proper Word document');await f.settled();
  await f.send('make it about London');await f.settled();
  assert.equal(f.edits.length,0);
  assert.equal(f.calls.length,1);
  assert.match(f.messages.at(-1).text,/Word document changed/);
});

test('Word drafting through an inline mention never becomes literal instruction text or a background job',async()=>{
  const f=fixture({planner:()=>({steps:[paragraph]})});
  await f.send('write a report about C.O.D.Y.','plugin:word');await f.settled();
  assert.equal(f.calls.length,1);
  assert.equal(f.edits.length,1);
  assert.equal(f.edits[0].args.plan.steps[0].text,paragraph.text);
});

test('routine formatting and a chosen right-wrapped picture execute without an AI request',async()=>{
  const f=fixture({planner:()=>assert.fail('Routine formatting must stay local')});
  await f.send('set font size to 12','plugin:word');await f.settled();
  assert.equal(f.calls.length,0);
  assert.equal(f.edits[0].args.plan.steps[0].fontSize,12);
  let edit;
  const session=new WordSession({
    controller:{readWord:async()=>({target,context:{}}),execute:async(action,args)=>{edit=args;return {result:{document:target.document}};}},
    engine:{request:async()=>assert.fail('Chosen picture positioning must stay local')}
  });
  await session.run({chatId:'two',text:'put this picture at the top right and make the text wrap around it',files:['C:\\chosen.png']});
  assert.equal(edit.plan.steps[0].type,'picture');
  assert.equal(edit.images[0],'C:\\chosen.png');
});

test('cancelled or invalid Word planning cannot apply a partial model response',async()=>{
  const controller={readWord:async()=>({target,context:{}}),execute:async()=>assert.fail('No edit should run')};
  const abort=new AbortController();
  const engine={request:async()=>{abort.abort();return {steps:[paragraph]};}};
  const session=new WordSession({controller,engine});
  assert.equal((await session.run({chatId:'one',text:'write a Word report',signal:abort.signal})).cancelled,true);
  const invalid=new WordSession({controller,engine:{request:async()=>({steps:[{type:'run-code',code:'anything'}]})}});
  await assert.rejects(invalid.run({chatId:'one',text:'write a Word report'}),/specific request/);
});

test('spoken document creation is classified before the native agent submit path',async()=>{
  const text='make this Word document about Cody';
  const f=fixture({voiceText:text,planner:()=>({steps:[paragraph]})});
  await f.invoke('native-begin');
  const turn=f.calls.find(call=>call.command==='begin').args.turn;
  f.engine.emit('classify-utility',{turn,text});
  assert.equal(f.calls.find(call=>call.command==='utility-route').args.handled,true);
  await f.invoke('native-end');
  assert.equal(f.edits.length,1);
  assert.ok(!f.calls.some(call=>call.command==='submit'));
});

test('Word file writes require permission and explicit overwrite approval even in Full access',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cody-word-overwrite-'));
  const file=path.join(directory,'existing.docx');
  fs.writeFileSync(file,'original file');
  let prompts=0;
  const permissions={enabled:true,level:'custom',keyboardMouse:true,uiAutomation:true,applications:true,filesWrite:false};
  const controller=new ComputerController({
    readPermissions:()=>permissions,runner:async()=>assert.fail('An unapproved file write must not reach Word'),
    confirm:async()=>{prompts++;return false;}
  });
  const args={target,plan:{steps:[{type:'save-as',path:file}]},paths:[file],allowSave:true};
  try{
    await assert.rejects(controller.execute('word.document',args,{origin:'chat'}),/filesWrite/);
    permissions.filesWrite=true;
    permissions.level='full';
    assert.equal((await controller.execute('word.document',args,{origin:'chat'})).cancelled,true);
    assert.equal(prompts,1);
    assert.equal(fs.readFileSync(file,'utf8'),'original file');
  }finally{fs.unlinkSync(file);fs.rmdirSync(directory);}
});
