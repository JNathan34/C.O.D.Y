'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {OpenRgbClient,controllerInfo}=require('../src/integrations/openrgb');
const {RgbLighting}=require('../src/integrations/rgb-lighting');

function word(value,size=4){const bytes=Buffer.alloc(size);bytes.writeUIntLE(value,0,size);return bytes;}
function string(value){const bytes=Buffer.from(value+'\0');return Buffer.concat([word(bytes.length,2),bytes]);}
function deviceRecord(device){
  const mode=Buffer.alloc(48);mode.writeUInt32LE(0x20,4);
  const body=Buffer.concat([word(5),...['Fixture '+device.id,'Vendor','','','serial-'+device.id,'USB'].map(string),
    word(1,2),word(0),string(device.direct?'Direct':'Static'),mode,word(0,2),
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
async function fixture(t){
  const writes=[],sockets=new Set();
  const original=Buffer.from('0102030004050600','hex');
  const devices=[{id:0,direct:true,colors:original},{id:1,direct:true,colors:original},{id:2,direct:false,colors:original}];
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
        if(command===0)response=word(devices.length);
        if(command===1){assert.equal(body.readUInt32LE(),3);response=deviceRecord(devices[id]);}
        if(command===1050){
          assert.equal(body.readUInt32LE(),body.length);assert.equal(body.readUInt16LE(4),2);
          devices[id].colors=Buffer.from(body.subarray(6));writes.push({id,colors:devices[id].colors});
        }
        if(response){const payload=packet(id,command,response);socket.write(payload.subarray(0,11));socket.write(payload.subarray(11));}
      }
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const rgb=new RgbLighting({connect:()=>new OpenRgbClient({createSocket:()=>net.createConnection(server.address().port,'127.0.0.1')})});
  t.after(async()=>{for(const socket of sockets)socket.destroy();await rgb.close();await new Promise(resolve=>server.close(resolve));});
  return {rgb,devices,writes,original,notify:()=>{for(const socket of sockets)socket.write(packet(0,100));}};
}
test('OpenRGB rejects corrupt device records',()=>{
  assert.throws(()=>controllerInfo(Buffer.from('01000000','hex')),/invalid device record/);
});
test('OpenRGB discovers without writing and changes only selected devices, restoring the original colors',async t=>{
  const {rgb,writes,original}=await fixture(t);
  rgb.setPhase('listening');
  assert.equal((await rgb.discover()).devices.length,3);
  assert.equal(writes.length,0);
  assert.throws(()=>rgb.select(2,true),/Direct mode/);
  await assert.rejects(rgb.enable(true),/select/);
  rgb.select(1,true);await rgb.enable(true);
  await until(()=>writes.length===1);
  assert.deepEqual(writes[0],{id:1,colors:Buffer.from('24e9f50024e9f500','hex')});
  rgb.setPhase('thinking');await until(()=>writes.length===2);
  assert.deepEqual(writes[1].colors,Buffer.from('f333c800f333c800','hex'));
  rgb.setPhase('speaking');await until(()=>writes.length===3);
  assert.deepEqual(writes[2].colors,Buffer.from('ffb45c00ffb45c00','hex'));
  rgb.setPhase('idle');await until(()=>writes.length===4);
  assert.deepEqual(writes[3].colors,original);
  rgb.setPhase('thinking');await until(()=>writes.length===5);
  await rgb.enable(false);
  await until(()=>writes.length===6);
  assert.deepEqual(writes[5].colors,original);
  assert.ok(writes.every(write=>write.id===1));
});
test('OpenRGB yields to external color changes and removes consent when device IDs change',async t=>{
  const {rgb,writes,devices,notify}=await fixture(t);
  await rgb.discover();rgb.select(0,true);rgb.setPhase('thinking');await rgb.enable(true);
  await until(()=>writes.length===1);
  const external=Buffer.alloc(8,99);devices[0].colors=external;
  rgb.setPhase('idle');await until(()=>!rgb.status().enabled);
  assert.equal(writes.length,1);assert.deepEqual(devices[0].colors,external);
  assert.match(rgb.status().message,/changed outside Cody/);
  rgb.select(0,true);notify();
  await until(()=>!rgb.status().connected);
  assert.equal(rgb.status().devices.length,0);
  await rgb.discover();assert.ok(rgb.status().devices.every(device=>!device.selected));
});
