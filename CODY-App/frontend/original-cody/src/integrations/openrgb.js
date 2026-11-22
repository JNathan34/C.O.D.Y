'use strict';
const net=require('node:net');
const {once,EventEmitter}=require('node:events');

// OpenRGB SDK protocol 3 is supported by OpenRGB 0.7 and newer servers.
// https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Documentation/OpenRGBSDK.md
const VERSION=3;
const COMMAND={count:0,controller:1,version:40,name:50,devicesChanged:100,colors:1050,mode:1101};
const MAX_PACKET=256*1024;
const TIMEOUT=800;
const uint32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};

function controllerInfo(body){
  let offset=0;
  const take=count=>{
    if(offset+count>body.length)throw Error('OpenRGB returned incomplete device data.');
    const bytes=body.subarray(offset,offset+count);offset+=count;return bytes;
  };
  const u16=()=>take(2).readUInt16LE();
  const string=()=>{
    const bytes=take(u16());
    if(!bytes.length||bytes[bytes.length-1]!==0)throw Error('OpenRGB returned an invalid device name.');
    return bytes.subarray(0,-1).toString('utf8');
  };
  if(take(4).readUInt32LE()!==body.length)throw Error('OpenRGB returned an invalid device record.');
  const type=take(4).readUInt32LE(),name=string(),vendor=string();
  string();string();
  const serial=string(),location=string();
  const modeCount=u16(),active=take(4).readInt32LE();
  let directIndex=-1;
  const modes=[];
  for(let i=0;i<modeCount;i++){
    const start=offset;
    const mode=string();
    const fields=take(48);
    if(/^direct$/i.test(mode)&&Boolean(fields.readUInt32LE(4)&0x20))directIndex=i;
    take(u16()*4);
    modes.push(body.subarray(start,offset));
  }
  const zoneCount=u16();
  for(let i=0;i<zoneCount;i++){string();take(16);take(u16());}
  const ledCount=u16();
  for(let i=0;i<ledCount;i++){string();take(4);}
  const colorCount=u16(),colors=Buffer.from(take(colorCount*4));
  if(offset!==body.length)throw Error('OpenRGB returned an unsupported device record.');
  if(ledCount!==colorCount||colorCount===0||colorCount>2048)directIndex=-1;
  return {name:name.slice(0,120)||'RGB device',direct:directIndex>=0&&active===directIndex,directIndex,active,modes,
    signature:JSON.stringify([type,name,vendor,serial,location,ledCount]),colors};
}

class OpenRgbClient extends EventEmitter{
  constructor({createSocket=()=>net.createConnection({host:'127.0.0.1',port:6742})}={}){
    super();this.createSocket=createSocket;this.buffer=Buffer.alloc(0);this.deviceRevision=0;
  }
  async connect(){
    this.socket=this.createSocket();
    this.socket.on('error',()=>this.close());
    this.socket.on('close',()=>{this.close();this.emit('closed');});
    this.socket.on('data',chunk=>this.receive(chunk));
    await once(this.socket,'connect',{signal:AbortSignal.timeout(TIMEOUT)});
    const response=await this.request(COMMAND.version,0,uint32(VERSION));
    if(response.length!==4||response.readUInt32LE()<VERSION)throw Error('OpenRGB 0.7 or newer is required.');
    await this.send(COMMAND.name,0,Buffer.from('C.O.D.Y.\0'));
  }
  close(){
    if(this.pending)this.complete(Error('OpenRGB disconnected.'));
    this.socket?.destroy();
  }
  send(command,id=0,body=Buffer.alloc(0)){
    if(!this.socket||this.socket.destroyed)return Promise.reject(Error('OpenRGB disconnected.'));
    const header=Buffer.alloc(16);
    header.write('ORGB');header.writeUInt32LE(id,4);header.writeUInt32LE(command,8);header.writeUInt32LE(body.length,12);
    return new Promise((resolve,reject)=>this.socket.write(Buffer.concat([header,body]),error=>error?reject(error):resolve()));
  }
  request(command,id=0,body){
    if(this.pending)return Promise.reject(Error('An OpenRGB request is already running.'));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.complete(Error('OpenRGB did not respond.'));this.close();},TIMEOUT);
      this.pending={command,id,timer,resolve,reject};
      this.send(command,id,body).catch(()=>this.close());
    });
  }
  complete(error,body){
    const pending=this.pending;
    if(!pending)return;
    this.pending=null;clearTimeout(pending.timer);
    if(error)pending.reject(error);else pending.resolve(body);
  }
  receive(chunk){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=16){
      const size=this.buffer.readUInt32LE(12);
      if(this.buffer.toString('ascii',0,4)!=='ORGB'||size>MAX_PACKET){this.close();return;}
      if(this.buffer.length<16+size)return;
      const id=this.buffer.readUInt32LE(4),command=this.buffer.readUInt32LE(8),body=this.buffer.subarray(16,16+size);
      this.buffer=this.buffer.subarray(16+size);
      if(command===COMMAND.devicesChanged){this.deviceRevision++;this.emit('devices-changed');continue;}
      if(this.pending?.command===command&&this.pending.id===id)this.complete(null,body);
    }
  }
  async count(){
    const body=await this.request(COMMAND.count);
    if(body.length!==4||body.readUInt32LE()>64)throw Error('OpenRGB returned an unsupported device list.');
    return body.readUInt32LE();
  }
  async device(id){return controllerInfo(await this.request(COMMAND.controller,id,uint32(VERSION)));}
  setMode(id,index,mode){return this.send(COMMAND.mode,id,Buffer.concat([uint32(8+mode.length),uint32(index),mode]));}
  updateColors(id,colors){
    const body=Buffer.alloc(6+colors.length);
    body.writeUInt32LE(body.length);body.writeUInt16LE(colors.length/4,4);colors.copy(body,6);
    return this.send(COMMAND.colors,id,body);
  }
}

module.exports={OpenRgbClient,controllerInfo};
