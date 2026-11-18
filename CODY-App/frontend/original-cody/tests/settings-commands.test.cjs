'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {parseSettingsCommand}=require('../src/settings-commands');
const {IslandUtilities}=require('../src/island-utilities');
const {installNativeIpc}=require('../src/native-ipc');

test('settings requests recognize app pages, searches and exact preference values',()=>{
  assert.equal(parseSettingsCommand('Cody, show me voice settings').destination,'voice');
  assert.equal(parseSettingsCommand('show me settings').destination,'general');
  assert.equal(parseSettingsCommand('find output device').query,'Audio output');
  assert.equal(parseSettingsCommand('show me font size').query,'Font size');
  assert.equal(parseSettingsCommand('turn off subtitles').value,false);
  assert.equal(parseSettingsCommand('set voice volume to 250 percent').value,2.5);
  assert.equal(parseSettingsCommand('set cursor size to 170%').value,undefined);
  for(const text of ['how do I turn on subtitles','turn on subtitles and change my password','set an API key to anything','find my photos'])assert.equal(parseSettingsCommand(text),null);
  const utilities=new IslandUtilities({appSettings:{}});
  assert.equal(utilities.match('open display settings').action,'system.settings.open');
});

test('typed and spoken settings requests use the local utility path',async()=>{
  for(const [text,spoken] of [
    ['open Accessibility settings',false],['show me font size',true],
    ['turn on subtitles',false],['set voice volume to 200%',true]
  ]){
    const messages=[],requests=[],navigations=[],changes=[],handlers=new Map();
    const engine=new EventEmitter();engine.status={state:'Idle'};
    engine.request=async(command,args)=>{requests.push({command,args});return command==='end'?{utilityText:text}:{};};
    const store={data:{settings:{},activeChatId:'chat'},chat:()=>({messages}),save(){},publicState:()=>({}),addMessage(_chat,role,text){
      const message={id:String(messages.length),role,text};messages.push(message);return message;
    }};
    const utilities=new IslandUtilities({appSettings:{show:value=>navigations.push(value),update:patch=>{changes.push(patch);return patch;}}});
    const webContents={mainFrame:{}};
    installNativeIpc({ipcMain:{handle:(name,handle)=>handlers.set(name,handle),removeHandler(){}},engine,store,utilities,sendUI(){},getWindow:()=>({webContents})});
    const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
    if(spoken){
      await invoke('native-begin');
      engine.emit('classify-utility',{turn:requests.find(item=>item.command==='begin').args.turn,text});
      assert.equal(requests.find(item=>item.command==='utility-route').args.handled,true);
      await invoke('native-end');
    }else{
      await invoke('send-message',{chatId:'chat',text});
      await new Promise(setImmediate);
    }
    const route=parseSettingsCommand(text);
    if(route.action==='app-settings.open')assert.deepEqual(navigations,[{tab:route.destination,query:route.query}]);
    else assert.deepEqual(changes,[{[route.key]:route.value}]);
    assert.equal(requests.some(item=>item.command==='submit'),false);
    assert.equal(messages.at(-1).role,'assistant');
  }
});
