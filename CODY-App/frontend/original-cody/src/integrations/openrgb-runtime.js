'use strict';
const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {OpenRgbClient}=require('./openrgb');

async function availablePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=server.address();
  await new Promise(resolve=>server.close(resolve));
  return port;
}

class OpenRgbRuntime{
  constructor({directory,profile}){Object.assign(this,{directory,profile});}
  async open(port){
    const client=new OpenRgbClient({createSocket:()=>net.createConnection(port,'127.0.0.1')});
    try{await client.connect();return client;}
    catch(error){client.close();throw error;}
  }
  async waitForInitialScan(client){
    // OpenRGB starts the SDK server before it finishes detecting hardware.
    const deadline=Date.now()+4500;
    while(Date.now()<deadline){
      const revision=client.deviceRevision;
      const count=await client.count();
      await delay(count?350:200);
      if(count&&revision===client.deviceRevision)return;
    }
  }
  async connect(){
    if(this.closed)throw Error('Lighting is shutting down.');
    if(this.child){
      try{return await this.open(this.port);}
      catch{this.stopChild();}
    }
    // Reuse a server the user already runs so two processes do not drive the hardware.
    try{return await this.open(6742);}catch{}
    const executable=path.join(this.directory,'OpenRGB.exe');
    if(!fs.existsSync(executable))throw Error('The built-in lighting runtime is missing from this C.O.D.Y. build.');
    await fs.promises.mkdir(this.profile,{recursive:true});
    const port=this.port=await availablePort();
    if(this.closed)throw Error('Lighting is shutting down.');
    const child=this.child=spawn(executable,['--config',this.profile,'--noautoconnect','--server','--server-host','127.0.0.1','--server-port',String(port)],
      {cwd:this.directory,windowsHide:true,stdio:'ignore'});
    const exited=()=>{if(this.child===child)this.child=null;};
    child.once('error',exited);child.once('exit',exited);
    const deadline=Date.now()+10000;
    while(this.child===child&&Date.now()<deadline){
      let client;
      try{
        client=await this.open(port);
        await this.waitForInitialScan(client);
        if(this.child===child)return client;
      }catch{}
      client?.close();
      await delay(125);
    }
    if(this.child===child)this.stopChild();
    throw Error('The built-in lighting service could not start.');
  }
  stopChild(){const child=this.child;this.child=null;child?.kill();}
  close(){this.closed=true;this.stopChild();}
}
module.exports={OpenRgbRuntime};
