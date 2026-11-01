'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {IslandMonitors}=require('../src/island-monitors'),{IslandUtilities}=require('../src/island-utilities'),{installNativeIpc}=require('../src/native-ipc');
for(const [text,metric,action='hide'] of [['hide CPU usage','cpu'],["های it's CPV یوسش",'cpu'],['stop showing GPU temp','gpu'],['hide RAM','ram'],['hide Wi-Fi details','wifiDetails'],['stop showing Wi-Fi speed','wifiSpeed'],['hide FPS','fps'],['show CPU','cpu','show'],['show GPU','gpu','show'],['show RAM','ram','show'],['show FPS','fps','show'],['show Wi-Fi','wifi','show'],['show C P U','cpu','show'],['show G P U','gpu','show']])test(`voice monitor command is handled without an AI submission: ${text}`,async()=>{
  const monitors=new IslandMonitors({readWindows:async()=>({})});try{
    if(action==='hide')await monitors.execute({action:'show',metrics:[metric,'wifi']});
    const engine=new EventEmitter(),handlers=new Map(),calls=[],messages=[];engine.connected=true;engine.status={state:'Idle'};
    engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
    const utilities=new IslandUtilities({monitors,clearCard(){}}),settings={voiceAutoSpeak:false};
    const store={data:{settings,activeChatId:'chat'},chat:()=>({messages}),addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},updateMessage(){},save(){},publicState:()=>({settings})};
    const webContents={mainFrame:{}};installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
    const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
    await invoke('native-begin');const turn=calls.find(call=>call.command==='begin').args.turn;engine.emit('classify-utility',{turn,text});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.find(call=>call.command==='utility-route').args.handled,true);await invoke('native-end');
    assert.deepEqual(monitors.snapshot().metrics,action==='hide'?['wifi']:[metric]);assert.equal(calls.some(call=>call.command==='submit'),false);
  }finally{monitors.close();}
});
