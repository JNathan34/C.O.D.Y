'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseDiscordCommand,runDiscordCommand}=require('../src/control/discord');
const {ComputerController,ensureArgs}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
const {installNativeIpc}=require('../src/native-ipc');

test('Discord commands recognize typed and spoken mute, deafen and share requests',()=>{
  for(const [input,feature,state] of [
    ['mute Discord','mute','on'],['unmute Discord','mute','off'],['toggle mute on Discord','mute','toggle'],
    ['defen on Discord','deafen','on'],['un defen on Discord','deafen','off'],['toggle defen on Discord','deafen','toggle'],
    ['Discord mute','mute','on'],['Discord defen','deafen','on'],['Discord undeafen','deafen','off'],
    ["mute Discord's microphone",'mute','on'],['Discord, unmute my mic','mute','off'],
    ['turn on deafen on Discord','deafen','on'],['switch defen off in Discord','deafen','off'],
    ['CODY, please undeafen me on Discord','deafen','off']
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.voice',args:{feature,state}},input);
  for(const [input,args] of [
    ['share my screen on Discord',{screen:1}],['share screen 1 on Discord',{screen:1}],
    ['share screen 2 on Discord',{screen:2}],['share screen two on Discord',{screen:2}],
    ['Discord screenshare',{picker:true}],['screen share on Discord',{picker:true}],
    ['Discord screen-share screen two',{screen:2}],['Discord share Firefox',{app:'Firefox'}],
    ['start sharing monitor #2 in Discord',{screen:2}],
    ['share Firefox on Discord',{app:'Firefox'}],['share the Google Chrome window on Discord',{app:'Google Chrome'}]
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.share',args},input);
  for(const input of ['mute','mute Spotify','how do I mute Discord','do not unmute Discord','mute Discord and play music','Discord, do not deafen','toggle unmute on Discord','share screen 0 on Discord','share screen 33 on Discord','share screen 100 on Discord','share Firefox or Chrome on Discord'])
    assert.equal(parseDiscordCommand(input),null,input);
});

test('Discord control checks permissions and is unavailable to agent tools',async()=>{
  let calls=0;
  let permissions={enabled:true,level:'custom',audio:true,screenshots:true,uiAutomation:true};
  const controller=new ComputerController({readPermissions:()=>permissions,runner:async()=>{calls++;return '{"enabled":true}';}});
  const voice={feature:'mute',state:'on'};
  await assert.rejects(controller.execute('discord.voice',voice,{origin:'ai-chat',verifiedUserIntent:true}),/direct C\.O\.D\.Y\. command/);
  assert.equal(controller.catalog().some(action=>action.name.startsWith('discord.')),false);
  permissions={...permissions,screenshots:false};
  await assert.rejects(controller.execute('discord.share',{screen:2},{origin:'chat'}),/screenshots.*disabled/);
  permissions={...permissions,uiAutomation:false};
  await assert.rejects(controller.execute('discord.voice',voice,{origin:'chat'}),/uiAutomation.*disabled/);
  assert.throws(()=>ensureArgs('discord.share',{screen:1,app:'Firefox'}));
  assert.throws(()=>ensureArgs('discord.share',{picker:true,screen:1}));
  assert.throws(()=>ensureArgs('discord.share',{app:"Firefox'; Start-Process calc"}));
  assert.equal(calls,0);
  permissions={...permissions,uiAutomation:true};
  const result=await controller.execute('discord.voice',voice,{origin:'chat'});
  assert.equal(result.result.reply,'Your Discord microphone is muted.');
  assert.equal(calls,1);
});

test('Discord replies distinguish selected, requested and confirmed stream states',async()=>{
  const args={screen:2};
  const run=status=>runDiscordCommand('discord.share',args,{runner:async()=>JSON.stringify({status})});
  assert.match((await run('selected')).reply,/choose Go Live to start/);
  assert.match((await run('review')).reply,/verify the preview/);
  assert.match((await run('requested')).reply,/confirm the stream started/);
  assert.equal((await run('started')).reply,'Discord is sharing screen 2.');
  const openPicker=status=>runDiscordCommand('discord.share',{picker:true},{runner:async()=>JSON.stringify({status})});
  assert.equal((await openPicker('picker')).card,'Pick source');
  await assert.rejects(openPicker('started'),/did not confirm that the share picker opened/);
  await assert.rejects(runDiscordCommand('discord.voice',{feature:'mute',state:'off'},{runner:async()=>'{"enabled":true}'}),/did not confirm/);
});

test('cancelling a local Discord command aborts its operation',async()=>{
  let signal;
  const cards=[];
  const utilities=new IslandUtilities({controller:{execute:(_action,_args,context)=>{
    signal=context.signal;
    return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false}),{once:true}));
  }},showCard:card=>cards.push(card)});
  const pending=utilities.run('share screen 2 on Discord');
  utilities.cancel();
  assert.equal(signal.aborted,true);
  assert.equal((await pending).cancelled,true);
  assert.deepEqual(cards.map(card=>card.text),['Starting share…','Cancelled']);
});

test('a failed Discord command replaces the progress card with a Discord error',async()=>{
  const cards=[],message='Permission audio is disabled';
  const utilities=new IslandUtilities({controller:{execute:async()=>{throw Error(message);}},showCard:card=>cards.push(card)});
  assert.deepEqual(await utilities.run('Discord unmute'),{handled:true,reply:message,error:true});
  assert.deepEqual(cards.map(({source,text})=>[source,text]),[['discord','Unmuting…'],['discord','Failed']]);
  assert.equal(cards.at(-1).tooltip,message);
});

test('the Island renders Discord feedback over listening and keeps recording controls available',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/island/renderer/assistant.js'),'utf8');
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,{dataset:{},classList:{add(){},remove(){},toggle(){}},removeAttribute(){},setAttribute(){}});
    return elements.get(id);
  };
  const context=vm.createContext({
    $,document:{body:$('body')},window:{CODYIcons:{set:(element,icon)=>element.dataset.icon=icon}},
    wakeListening:()=>true,tasks:{connected:false},island:{setMediaPlaying(){}},media:{available:false},
    timer:{status:'finished',deadline:Date.now()},capture:{status:'idle'},game:{active:false},monitors:{items:[]},
    quickCard:{kind:'utility',source:'discord',text:'Muted',detail:'Discord',icon:'mic',expiresAt:Date.now()+10000},
    capturePending:false,art:{}
  });
  vm.runInContext(source.slice(source.indexOf('  function renderTimer('),source.indexOf("  document.addEventListener('cody:update-state'")),context);
  context.renderTimer();
  assert.equal($('island-info').hidden,false);
  assert.equal($('island-info-text').textContent,'Muted');
  assert.equal($('island-timer').hidden,true);

  context.capture={status:'recording',elapsedMs:1000,capturedAt:Date.now()};
  context.renderTimer();
  assert.equal($('island-recording-controls').hidden,false);
  assert.equal($('island-info-detail').textContent,'Discord · Muted');

  context.capture={status:'idle'};
  context.quickCard=null;
  context.renderTimer();
  assert.equal($('island-info-text').textContent,'Listening…');
});

test('typed and spoken Discord commands show progress and results in the Island and bypass AI',async()=>{
  for(const {input,voice,action,args,reply,card,progress} of [
    {input:'Discord mute',voice:false,action:'discord.voice',args:{feature:'mute',state:'on'},reply:'Your Discord microphone is muted.',card:'Muted',progress:'Muting…'},
    {input:'Discord defen',voice:true,action:'discord.voice',args:{feature:'deafen',state:'on'},reply:'You are deafened on Discord.',card:'Deafened',progress:'Deafening…'},
    {input:'Discord screenshare',voice:true,action:'discord.share',args:{picker:true},reply:'Choose a screen or app in the Discord share picker.',card:'Pick source',progress:'Opening…'},
    ...[false,true].map(voice=>({input:'share screen two on Discord',voice,action:'discord.share',args:{screen:2},reply:'Discord is sharing screen 2.',card:'Sharing',progress:'Starting share…'}))
  ]){
    const engine=new EventEmitter(),handlers=new Map(),calls=[],actions=[],messages=[],cards=[];
    engine.connected=true;engine.status={state:'Idle'};
    engine.request=async(command,args)=>{
      calls.push({command,args});
      return command==='end'?{utilityText:input}:{};
    };
    const utilities=new IslandUtilities({controller:{execute:async(action,args,context)=>{
      actions.push({action,args,origin:context.origin});
      assert.equal(cards.at(-1)?.text,progress);
      return {ok:true,result:{reply,card}};
    }},showCard:(value,duration)=>cards.push({...value,duration})});
    const settings={voiceAutoSpeak:false};
    const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{
      const message={id:String(messages.length),role,text};messages.push(message);return message;
    },updateMessage(){},save(){},publicState:()=>({settings})};
    const webContents={mainFrame:{}};
    installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
    const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
    if(voice){
      await invoke('native-begin');
      const turn=calls.find(call=>call.command==='begin').args.turn;
      engine.emit('classify-utility',{turn,text:input});
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);
      await invoke('native-end');
    }else{
      await invoke('send-message',{chatId:'chat',text:input});
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.deepEqual(actions,[{action,args,origin:'chat'}]);
    assert.equal(calls.some(call=>call.command==='submit'),false);
    assert.deepEqual(cards.map(({source,text,detail})=>[source,text,detail]),[['discord',progress,'Discord'],['discord',card,'Discord']]);
    assert.ok(cards[0].duration>=30000);
    assert.equal(messages.at(-1).text,reply);
  }
});
