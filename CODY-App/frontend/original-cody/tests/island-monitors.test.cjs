'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {IslandMonitors,monitorCommand}=require('../src/island-monitors');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('usage and temperature aliases select one CPU or GPU card',()=>{
  assert.deepEqual(monitorCommand('show CPU usage and CPU temperature and GPU usage and GPU temp'),{action:'show',metrics:['cpu','gpu']});
  assert.deepEqual(monitorCommand('stop showing GPU temperature'),{action:'hide',metrics:['gpu']});
  assert.deepEqual(monitorCommand('show GPU usage and temperature'),{action:'show',metrics:['gpu']});
});
test('legacy temperature pins merge and stay removed after restart',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-monitor-groups-')),settingsFile=path.join(folder,'monitors.json');
  fs.writeFileSync(settingsFile,JSON.stringify({metrics:['cpuTemp','cpu','gpuTemp','gpu','ram']}));
  let monitors;
  try{
    monitors=new IslandMonitors({settingsFile,readWindows:async()=>({})});
    assert.deepEqual(monitors.snapshot().metrics,['cpu','gpu','ram']);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile)).metrics,['cpu','gpu','ram']);
    await monitors.execute(monitorCommand('hide CPU temp and GPU usage'));monitors.close();
    monitors=new IslandMonitors({settingsFile,readWindows:async()=>({})});assert.deepEqual(monitors.snapshot().metrics,['ram']);
  }finally{monitors?.close();fs.unlinkSync(settingsFile);fs.rmdirSync(folder);}
});
test('paired readings use their own detail, keep hardware names in tooltips and expire stale sensors',async()=>{
  let time=10000;
  const monitors=new IslandMonitors({now:()=>time,readWindows:async()=>({gpu:32.4,gpuName:'Test adapter',cpuTemp:55.2,gpuTemp:64.8})});
  try{
    await monitors.execute(monitorCommand('show CPU temp and GPU temp and RAM'));await flush();
    assert.deepEqual(monitors.snapshot().metrics,['cpu','gpu','ram']);
    assert.match(monitors.values.cpu.text,/^CPU (?:\d+%|N\/A)$/);assert.equal(monitors.values.cpu.detail,'Temp 55°C');
    assert.equal(monitors.values.gpu.text,'GPU 32%');assert.equal(monitors.values.gpu.detail,'Temp 65°C');
    assert.match(monitors.values.gpu.tooltip,/Test adapter/);assert.match(monitors.values.ram.detail,/^\d+\.\d \/ \d+\.\d GB$/);
    assert.match(monitors.values.ram.text,/^RAM \d+%$/);
    time+=21000;monitors.readWindows=()=>new Promise(()=>{});monitors.sample();
    assert.equal(monitors.values.cpu.detail,'');assert.equal(monitors.values.gpu.text,'GPU N/A');assert.equal(monitors.values.gpu.detail,'');
  }finally{monitors.close();}
});
test('a pending Windows sample cannot restore a hidden group',async()=>{
  let finish;const monitors=new IslandMonitors({now:()=>10000,readWindows:()=>new Promise(resolve=>finish=resolve)});
  try{
    await monitors.execute(monitorCommand('show GPU temp'));await monitors.execute(monitorCommand('hide GPU usage'));
    finish({gpu:42,gpuTemp:50});await flush();assert.deepEqual(monitors.snapshot().items,[]);
  }finally{monitors.close();}
});
test('Wi-Fi traffic waits for a baseline, measures both directions, and resets after reconnect',async()=>{
  let time=10000,reading={connected:true,adapter:'test',received:1000,sent:500,signal:80,receiveMbps:1201,transmitMbps:1201};
  const monitors=new IslandMonitors({now:()=>time,readWindows:async()=>({wifi:{...reading}})});
  try{
    await monitors.execute(monitorCommand('show wifi details and wifi speed'));await flush();
    assert.equal(monitors.values.wifiSpeed.detail,'Measuring…');assert.equal(monitors.values.wifiDetails.detail,'RX 1.2G · TX 1.2G');
    time+=5000;reading.received+=625000;reading.sent+=312500;monitors.sample();await flush();
    assert.equal(monitors.values.wifiSpeed.text,'↓1.0 Mbps');assert.equal(monitors.values.wifiSpeed.detail,'↑0.5 Mbps');
    time+=5000;reading={connected:false};monitors.sample();await flush();assert.equal(monitors.values.wifiSpeed.text,'Wi-Fi offline');
    time+=5000;reading={connected:true,adapter:'new',received:1e9,sent:1e9};monitors.sample();await flush();assert.equal(monitors.values.wifiSpeed.detail,'Measuring…');
    time+=5000;reading={error:'unavailable'};monitors.sample();await flush();assert.equal(monitors.values.wifiSpeed.text,'Wi-Fi N/A');
  }finally{monitors.close();}
});
test('FPS provider failures remain unavailable instead of breaking every monitor',async()=>{
  const monitors=new IslandMonitors({fpsProvider:()=>{throw Error('provider stopped');}});
  try{await monitors.execute(monitorCommand('show FPS and RAM'));assert.equal(monitors.values.fps.text,'FPS N/A');assert.match(monitors.values.ram.text,/RAM/);}finally{monitors.close();}
});
test('monitor commands support multiple metrics, individual removal and clearing',()=>{
  assert.deepEqual(monitorCommand('show my cpu usage and ram'),{action:'show',metrics:['cpu','ram']});
  assert.deepEqual(monitorCommand('show me gpu temp'),{action:'show',metrics:['gpu']});
  assert.deepEqual(monitorCommand('stop showing cpu'),{action:'hide',metrics:['cpu']});
  assert.deepEqual(monitorCommand('clear the island'),{action:'clear'});
  assert.deepEqual(monitorCommand('run a wifi speed test'),{action:'speedtest'});
  for(const text of ['explain cpu usage','email my wifi details','show cpu and delete files','stop recording'])assert.equal(monitorCommand(text),null,text);
});
test('hide commands tolerate the observed dictation and common removal phrasings',()=>{
  for(const text of ["های it's CPV یوسش",'hide CPU usage','hide C.P.U. usage','stop showing my CPU usage','remove CPU usage from the island',"don't show CPU usage anymore",'stop displaying CPU usage in the island','turn off the CPU indicator'])assert.deepEqual(monitorCommand(text),{action:'hide',metrics:['cpu']},text);
  for(const text of ['hide CPU and delete files','explain how to hide CPU usage'])assert.equal(monitorCommand(text),null,text);
});
test('monitor values persist through sampling, remove individually, and never invent missing temperatures/FPS',async()=>{
  let time=10000;const monitors=new IslandMonitors({now:()=>time,readWindows:async()=>({gpu:null,cpuTemp:null,gpuTemp:null,wifi:{connected:true,received:1000,sent:500,signal:80,linkMbps:1201}})});
  try{
    await monitors.execute(monitorCommand('show cpu and ram'));time+=15000;monitors.sample();assert.deepEqual(monitors.snapshot().metrics,['cpu','ram']);
    await monitors.execute(monitorCommand('stop showing cpu'));assert.deepEqual(monitors.snapshot().metrics,['ram']);
    await monitors.execute(monitorCommand('show fps and cpu temp'));assert.match(monitors.values.fps.text,/N\/A/);assert.equal(monitors.values.cpu.detail,'');assert.equal(monitors.values.gpu.detail,'');
    await monitors.execute(monitorCommand('clear the island'));assert.equal(monitors.snapshot().active,false);
  }finally{monitors.close();}
});
test('speed test sends generated test bytes and stores measured results until cleared',async()=>{
  const requests=[];const monitors=new IslandMonitors({fetcher:async(url,options)=>{requests.push({url,options});return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0),body:(async function*(){yield new Uint8Array(100000);})()};}});
  try{
    await monitors.execute({action:'speedtest'});while(monitors.speedRunning)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(monitors.snapshot().metrics[0],'speedtest');assert.match(monitors.values.speedtest.detail,/Mbps/);assert.equal(requests.length,3);assert.equal(requests[2].options.body.byteLength,4000000);
    await monitors.execute({action:'clear'});assert.equal(monitors.snapshot().active,false);
  }finally{monitors.close();}
});
