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

test('the reported Plex transcripts and an explicit Plex mention stay on the local viewer lookup',async()=>{
  let text="Who's watching Plek?";
  const engine=new EventEmitter(),calls=[],handlers=new Map(),messages=[];
  engine.connected=true;
  engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
  engine.refresh=()=>assert.fail('Plex activity should stay local');
  let lookups=0;
  const utilities=new IslandUtilities({selfHosted:{plexSessions:async()=>{lookups++;return {count:0,sessions:[]};}},showCard(){}});
  const store={data:{settings:{},activeChatId:'chat'},chat:()=>({messages}),
    addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},save(){},publicState:()=>({})};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  assert.equal((await invoke('send-message',{chatId:'chat',text})).utility,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lookups,1);
  assert.match(messages.at(-1).text,/Nobody is watching Plex/);
  assert.deepEqual(calls,[]);
  assert.equal(utilities.match('Is washing collect?',{spoken:true}),null);
  for(text of ["Who's watching Plek?",'Is washing collect?','Plax plugin.']){
    await invoke('native-begin');
    const turn=calls.filter(call=>call.command==='begin').at(-1).args.turn;
    engine.emit('transcript',{turn,text});
    engine.emit('classify-utility',{turn,text});
    await invoke('native-end');
    assert.equal(calls.find(call=>call.command==='utility-route'&&call.args.turn===turn).args.handled,true);
    assert.match(messages.at(-1).text,/Nobody is watching Plex/);
  }
  assert.equal(lookups,4);
  assert.equal((await invoke('mentions-list',true)).items.find(item=>item.name==='Plex').id,'plugin:plex');
  assert.equal((await invoke('send-message',{chatId:'chat',text:'Who’s watching?',capabilityId:'plugin:plex'})).utility,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(lookups,5);
  assert.ok(!calls.some(call=>['submit','mentions-check'].includes(call.command)));
});

test('spoken Plex availability paraphrases and misheard service names call Overseerr',async()=>{
  let text;
  const engine=new EventEmitter(),calls=[],queries=[],handlers=new Map(),messages=[];
  engine.connected=true;
  engine.request=async(command,args)=>{
    calls.push({command,args});
    if(command==='end'){
      const {turn}=calls.filter(call=>call.command==='begin').at(-1).args;
      engine.emit('transcript',{turn,text});
      engine.emit('classify-utility',{turn,text});
      const handled=calls.find(call=>call.command==='utility-route'&&call.args.turn===turn)?.args.handled;
      return handled?{utilityText:text}:{transcript:text};
    }
    return {};
  };
  const utilities=new IslandUtilities({
    selfHosted:{plexSessions:async()=>assert.fail('A title lookup must go through Overseerr')},
    overseerrRequests:{lookup:async query=>{queries.push(query);return {reply:'Overseerr shows this title is available on Plex.'};}},
    showCard(){}
  });
  const store={data:{settings:{},activeChatId:'chat'},chat:()=>({messages}),
    addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},
    save(){},publicState:()=>({})};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},
    getState:()=>({}),getWindow:()=>({webContents})});
  const invoke=name=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame});

  for(text of ['Is the Odyssey on Plea?','Is the movie The Odyssey on play?']){
    // Both transcriptions must work on the first turn in a chat.
    messages.length=0;
    await invoke('native-begin');
    await invoke('native-end');
    assert.equal(calls.filter(call=>call.command==='utility-route').at(-1).args.handled,true,text);
    assert.match(messages.at(-1).text,/Overseerr shows this title is available/,text);
  }
  assert.equal(utilities.match('Is Dune on Play?'),null);
  assert.equal(utilities.match('Is Dune on Google Play?',{spoken:true,availabilityContext:true}),null);
  assert.equal(utilities.match('Is the actor on a plea deal?',{spoken:true}),null);
  assert.equal(utilities.match('Is the movie The Odyssey on Plex?').args.query,'The Odyssey');
  assert.equal(utilities.match('Is The Movie Critic on Plex?').args.query,'The Movie Critic');

  const prompts=['Is the new Spider Man movie complex?', 'Is the latest Spider Man movie omplex?',
    'Can I watch the newest Spider-Man film through Plex yet?', 'Does Plex have the latest Spider-Man movie?'];
  for(text of [...prompts,'What about The Odyssey?','Is the odysseum plex?','Is Arrival on play?']){
    await invoke('native-begin');
    await invoke('native-end');
    assert.equal(calls.filter(call=>call.command==='utility-route').at(-1).args.handled,true,text);
    assert.match(messages.at(-1).text,/Overseerr shows this title is available/,text);
  }
  assert.deepEqual(queries,[
    {query:'the Odyssey',latest:false,type:null,year:''},
    {query:'The Odyssey',latest:false,type:null,year:''},
    ...prompts.map(()=>({query:'Spider-Man',latest:true,type:'movie',year:''})),
    {query:'The Odyssey',latest:false,type:null,year:''},
    {query:'the Odyssey',latest:false,type:null,year:''},
    {query:'Arrival',latest:false,type:null,year:''}
  ]);
  assert.equal(calls.some(call=>call.command==='submit'),false);
  text='What is on my screen?';
  await invoke('native-begin');
  await invoke('native-end');
  assert.equal(calls.filter(call=>call.command==='utility-route').at(-1).args.handled,false);
});
