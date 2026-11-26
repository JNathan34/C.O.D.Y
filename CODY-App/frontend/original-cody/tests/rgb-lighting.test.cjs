'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {once,EventEmitter}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {OpenRgbClient,controllerInfo}=require('../src/integrations/openrgb');
const {IcueLightingClient}=require('../src/integrations/icue-lighting');
const {RgbLighting}=require('../src/integrations/rgb-lighting');
const {IslandUtilities}=require('../src/island-utilities');
const {installNativeIpc}=require('../src/native-ipc');
const {RGB_PLUGIN_ID}=require('../src/rgb-commands');

function word(value,size=4){const bytes=Buffer.alloc(size);bytes.writeUIntLE(value,0,size);return bytes;}
function string(value){const bytes=Buffer.from(value+'\0');return Buffer.concat([word(bytes.length,2),bytes]);}
function deviceRecord(device){
  const modes=device.modes||[device.direct?'Direct':'Static'];
  const data=modes.map(name=>{
    const fields=Buffer.alloc(48);if(name==='Direct')fields.writeUInt32LE(0x20,4);
    return Buffer.concat([string(name),fields,word(0,2)]);
  });
  const body=Buffer.concat([word(5),...['Fixture '+device.id,'Vendor','','','serial-'+device.id,'USB'].map(string),
    word(modes.length,2),word(device.active||0),...data,
    word(1,2),string('Main zone'),word(0),word(2),word(2),word(2),word(0,2),
    word(2,2),string('Left'),word(0),string('Right'),word(1),word(2,2),device.colors]);
  return Buffer.concat([word(body.length+4),body]);
}
function packet(id,command,body=Buffer.alloc(0)){
  return Buffer.concat([Buffer.from('ORGB'),word(id),word(command),word(body.length),body]);
}
async function until(check){
  const deadline=Date.now()+3000;
  while(!check()){assert.ok(Date.now()<deadline,'Timed out waiting for OpenRGB');await delay(10);}
}
async function fixture(t,{switchable=false,announceDuringScan=false}={}){
  const writes=[],modeWrites=[],sockets=new Set();
  let sentNotice=false;
  const original=Buffer.from('0102030004050600','hex');
  const devices=switchable?[{id:0,modes:['Static','Direct'],colors:original}]:
    [{id:0,direct:true,colors:original},{id:1,direct:true,colors:original},{id:2,direct:false,colors:original}];
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let buffer=Buffer.alloc(0);
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=16){
        const size=buffer.readUInt32LE(12);
        if(buffer.length<16+size)return;
        const id=buffer.readUInt32LE(4),command=buffer.readUInt32LE(8),body=buffer.subarray(16,16+size);
        buffer=buffer.subarray(16+size);
        let response;
        if(command===40){assert.equal(body.readUInt32LE(),3);response=word(5);}
        if(command===0){
          response=word(devices.length);
          if(announceDuringScan&&!sentNotice){
            sentNotice=true;
            socket.write(Buffer.concat([packet(0,100),packet(id,command,response)]));
            response=null;
          }
        }
        if(command===1){assert.equal(body.readUInt32LE(),3);response=deviceRecord(devices[id]);}
        if(command===1050){
          assert.equal(body.readUInt32LE(),body.length);assert.equal(body.readUInt16LE(4),2);
          devices[id].colors=Buffer.from(body.subarray(6));writes.push({id,colors:devices[id].colors});
        }
        if(command===1101){
          assert.equal(body.readUInt32LE(),body.length);
          devices[id].active=body.readUInt32LE(4);modeWrites.push(devices[id].active);
        }
        if(response){const payload=packet(id,command,response);socket.write(payload.subarray(0,11));socket.write(payload.subarray(11));}
      }
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const rgb=new RgbLighting({connect:()=>new OpenRgbClient({createSocket:()=>net.createConnection(server.address().port,'127.0.0.1')})});
  t.after(async()=>{for(const socket of sockets)socket.destroy();await rgb.close();await new Promise(resolve=>server.close(resolve));});
  return {rgb,devices,writes,modeWrites,original,notify:()=>{for(const socket of sockets)socket.write(packet(0,100));}};
}
test('OpenRGB rejects corrupt device records',()=>{
  assert.throws(()=>controllerInfo(Buffer.from('01000000','hex')),/invalid device record/);
});
test('OpenRGB includes every Direct-capable device without writing and restores their original colors',async t=>{
  const {rgb,writes,original}=await fixture(t);
  rgb.setPhase('listening');
  const state=await rgb.discover();
  assert.deepEqual(state.devices.map(device=>device.selected),[true,true,false]);
  assert.equal(writes.length,0);
  await rgb.enable(true);
  await until(()=>writes.length===2);
  assert.ok(writes.every(write=>write.colors.toString('hex')==='24e9f50024e9f500'));
  rgb.setPhase('thinking');await until(()=>writes.length===4);
  assert.equal(writes[3].colors.toString('hex'),'f333c800f333c800');
  rgb.setPhase('speaking');await until(()=>writes.length===6);
  assert.equal(writes[5].colors.toString('hex'),'ffb45c00ffb45c00');
  rgb.setPhase('idle');await until(()=>writes.length===8);
  assert.deepEqual(writes.slice(6,8).map(write=>write.colors),[original,original]);
  rgb.setPhase('thinking');await until(()=>writes.length===10);
  await rgb.enable(false);
  await until(()=>writes.length===12);
  assert.deepEqual(writes.slice(-2).map(write=>write.colors),[original,original]);
  assert.deepEqual(writes.map(write=>write.id),[0,1,0,1,0,1,0,1,0,1,0,1]);
});
test('OpenRGB yields to external color changes and discards stale device IDs',async t=>{
  const {rgb,writes,devices,notify}=await fixture(t);
  await rgb.discover();rgb.setPhase('thinking');await rgb.enable(true);
  await until(()=>writes.length===2);
  const external=Buffer.alloc(8,99);devices[0].colors=external;
  rgb.setPhase('idle');await until(()=>!rgb.status().devices[0].selected);
  assert.deepEqual(devices[0].colors,external);
  await until(()=>writes.length===3);
  assert.match(rgb.status().message,/changed outside Cody/);
  notify();
  await until(()=>!rgb.status().connected);
  assert.equal(rgb.status().devices.length,0);
  await rgb.discover();assert.deepEqual(rgb.status().devices.map(device=>device.selected),[true,true,false]);
});
test('manual lighting switches to Direct mode and keeps the verified color after speech',async t=>{
  const {rgb,writes,modeWrites}=await fixture(t,{switchable:true});
  const result=await rgb.setColor('#00ff00',40);
  assert.equal(result.applied,1);
  assert.deepEqual(modeWrites,[1]);
  assert.deepEqual(writes.map(write=>write.colors.toString('hex')),['0066000000660000']);
  assert.equal(rgb.status().devices[0].selected,true);
  rgb.setPhase('speaking');rgb.setPhase('idle');
  await rgb.close();
  assert.equal(writes.length,1);
});
test('manual lighting applies the requested color to every compatible device',async t=>{
  const {rgb,writes}=await fixture(t);
  const result=await rgb.setColor('#00ff00');
  assert.equal(result.applied,2);
  assert.deepEqual(writes.map(write=>write.id),[0,1]);
});
test('discovery retries a changing device list without losing the count reply',async t=>{
  const {rgb}=await fixture(t,{announceDuringScan:true});
  const state=await rgb.discover();
  assert.equal(state.busy,false);
  assert.equal(state.connected,true);
  assert.equal(state.devices.length,3);
});
test('the plugin switch restores reactive colors and includes new devices when reenabled',async t=>{
  const {rgb,writes,original,devices}=await fixture(t);
  await rgb.discover();rgb.setPhase('thinking');await rgb.enable(true);
  await until(()=>writes.length===2);
  const off=await rgb.setPluginEnabled(false);
  assert.equal(off.pluginEnabled,false);
  assert.equal(off.enabled,false);
  assert.equal(off.connected,false);
  assert.equal(off.busy,false);
  await until(()=>writes.length===4);
  assert.deepEqual(writes.slice(-2).map(write=>write.colors),[original,original]);
  await assert.rejects(rgb.discover(),/Turn on RGB Lighting/);
  await assert.rejects(rgb.enable(true),/Turn on RGB Lighting/);
  await assert.rejects(rgb.setColor('#00ff00'),/Turn on RGB Lighting/);
  devices.push({id:3,direct:true,colors:original});
  const enabled=await rgb.setPluginEnabled(true);
  assert.equal(enabled.enabled,false);
  assert.deepEqual(enabled.devices.filter(device=>device.selected).map(device=>device.id),[0,1,3]);
  assert.equal((await rgb.setColor('#00ff00')).applied,3);
});
test('turning off the plugin releases an in-flight discovery without reading devices',async()=>{
  let complete,closed=0,stopped=0;
  const rgb=new RgbLighting({openClient:()=>new Promise(resolve=>{complete=resolve;}),stopRuntime:()=>{stopped++;}});
  const scan=rgb.discover();
  await until(()=>complete);
  const disabled=rgb.setPluginEnabled(false);
  assert.equal(rgb.status().pluginEnabled,false);
  complete({close(){closed++;},count(){assert.fail('A disabled plugin must not read devices');}});
  await scan;await disabled;
  assert.deepEqual([closed,stopped],[1,1]);
});
test('the iCUE SDK discovers all lights on each enable and releases its shared layer on disable',async t=>{
  const engine=new EventEmitter(),calls=[];
  engine.connected=true;
  const devices=[{id:0,name:'Keyboard'},{id:1,name:'Lighting Node'}];
  engine.request=async(command,args)=>{
    calls.push({command,args});
    if(command==='icue-discover')return {running:true,devices:devices.slice()};
    if(command==='icue-color')return {applied:devices.length};
    assert.equal(command,'icue-close');
  };
  const rgb=new RgbLighting({pluginEnabled:false,openClient:()=>IcueLightingClient.connect(engine)});
  t.after(()=>rgb.close());
  const first=await rgb.setPluginEnabled(true);
  assert.equal(first.provider,'iCUE SDK');
  assert.deepEqual(first.devices.map(device=>device.selected),[true,true]);
  assert.deepEqual(calls.map(call=>call.command),['icue-discover']);
  const colors=()=>calls.filter(call=>call.command==='icue-color').map(call=>call.args.color);
  rgb.setPhase('listening');await rgb.enable(true);await until(()=>colors().length===1);
  rgb.setPhase('idle');await until(()=>colors().length===2);
  assert.deepEqual(colors(),[[36,233,245],null]);
  assert.equal((await rgb.setColor('#00ff00',40)).applied,2);
  assert.deepEqual(colors().at(-1),[0,102,0]);
  await rgb.setPluginEnabled(false);
  assert.equal(calls.at(-1).command,'icue-close');
  assert.equal(engine.listenerCount('icue-disconnected'),0);
  devices.push({id:2,name:'Mouse'});
  const enabled=await rgb.setPluginEnabled(true);
  assert.deepEqual(enabled.devices.map(device=>device.name),['Keyboard','Lighting Node','Mouse']);
  engine.emit('icue-disconnected');
  assert.match(rgb.status().message,/iCUE disconnected/);
  assert.equal(rgb.status().connected,false);
});
test('a running iCUE session that denies SDK access reports the actual error',async()=>{
  const engine={request:async()=>({running:false})};
  assert.equal(await IcueLightingClient.connect(engine),null);
  engine.request=async()=>{throw Error('Allow C.O.D.Y. under iCUE SDK.')};
  const rgb=new RgbLighting({openClient:()=>IcueLightingClient.connect(engine)});
  const state=await rgb.discover();
  assert.equal(state.connected,false);
  assert.match(state.message,/Allow C\.O\.D\.Y\. under iCUE SDK/);
});
test('RGB voice commands use the local utility path before capture',async()=>{
  const engine=new EventEmitter(),calls=[],handlers=new Map(),messages=[],colors=[];
  engine.connected=true;let text,opened=0;
  engine.request=async(command,args)=>{
    calls.push({command,args});
    if(command==='end'){
      const turn=calls.filter(call=>call.command==='begin').at(-1).args.turn;
      engine.emit('transcript',{turn,text});engine.emit('classify-utility',{turn,text});
      assert.equal(calls.at(-1).args.handled,true,text);
      return {utilityText:text};
    }
    return {};
  };
  const rgbLighting={pluginEnabled:true,setColor:async color=>{colors.push(color);return {applied:1,message:'Color set.'};}};
  const utilities=new IslandUtilities({rgbLighting,openRgbPanel:()=>{opened++;}});
  const store={data:{settings:{},activeChatId:'chat'},chat:()=>({messages}),
    addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},save(){},publicState:()=>({})};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},
    getWindow:()=>({webContents}),getState:()=>({})});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  for(text of ['Cody, set lights to green','Open R. G. B. control']){await invoke('native-begin');await invoke('native-end');}
  assert.deepEqual(colors,['#00ff00']);assert.equal(opened,1);
  assert.equal(calls.some(call=>call.command==='submit'),false);
  assert.equal(utilities.match('How do I open RGB control?'),null);
  assert.ok((await invoke('mentions-list',true)).items.some(item=>item.id===RGB_PLUGIN_ID&&item.icon==='palette'));
  assert.equal((await invoke('send-message',{chatId:'chat',text:'blue',capabilityId:RGB_PLUGIN_ID})).local,true);
  assert.equal(colors.at(-1),'#0060ff');
  await new Promise(resolve=>setImmediate(resolve));
  rgbLighting.pluginEnabled=false;
  assert.ok(!(await invoke('mentions-list',true)).items.some(item=>item.id===RGB_PLUGIN_ID));
  for(text of ['Open RGB control','Set lights to green']){
    await invoke('native-begin');await invoke('native-end');
    assert.match(messages.at(-1).text,/Turn on RGB Lighting/);
  }
  assert.equal(opened,1);
  assert.deepEqual(colors,['#00ff00','#0060ff']);
  assert.equal(calls.some(call=>call.command==='submit'),false);
});
