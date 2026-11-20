'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {validatePlan}=require('../src/control/word-document');
const {WordSession}=require('../src/word-session');
const {installNativeIpc}=require('../src/native-ipc');
const {ComputerController}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
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

function fixture({changed=false,planner,voiceText,history=[],paragraphs=[],utilities={match:()=>null}}={}){
  const engine=new EventEmitter(),handlers=new Map(),calls=[],edits=[],messages=[...history];
  const wc={mainFrame:{}};
  let reads=0;
  const controller={
    readWord:async()=>({ok:true,target:{...target,...(changed&&reads++?{window:'456'}:{})},context:{paragraphs}}),
    execute:async(action,args)=>{edits.push({action,args});return {ok:true,result:{document:'Notes.docx'}};}
  };
  engine.request=async(command,args)=>{
    calls.push({command,args});
    if(command==='begin'||command==='utility-route'||command==='speak')return {};
    if(command==='end')return {utilityText:voiceText};
    assert.equal(command,'word-plan','document drafting cannot reach general submit or agent actions');
    const count=calls.filter(call=>call.command==='word-plan').length;
    return planner?planner(args,count):count===1?{question:'What should the document be about?'}:{steps:[paragraph]};
  };
  installNativeIpc({
    ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,controller,
    utilities,getWindow:()=>({webContents:wc}),getState:()=>({}),
    sendUI(){},store:{data:{activeChatId:'one',settings:{},chats:[]},chat:()=>({messages}),save(){},publicState:()=>({}),
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
  const f=fixture({planner:()=>({steps:[paragraph]})});
  assert.equal((await f.send('put some pictures and words in this document make it look like a proper document')).word,true);
  await f.settled();
  assert.match(f.messages.at(-1).text,/What should/);
  assert.equal(f.edits.length,0);
  assert.equal(f.calls.length,0);
  assert.equal((await f.send('just make it about you cody')).word,true);
  await f.settled();
  assert.match(f.calls[0].args.text,/proper document[\s\S]*about you cody/);
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

test('attached formatting references survive a clarification without becoming editable targets',async()=>{
  const file='C:\\Docs\\reference.docx';
  const layouts=[{name:'reference.docx',paragraphs:[{paragraph:1,style:'Heading1',pageBreak:true}]}];
  const drafts=[];
  const session=new WordSession({
    controller:{permissions:()=>({filesRead:true}),readWord:async()=>({target,context:{paragraphs:[]}}),
      execute:async(action,args)=>{assert.equal(args.target,target);return {result:{document:target.document}};}},
    readReferenceLayout:async reference=>{assert.equal(reference,file);return layouts[0];},
    engine:{request:async(command,args)=>{
      if(command==='attachments-text'){assert.deepEqual(args.files,[file]);return {context:'Reference paragraphs'};}
      assert.equal(command,'word-plan');drafts.push(JSON.parse(args.context));
      return drafts.length===1?{question:'What should the document be about?'}:{steps:[paragraph]};
    }}
  });
  assert.equal((await session.run({chatId:'one',text:'Format this document like the attached example',files:[file]})).question,true);
  await session.run({chatId:'one',text:'Make it about Cody'});
  assert.deepEqual(drafts.map(draft=>draft.referenceLayouts),[layouts,layouts]);
});

test('unsupported Word operations explain the limit without dispatching a background agent',async()=>{
  const f=fixture({planner:()=>({unsupported:'Editable charts are outside the supported steps.'})});
  await f.send('make an editable chart in this Word document','plugin:word');await f.settled();
  assert.equal(f.edits.length,0);
  assert.deepEqual(f.calls.map(call=>call.command),['word-plan']);
  assert.match(f.messages.at(-1).text,/Editable charts.*Computer Use/);
});

test('Word drafting through an inline mention never becomes literal instruction text or a background job',async()=>{
  const f=fixture({planner:()=>({steps:[paragraph]})});
  await f.send('write a report about C.O.D.Y.','plugin:word');await f.settled();
  assert.equal(f.calls.length,1);
  assert.equal(f.edits.length,1);
  assert.equal(f.edits[0].args.plan.steps[0].text,paragraph.text);
});

test('generic writing and introductions work in Word without the AI connection',async()=>{
  for(const text of [
    'Can you write something introducing yourself in this Word document, please?',
    'write something in this document',
    'write some stuff in the document',
    'tell me about yourself in the word doc',
    'Could you describe yourself in my open Word document?',
    'In this Word doc, tell me about yourself.',
    'Tell me in the Word doc about yourself.'
  ]){
    const f=fixture({planner:()=>assert.fail('Generic writing should work locally')});
    assert.equal((await f.send(text)).word,true);
    await f.settled();
    assert.equal(f.calls.length,0);
    assert.equal(f.edits.length,1);
    assert.match(f.edits[0].args.plan.steps[0].text,/I’m C\.O\.D\.Y\./);
  }
});

test('ordinary chat and requests about Word are kept out of document edits',()=>{
  const session=new WordSession({controller:{},engine:{}});
  for(const text of ['Tell me about yourself','Tell me about Microsoft Word','Explain what is written in this Word doc'])
    assert.equal(session.matches(text,'one','',null),false,text);
});

const earlierWordAttempt=[
  {id:'prior-request',role:'user',text:'tell me about yourself in the word doc'},
  {id:'unsafe-field',role:'assistant',text:"I didn't fill that in, that field didn't look safe to type into."},
  {id:'prior-retry',role:'user',text:'just do it'},
  {id:'old-agent',role:'assistant',text:'I’ll try direct control to focus Word and type.'}
];

test('a confirmation after the old Word failure writes locally once',async()=>{
  const f=fixture({history:earlierWordAttempt});
  assert.equal((await f.send('just do it')).word,true);
  await f.settled();
  assert.match(f.edits[0].args.plan.steps[0].text,/I’m C\.O\.D\.Y\./);
  assert.equal(f.calls.length,0);
  await f.send('try again');await f.settled();
  assert.equal(f.edits.length,1);
  assert.match(f.messages.at(-1).text,/already updated/);
});

test('an older attempt with an uncertain result does not replay into a populated document',async()=>{
  const f=fixture({history:earlierWordAttempt,paragraphs:[paragraph]});
  assert.equal((await f.send('just do it')).word,true);
  await f.settled();
  assert.equal(f.edits.length,0);
  assert.equal(f.calls.length,0);
  assert.match(f.messages.at(-1).text,/already has content/);
  const session=new WordSession({controller:{},engine:{}});
  assert.equal(session.followUp('just do it',[...earlierWordAttempt,{role:'user',text:'Tell me a joke'}]),null);
});

test('a spoken confirmation of the Word request is handled before agent submission',async()=>{
  const text='just do it';
  const f=fixture({voiceText:text,history:earlierWordAttempt});
  await f.invoke('native-begin');
  const turn=f.calls[0].args.turn;
  f.engine.emit('classify-utility',{turn,text});
  assert.equal(f.calls[1].args.handled,true);
  await f.invoke('native-end');
  assert.equal(f.edits.length,1);
  assert.deepEqual(f.calls.map(call=>call.command),['begin','utility-route','end']);
});

test('typed and spoken window switches take the local route without a model request',async()=>{
  const text='Switch to Word',actions=[];
  const utilities=new IslandUtilities({showCard(){},controller:{async execute(action,args){
    actions.push({action,args});return {ok:true,result:{...args,verified:true}};
  }}});
  const typed=fixture({utilities});
  assert.equal((await typed.send(text)).utility,true);
  await typed.settled();
  assert.deepEqual(typed.calls,[]);
  assert.match(typed.messages.at(-1).text,/Focused Word/);
  const spoken=fixture({utilities,voiceText:text});
  await spoken.invoke('native-begin');
  spoken.engine.emit('classify-utility',{turn:spoken.calls[0].args.turn,text});
  assert.equal(spoken.calls[1].args.handled,true);
  await spoken.invoke('native-end');
  assert.deepEqual(spoken.calls.map(call=>call.command),['begin','utility-route','end','speak']);
  assert.deepEqual(actions,[{action:'window.manage',args:{app:'word',operation:'focus'}},{action:'window.manage',args:{app:'word',operation:'focus'}}]);
});

test('literal Word typing works without a plugin mention and uses the exact supplied text',async()=>{
  const f=fixture({planner:()=>assert.fail('Literal typing should work locally')});
  assert.equal((await f.send('Could you type “One line.\nAnother line!” in Word, please?')).word,true);
  await f.settled();
  assert.equal(f.calls.length,0);
  assert.deepEqual(f.edits,[{action:'word.edit',args:{operation:'insert',text:'One line.\nAnother line!'}}]);
});

test('“write in this Word doc” and “about yourself” complete locally, even during engine loss',async()=>{
  const f=fixture({planner:()=>assert.fail('The reported requests should not require the engine')});
  assert.equal((await f.send('write in this word doc')).word,true);
  await f.settled();
  assert.match(f.messages.at(-1).text,/What should I write about/);
  assert.equal(f.edits.length,0);
  assert.equal((await f.send('about yourself')).word,true);
  f.engine.emit('offline');
  await f.settled();
  assert.equal(f.calls.length,0);
  assert.equal(f.edits.length,1);
  assert.match(f.edits[0].args.plan.steps[0].text,/I’m C\.O\.D\.Y\./);
  assert.match(f.messages.at(-1).text,/Updated Notes.docx/);
});

test('original prose uses a text-only draft while compound edits keep the full planner',async()=>{
  const f=fixture({planner:()=>({steps:[paragraph]})});
  await f.send('write a short paragraph about bee gardens in Word');await f.settled();
  await f.send('describe the solar system in this Word doc');await f.settled();
  await f.send('write a short paragraph about bee gardens in Word and save the document');await f.settled();
  await f.send('tell me about yourself in the Word doc and then save it');await f.settled();
  assert.deepEqual(f.calls.map(call=>call.args.insertOnly),[true,true,false,false]);
  assert.equal(f.edits.length,4);
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
