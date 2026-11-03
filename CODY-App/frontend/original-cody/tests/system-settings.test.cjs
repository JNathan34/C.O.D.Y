'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseSystemCommand,buildSystemScript}=require('../src/control/system-settings');
const {parseDirectAction}=require('../src/control/parser');
const {ComputerController,ensureArgs}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
const {normalizePermissions,availableActions}=require('../src/control/policy');

for(const [text,action,args] of [
 ['Cody, could you please turn on Bluetooth?','system.radio.set',{kind:'bluetooth',enabled:true}],
 ['turn Bluetooth off','system.radio.set',{kind:'bluetooth',enabled:false}],
 ['enable blue tooth','system.radio.set',{kind:'bluetooth',enabled:true}],
 ['switch off Wi-Fi','system.radio.set',{kind:'wifi',enabled:false}],
 ['turn my Wi Fi on','system.radio.set',{kind:'wifi',enabled:true}],
 ['check Bluetooth status','system.radio.status',{kind:'bluetooth'}],
 ['is Wi-Fi on?','system.radio.status',{kind:'wifi'}],
 ['turn on power saver','system.power.set',{mode:'efficiency'}],
 ['turn power saving mode off','system.power.set',{mode:'balanced'}],
 ['set power mode to best performance','system.power.set',{mode:'performance'}],
 ['use balanced mode','system.power.set',{mode:'balanced'}],
 ['show power mode','system.power.status',{}],
 ['set the screen brightness to 50 percent','system.brightness.set',{level:50}],
 ['brightness 0%','system.brightness.set',{level:0}],
 ['brightness 100%','system.brightness.set',{level:100}],
 ['check display brightness','system.brightness.status',{}],
 ['open Bluetooth settings','system.settings.open',{page:'bluetooth'}],
 ['turn on energy saver','system.settings.open',{page:'energySaver'}],
 ['turn battery saver off','system.settings.open',{page:'energySaver'}]
])test('local Windows command: '+text,()=>{
 const expected={action,args};assert.deepEqual(parseSystemCommand(text),expected);assert.deepEqual(parseDirectAction(text),expected);
 assert.equal(new IslandUtilities({}).match(text).action,action);
});

test('quoted, negated, explanatory, compound and out-of-range requests are not executed as direct commands',()=>{
 for(const text of ['do not turn on Bluetooth','how do I turn on Bluetooth','"turn on Bluetooth"','turn on Bluetooth and delete files','turn off Wi-Fi; calc.exe','set brightness to 101%','set brightness to -1%','set power mode to something else','show Wi-Fi'])assert.equal(parseSystemCommand(text),null,text);
});

test('system setting arguments cannot inject commands or open arbitrary URLs',()=>{
 for(const [action,args] of [['system.radio.set',{kind:"wifi';calc.exe",enabled:true}],['system.radio.set',{kind:'wifi',enabled:'true'}],['system.power.set',{mode:'__proto__'}],['system.brightness.set',{level:101}],['system.brightness.set',{level:50.5}],['system.settings.open',{page:'https://example.com'}],['system.power.status',{execute:'calc.exe'}]])assert.throws(()=>ensureArgs(action,args));
});

test('disabled and custom permissions stop mutations before the Windows runner',async()=>{
 let calls=0;
 for(const perms of [{enabled:false},{enabled:true,level:'custom',systemSettings:false}]){
  const c=new ComputerController({readPermissions:()=>perms,runner:async()=>{calls++;}});
  await assert.rejects(c.execute('system.radio.set',{kind:'bluetooth',enabled:true}),/disabled/);
 }
 assert.equal(calls,0);
 const catalogue=availableActions(normalizePermissions({enabled:true,level:'custom',systemInfo:true,systemSettings:false}));
 assert.equal(catalogue.find(x=>x.name==='system.radio.status').enabled,true);
 assert.equal(catalogue.find(x=>x.name==='system.radio.set').enabled,false);
});

test('ask profile can decline a setting change without running it',async()=>{
 let calls=0,confirmed;
 const c=new ComputerController({readPermissions:()=>({enabled:true,level:'ask',systemSettings:true}),confirm:async request=>{confirmed=request;return false;},runner:async()=>{calls++;}});
 assert.deepEqual(await c.execute('system.radio.set',{kind:'wifi',enabled:false},{origin:'chat'}),{cancelled:true});
 assert.equal(confirmed.action,'system.radio.set');assert.equal(calls,0);
});

test('verified Windows results become concise cards and replies through the real controller',async()=>{
 const scripts=[],cards=[];
 const c=new ComputerController({readPermissions:()=>({enabled:true,level:'custom',systemSettings:true}),runner:async script=>{scripts.push(script);return JSON.stringify({message:'Bluetooth is on.',enabled:true});}});
 const u=new IslandUtilities({controller:c,showCard:card=>cards.push(card)});
 const result=await u.run('turn on Bluetooth');assert.equal(result.reply,'Bluetooth is on.');assert.equal(result.confirmation,'Bluetooth is on.');
 assert.equal(cards.at(-1).text,'Bluetooth is on.');assert.match(scripts[0],/SetStateAsync/);assert.match(scripts[0],/did not confirm/);
});

test('Windows failure and cancelled approval never produce a success acknowledgement',async()=>{
 for(const execute of [async()=>{throw Error('Windows denied Bluetooth control.');},async()=>({cancelled:true})]){
  const cards=[],u=new IslandUtilities({controller:{execute},showCard:card=>cards.push(card)});
  const r=await u.run('turn on Bluetooth');assert.ok(r.error||r.cancelled);assert.equal(cards.some(card=>card.text==='Bluetooth is on.'),false);
 }
});

test('setting scripts verify state and keep power mode separate from Energy saver',()=>{
 const power=buildSystemScript('system.power.set',{mode:'efficiency'});
 assert.match(power,/PowerSetUserConfiguredDCPowerMode/);assert.match(power,/PowerSetUserConfiguredACPowerMode/);assert.match(power,/Windows did not confirm/);
 const brightness=buildSystemScript('system.brightness.set',{level:60});assert.match(brightness,/WmiSetBrightness/);assert.match(brightness,/CurrentBrightness -ne 60/);
 const saver=buildSystemScript('system.settings.open',{page:'energySaver'});assert.match(saver,/ms-settings:batterysaver/);assert.match(saver,/no saver toggle has been changed/);assert.doesNotMatch(saver,/PowerSet|SetStateAsync/);
});

test('agent tool selection offers only the requested setting types and their status checks',()=>{
 const {allowedFor}=require('../src/control/tool-loop');
 const perms=normalizePermissions({enabled:true,level:'custom',systemInfo:true,systemSettings:true});
 const allowed=allowedFor('turn on Bluetooth and set brightness to 50%',perms);
 for(const name of ['system.radio.set','system.radio.status','system.brightness.set','system.brightness.status'])assert.ok(allowed.includes(name));
 assert.equal(allowed.includes('system.power.set'),false);
 for(const request of ['what is Bluetooth','do not turn on Bluetooth','how do I turn on Bluetooth'])assert.equal(allowedFor(request,perms).includes('system.radio.set'),false);
 assert.equal(allowedFor('turn on Bluetooth',{...perms,systemSettings:false}).includes('system.radio.set'),false);
});

test('typed and spoken system controls use the local route without an AI submission',async()=>{
 const {EventEmitter}=require('node:events');const {installNativeIpc}=require('../src/native-ipc');
 for(const voice of [false,true]){
  const text='turn on Bluetooth',engine=new EventEmitter(),handlers=new Map(),calls=[],actions=[],messages=[];engine.connected=true;engine.status={state:'Idle'};
  engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
  const utilities=new IslandUtilities({controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true,result:{message:'Bluetooth is on.'}};}},showCard(){}}),settings={voiceAutoSpeak:false};
  const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},updateMessage(){},save(){},publicState:()=>({settings})};
  const webContents={mainFrame:{}};installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  if(voice){await invoke('native-begin');const turn=calls.find(call=>call.command==='begin').args.turn;engine.emit('classify-utility',{turn,text});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);await invoke('native-end');}
  else {await invoke('send-message',{chatId:'chat',text});await new Promise(resolve=>setImmediate(resolve));}
  assert.deepEqual(actions,[{action:'system.radio.set',args:{kind:'bluetooth',enabled:true}}]);assert.equal(calls.some(call=>call.command==='submit'),false);
  assert.equal(messages.at(-1).text,'Bluetooth is on.');
 }
});
