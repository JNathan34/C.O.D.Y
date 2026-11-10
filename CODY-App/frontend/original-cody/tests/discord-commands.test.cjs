'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseDiscordCommand,runDiscordCommand}=require('../src/control/discord');
const {ComputerController,ensureArgs}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
const {installNativeIpc}=require('../src/native-ipc');

test('Discord commands recognize typed and spoken mute, deafen, share and disconnect requests',()=>{
  for(const [input,feature,state] of [
    ['mute Discord','mute','on'],['unmute Discord','mute','off'],['toggle mute on Discord','mute','toggle'],
    ['defen on Discord','deafen','on'],['un defen on Discord','deafen','off'],['toggle defen on Discord','deafen','toggle'],
    ['Discord mute','mute','on'],['Discord defen','deafen','on'],['Discord undeafen','deafen','off'],
    ["mute Discord's microphone",'mute','on'],['Discord, unmute my mic','mute','off'],
    ['turn on deafen on Discord','deafen','on'],['switch defen off in Discord','deafen','off'],
    ['CODY, please undeafen me on Discord','deafen','off']
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.voice',args:{feature,state}},input);
  for(const [input,args] of [
    ['share screen',{screen:1}],['share screen 2',{screen:2}],['share screen two',{screen:2}],
    ['CODY, please share my screen.',{screen:1}],['start sharing screen number three',{screen:3}],
    ['share my screen on Discord',{screen:1}],['share screen 1 on Discord',{screen:1}],
    ['share screen 2 on Discord',{screen:2}],['share screen two on Discord',{screen:2}],
    ['Discord screenshare',{picker:true}],['screen share on Discord',{picker:true}],
    ['Discord screen-share screen two',{screen:2}],['Discord share Firefox',{app:'Firefox'}],
    ['start sharing monitor #2 in Discord',{screen:2}],
    ['share Firefox on Discord',{app:'Firefox'}],['share the Google Chrome window on Discord',{app:'Google Chrome'}]
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.share',args},input);
  for(const input of [
    'leave Discord','disconnect from Discord','CODY, please disconnect me from Discord',
    'leave my Discord voice channel','leave the call on Discord','hang up on Discord',
    'end the Discord call','Discord, disconnect','Discord leave voice channel'
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.leave',args:{}},input);
  for(const input of [
    'stop screen share','stop sharing my screen','Discord stop screenshare',
    'stop streaming on Discord','stop Discord stream','CODY, please stop sharing in Discord'
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.stop-share',args:{}},input);
  for(const input of ['mute','mute Spotify','how do I mute Discord','do not unmute Discord','mute Discord and play music','Discord, do not deafen','toggle unmute on Discord','share screen 0 on Discord','share screen 33 on Discord','share screen 100 on Discord','share Firefox or Chrome on Discord',
    'share Firefox','share screen 0','share screen 33','share screen window','share screen on Zoom','share screen and open Chrome','do not share screen','how do I share screen','tell me share screen','do you know share screen',
    'leave Discord server','disconnect from Wi-Fi','close Discord','leave the call','don’t leave Discord','tell me how to leave Discord','do you know leave Discord','leave Discord and close the app',
    'stop screen recording','stop streaming','stop screen share on Zoom','don’t stop screen share','tell me how to stop screen share','stop screen share and leave Discord'])
    assert.equal(parseDiscordCommand(input),null,input);
});

test('Discord control checks permissions and is unavailable to agent tools',async()=>{
  let calls=0;
  let permissions={enabled:true,level:'custom',audio:true,screenshots:true,uiAutomation:true};
  const controller=new ComputerController({readPermissions:()=>permissions,runner:async()=>{calls++;return '{"enabled":true}';}});
  const voice={feature:'mute',state:'on'};
  await assert.rejects(controller.execute('discord.voice',voice,{origin:'ai-chat',verifiedUserIntent:true}),/direct C\.O\.D\.Y\. command/);
  await assert.rejects(controller.execute('discord.leave',{}, {origin:'ai-chat',verifiedUserIntent:true}),/direct C\.O\.D\.Y\. command/);
  assert.equal(controller.catalog().some(action=>action.name.startsWith('discord.')),false);
  permissions={...permissions,screenshots:false};
  await assert.rejects(controller.execute('discord.share',{screen:2},{origin:'chat'}),/screenshots.*disabled/);
  permissions={...permissions,uiAutomation:false};
  await assert.rejects(controller.execute('discord.voice',voice,{origin:'chat'}),/uiAutomation.*disabled/);
  await assert.rejects(controller.execute('discord.leave',{}, {origin:'chat'}),/uiAutomation.*disabled/);
  assert.throws(()=>ensureArgs('discord.leave',{channel:'another call'}));
  assert.throws(()=>ensureArgs('discord.share',{screen:1,app:'Firefox'}));
  assert.throws(()=>ensureArgs('discord.share',{picker:true,screen:1}));
  assert.throws(()=>ensureArgs('discord.share',{app:"Firefox'; Start-Process calc"}));
  assert.equal(calls,0);
  permissions={...permissions,uiAutomation:true};
  const result=await controller.execute('discord.voice',voice,{origin:'chat'});
  assert.equal(result.result.reply,'Muted.');
  assert.equal(calls,1);
});

test('Discord disconnect reports whether it left an active call',async()=>{
  const run=status=>runDiscordCommand('discord.leave',{}, {runner:async script=>{
    assert.match(script,/-Request '\{"leave":true\}'/);
    return JSON.stringify({status});
  }});
  assert.deepEqual(await run('left'),{reply:'Disconnected.',card:'Disconnected'});
  assert.deepEqual(await run('not-connected'),{reply:'No active call.',card:'No active call'});
  await assert.rejects(run('unknown'),/did not confirm/);
});

test('stopping a Discord share uses UI control and requires Discord to confirm the result',async()=>{
  let status='stopped';
  const permissions={enabled:true,level:'custom',uiAutomation:true,screenshots:false};
  const controller=new ComputerController({readPermissions:()=>permissions,runner:async script=>{
    assert.match(script,/-Request '\{"stopShare":true\}'/);
    return JSON.stringify({status});
  }});
  const stop=()=>controller.execute('discord.stop-share',{}, {origin:'chat'});
  await assert.rejects(controller.execute('discord.stop-share',{}, {origin:'ai-chat',verifiedUserIntent:true}),/direct C\.O\.D\.Y\. command/);
  assert.throws(()=>ensureArgs('discord.stop-share',{channel:'another call'}));
  assert.deepEqual((await stop()).result,{reply:'Screen share stopped.',card:'Share stopped'});
  status='not-sharing';
  assert.equal((await stop()).result.card,'No active share');
  status='unknown';
  await assert.rejects(stop(),/did not confirm/);
  permissions.uiAutomation=false;
  await assert.rejects(stop(),/uiAutomation.*disabled/);
});

test('Discord replies distinguish selected, requested and confirmed stream states',async()=>{
  const args={screen:2};
  const run=status=>runDiscordCommand('discord.share',args,{runner:async()=>JSON.stringify({status})});
  assert.equal((await run('selected')).reply,'Check the preview, then choose Go Live.');
  assert.equal((await run('review')).reply,'Select screen 2 in Discord.');
  assert.equal((await run('requested')).reply,'Check if the stream started.');
  assert.equal((await run('started')).reply,'Sharing screen 2.');
  const openPicker=status=>runDiscordCommand('discord.share',{picker:true},{runner:async()=>JSON.stringify({status})});
  assert.equal((await openPicker('picker')).card,'Pick source');
  await assert.rejects(openPicker('started'),/did not confirm that the share picker opened/);
  await assert.rejects(runDiscordCommand('discord.voice',{feature:'mute',state:'off'},{runner:async()=>'{"enabled":true}'}),/did not confirm/);
  const unchanged=await runDiscordCommand('discord.voice',{feature:'mute',state:'on'},{runner:async()=>'{"enabled":true,"changed":false}'});
  assert.deepEqual(unchanged,{reply:'Muted.',card:'Muted',micMuted:true,micChanged:false});
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
    quickCard:{kind:'utility',source:'discord',text:'Muted',detail:'Discord',icon:'mic',micMuted:true,micChanged:true,expiresAt:Date.now()+10000},
    capturePending:false,art:{}
  });
  vm.runInContext(source.slice(source.indexOf('  function renderTimer('),source.indexOf("  document.addEventListener('cody:update-state'")),context);
  context.renderTimer();
  assert.equal($('island-info').hidden,false);
  assert.equal($('island-info-text').textContent,'Muted');
  assert.equal($('island-info-icon').dataset.icon,'discord-mic');
  assert.equal($('island-info').dataset.discordMic,'muted');
  assert.equal($('island-info').dataset.discordMicChanged,'true');
  assert.equal($('island-timer').hidden,true);

  context.capture={status:'recording',elapsedMs:1000,capturedAt:Date.now()};
  context.renderTimer();
  assert.equal($('island-recording-controls').hidden,false);
  assert.equal($('island-info-detail').textContent,'Discord · Muted');
  assert.equal($('island-info').dataset.discordMic,'');

  context.capture={status:'idle'};
  context.quickCard={...context.quickCard,text:'Unmuted',micMuted:false};
  context.renderTimer();
  assert.equal($('island-info-text').textContent,'Unmuted');
  assert.equal($('island-info').dataset.discordMic,'unmuted');
  assert.equal($('island-info').dataset.discordMicChanged,'true');

  context.quickCard=null;
  context.renderTimer();
  assert.equal($('island-info-text').textContent,'Listening…');
  assert.equal($('island-info').dataset.discordMic,'');
});

test('typed and spoken Discord commands show progress and results in the Island and bypass AI',async()=>{
  for(const {input,voice,action,args,reply,card,progress,output,micMuted} of [
    {input:'mute Discord',voice:true,action:'discord.voice',args:{feature:'mute',state:'on'},reply:'Muted.',card:'Muted',progress:'Muting…',output:{enabled:true,changed:true},micMuted:true},
    {input:'unmute Discord',voice:true,action:'discord.voice',args:{feature:'mute',state:'off'},reply:'Unmuted.',card:'Unmuted',progress:'Unmuting…',output:{enabled:false,changed:true},micMuted:false},
    {input:'Discord defen',voice:true,action:'discord.voice',args:{feature:'deafen',state:'on'},reply:'Deafened.',card:'Deafened',progress:'Deafening…',output:{enabled:true,changed:true}},
    {input:'Discord undeafen',voice:true,action:'discord.voice',args:{feature:'deafen',state:'off'},reply:'Undeafened.',card:'Undeafened',progress:'Undeafening…',output:{enabled:false,changed:true}},
    {input:'Discord screenshare',voice:true,action:'discord.share',args:{picker:true},reply:'Pick a source in Discord.',card:'Pick source',progress:'Opening…',output:{status:'picker'}},
    {input:'share screen',voice:true,action:'discord.share',args:{screen:1},reply:'Sharing screen 1.',card:'Sharing',progress:'Starting share…',output:{status:'started'}},
    {input:'disconnect from Discord',voice:true,action:'discord.leave',args:{},reply:'Disconnected.',card:'Disconnected',progress:'Disconnecting…',output:{status:'left'}},
    {input:'leave Discord',voice:false,action:'discord.leave',args:{},reply:'No active call.',card:'No active call',progress:'Disconnecting…',output:{status:'not-connected'}},
    {input:'stop screen share',voice:true,action:'discord.stop-share',args:{},reply:'Screen share stopped.',card:'Share stopped',progress:'Stopping share…',output:{status:'stopped'}},
    ...[false,true].map(voice=>({input:'share screen two',voice,action:'discord.share',args:{screen:2},reply:'Sharing screen 2.',card:'Sharing',progress:'Starting share…',output:{status:'started'}}))
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
      return {ok:true,result:await runDiscordCommand(action,args,{runner:async()=>JSON.stringify(output)})};
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
    assert.equal(calls.find(call=>call.command==='speak')?.args.text,voice?reply:undefined);
    assert.equal(cards[0].micMuted,undefined);
    assert.equal(cards[1].micMuted,micMuted);
    if(micMuted!==undefined)assert.equal(cards[1].micChanged,true);
  }
});
