'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {parseDiscordCommand,runDiscordCommand}=require('../src/control/discord');
const {ComputerController,ensureArgs}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
const {installNativeIpc}=require('../src/native-ipc');

test('Discord commands recognize typed and spoken mute, deafen and share requests',()=>{
  for(const [input,feature,state] of [
    ['mute Discord','mute','on'],['unmute Discord','mute','off'],['toggle mute on Discord','mute','toggle'],
    ['defen on Discord','deafen','on'],['un defen on Discord','deafen','off'],['toggle defen on Discord','deafen','toggle'],
    ['CODY, please undeafen me on Discord','deafen','off']
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.voice',args:{feature,state}},input);
  for(const [input,args] of [
    ['share my screen on Discord',{screen:1}],['share screen 1 on Discord',{screen:1}],
    ['share screen 2 on Discord',{screen:2}],['share screen two on Discord',{screen:2}],
    ['share Firefox on Discord',{app:'Firefox'}],['share the Google Chrome window on Discord',{app:'Google Chrome'}]
  ])assert.deepEqual(parseDiscordCommand(input),{action:'discord.share',args},input);
  for(const input of ['mute','mute Spotify','how do I mute Discord','do not unmute Discord','mute Discord and play music','share screen 0 on Discord','share screen 33 on Discord','share Firefox or Chrome on Discord'])
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
  await assert.rejects(runDiscordCommand('discord.voice',{feature:'mute',state:'off'},{runner:async()=>'{"enabled":true}'}),/did not confirm/);
});

test('cancelling a local Discord command aborts its operation',async()=>{
  let signal;
  const utilities=new IslandUtilities({controller:{execute:(_action,_args,context)=>{
    signal=context.signal;
    return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false}),{once:true}));
  }},showCard(){}});
  const pending=utilities.run('share screen 2 on Discord');
  utilities.cancel();
  assert.equal(signal.aborted,true);
  assert.equal((await pending).cancelled,true);
});

test('typed and spoken Discord commands bypass AI submission',async()=>{
  for(const voice of [false,true]){
    const input='share screen two on Discord',engine=new EventEmitter(),handlers=new Map(),calls=[],actions=[],messages=[];
    engine.connected=true;engine.status={state:'Idle'};
    engine.request=async(command,args)=>{
      calls.push({command,args});
      return command==='end'?{utilityText:input}:{};
    };
    const utilities=new IslandUtilities({controller:{execute:async(action,args,context)=>{
      actions.push({action,args,origin:context.origin});
      return {ok:true,result:{reply:'Discord is sharing screen 2.',card:'Sharing on Discord'}};
    }},showCard(){}});
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
    assert.deepEqual(actions,[{action:'discord.share',args:{screen:2},origin:'chat'}]);
    assert.equal(calls.some(call=>call.command==='submit'),false);
    assert.equal(messages.at(-1).text,'Discord is sharing screen 2.');
  }
});
