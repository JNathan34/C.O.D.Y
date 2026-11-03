'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {IslandMonitors,monitorCommand}=require('../src/island-monitors');
const {IslandUtilities}=require('../src/island-utilities');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const weatherCard=(city='Derby',temperature=10)=>({reply:`Weather in ${city}.`,card:{kind:'weather',text:temperature+'°C',detail:city,icon:'cloud-sun',tooltip:'Current conditions'}});
test('clock and weather pin/hide commands coexist with RAM and preserve one-off questions',()=>{
 for(const text of ['show clock','show me the clock','pin clock','keep showing clock','show clock 24/7','show current time','display the time on the island'])assert.deepEqual(monitorCommand(text),{action:'show',metrics:['clock']},text);
 assert.deepEqual(monitorCommand('show clock and weather and RAM'),{action:'show',metrics:['clock','weather','ram']});
 assert.deepEqual(monitorCommand('show weather in Derby'),{action:'show',metrics:['weather'],weatherLocation:'derby'});
 assert.deepEqual(monitorCommand('show weather here'),{action:'show',metrics:['weather'],weatherLocation:''});
 assert.deepEqual(monitorCommand('hide clock and weather'),{action:'hide',metrics:['clock','weather']});
 assert.deepEqual(monitorCommand('stop showing weather'),{action:'hide',metrics:['weather']});
 for(const text of ["what's the time?","what's the weather in Derby?",'weather','clock','explain the weather','show weather and send an email','show weather tomorrow','"show clock"'])assert.equal(monitorCommand(text),null,text);
});
test('clock follows local 24-hour time and date, stays pinned and does not poll Windows sensors',async()=>{
 let time=new Date(2026,10,3,23,59).getTime(),sensors=0;
 const monitors=new IslandMonitors({now:()=>time,readWindows:async()=>{sensors++;return{};}});
 try{
  await monitors.execute(monitorCommand('show clock'));assert.equal(monitors.values.clock.text,'23:59');assert.equal(monitors.values.clock.icon,'clock');
  const date=monitors.values.clock.detail;time+=60000;monitors.sample();assert.equal(monitors.values.clock.text,'00:00');assert.notEqual(monitors.values.clock.detail,date);
  time+=7*24*60*60*1000;monitors.sample();assert.deepEqual(monitors.snapshot().metrics,['clock']);assert.equal(sensors,0);
 }finally{monitors.close();}
});
test('weather refreshes after five minutes, never expires as a pin, and uses its condition icon',async()=>{
 let time=10000,sensors=0;const calls=[];
 const monitors=new IslandMonitors({now:()=>time,readWindows:async()=>{sensors++;return{};},weather:{current:async location=>{calls.push(location);return weatherCard('Derby',10+calls.length);}}});
 try{
  assert.equal(calls.length,0);await monitors.execute(monitorCommand('show weather in Derby'));await flush();
  assert.deepEqual(calls,['derby']);assert.equal(monitors.values.weather.text,'11°C');assert.equal(monitors.values.weather.icon,'cloud-sun');
  time+=299999;monitors.sample();await flush();assert.equal(calls.length,1);
  time++;monitors.sample();await flush();assert.equal(calls.length,2);assert.equal(monitors.values.weather.text,'12°C');
  time+=86400000;monitors.sample();await flush();assert.deepEqual(monitors.snapshot().metrics,['weather']);assert.equal(calls.length,3);assert.equal(sensors,0);
 }finally{monitors.close();}
});
test('pins and weather location survive restart and can be removed individually',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-clock-weather-')),settingsFile=path.join(folder,'pins.json'),weather={current:async()=>weatherCard()};let monitors;
 try{
  monitors=new IslandMonitors({settingsFile,weather,readWindows:async()=>({})});await monitors.execute(monitorCommand('show clock and weather in Derby and RAM'));await flush();monitors.close();
  monitors=new IslandMonitors({settingsFile,weather,readWindows:async()=>({})});assert.deepEqual(monitors.snapshot().metrics,['clock','weather','ram']);assert.equal(monitors.weatherLocation,'derby');
  await monitors.execute(monitorCommand('hide clock'));assert.deepEqual(monitors.snapshot().metrics,['weather','ram']);
  await monitors.execute(monitorCommand('hide weather'));assert.deepEqual(monitors.snapshot().metrics,['ram']);
  await monitors.execute(monitorCommand('clear the island'));assert.equal(monitors.snapshot().active,false);
 }finally{monitors?.close();await flush();fs.unlinkSync(settingsFile);fs.rmdirSync(folder);}
});
test('a late weather response cannot re-pin hidden weather or overwrite a new city',async()=>{
 const requests=[];const monitors=new IslandMonitors({weather:{current:location=>new Promise(resolve=>requests.push({location,resolve}))}});
 try{
  await monitors.execute(monitorCommand('show weather in Derby'));await monitors.execute(monitorCommand('show weather in London'));
  requests[1].resolve(weatherCard('London'));await flush();requests[0].resolve(weatherCard('Derby'));await flush();assert.equal(monitors.values.weather.detail,'London');
  await monitors.execute(monitorCommand('show weather in York'));await monitors.execute(monitorCommand('hide weather'));const hiddenValue=monitors.values.weather;requests[2].resolve(weatherCard('York'));await flush();assert.equal(monitors.snapshot().active,false);assert.deepEqual(monitors.values.weather,hiddenValue);
 }finally{monitors.close();}
});
test('weather failures keep the pin, show unavailability and retry without polling every second',async()=>{
 let time=10000,calls=0;
 const monitors=new IslandMonitors({now:()=>time,weather:{current:async()=>{calls++;if(calls===1)throw Error('No weather connection');return weatherCard();}}});
 try{
  await monitors.execute(monitorCommand('show weather'));await flush();assert.equal(monitors.values.weather.text,'Weather unavailable');assert.equal(monitors.snapshot().active,true);
  time+=59000;monitors.sample();await flush();assert.equal(calls,1);time+=1000;monitors.sample();await flush();assert.equal(calls,2);assert.equal(monitors.values.weather.text,'10°C');
  await monitors.execute(monitorCommand('show weather here'));await flush();assert.equal(monitors.weatherLocation,'');
 }finally{monitors.close();}
});
test('pin requests use the utility route while weather/time questions keep temporary cards',async()=>{
 const monitors=new IslandMonitors({weather:{current:async()=>weatherCard()}}),cards=[];
 const utilities=new IslandUtilities({monitors,weather:{current:async()=>weatherCard()},showCard:card=>cards.push(card),clearCard(){}});
 try{
  assert.equal(utilities.match('show clock').action,'island-monitors');assert.equal(utilities.match('show weather').action,'island-monitors');
  await utilities.run('show clock');assert.equal(monitors.snapshot().active,true);assert.deepEqual(cards,[]);
  assert.equal(utilities.match("what's the time?").action,'time');assert.equal(utilities.match("what's the weather in Derby?").action,'weather');
 }finally{monitors.close();}
});

test('spoken clock and weather pin requests bypass AI and update the persistent monitors',async()=>{
 const {EventEmitter}=require('node:events'),{installNativeIpc}=require('../src/native-ipc');
 for(const [text,expected] of [['show clock',['clock']],['show weather in Derby',['weather']],['show clock and weather',['clock','weather']]]){
  const monitors=new IslandMonitors({weather:{current:async()=>weatherCard()}});
  try{
   const engine=new EventEmitter(),handlers=new Map(),calls=[],messages=[];engine.connected=true;engine.status={state:'Idle'};
   engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
   const settings={voiceAutoSpeak:false},utilities=new IslandUtilities({monitors,clearCard(){}});
   const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},save(){},updateMessage(){},publicState:()=>({settings})};
   const webContents={mainFrame:{}};installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
   const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
   await invoke('native-begin');const turn=calls.find(call=>call.command==='begin').args.turn;engine.emit('classify-utility',{turn,text});await flush();
   assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);await invoke('native-end');await flush();
   assert.deepEqual(monitors.snapshot().metrics,expected);assert.equal(calls.some(call=>call.command==='submit'),false);
  }finally{monitors.close();}
 }
});
