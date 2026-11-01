'use strict';
const {EventEmitter}=require('node:events');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {nativeLayout}=require('./native-layout');
class NativeEngine extends EventEmitter {
  constructor(){super();this.pending=new Map();this.connected=false;this.status={signedIn:false,state:'Starting'};}
  async start(){
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const {app}=require('electron');
      const layout=nativeLayout({packaged:app.isPackaged,resourcesPath:process.resourcesPath,userData:app.getPath('userData')});
      this.pipeName=layout.pipeName;
      try{await this.connect();return this;}catch{}
      if(!fs.existsSync(layout.executable))throw Error('C.O.D.Y.’s bundled engine files are missing. Reinstall the complete C.O.D.Y. package.');
      let failure;
      this.child=spawn(layout.executable,['--cody-engine','--background','--allow-capture'],{cwd:layout.directory,env:layout.environment,windowsHide:true,stdio:'ignore'});
      this.child.on('error',error=>{failure=error;this.emit('diagnostic',error.message);});
      this.child.on('exit',code=>{if(!this.connected)failure=Error('C.O.D.Y.’s bundled engine exited during startup (code '+code+').');});
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){if(this.closed)throw Error('C.O.D.Y. startup cancelled.');if(failure)throw failure;try{await this.connect();return this;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
      this.child?.kill();
      throw Error('C.O.D.Y.’s bundled engine did not start. Restart C.O.D.Y. and check its engine log.');
    })();
    return this.starting;
  }
  connect(){return new Promise((resolve,reject)=>{
    const socket=net.connect('\\\\.\\pipe\\'+this.pipeName);let buffer='';let accepted=false;socket.setEncoding('utf8');
    const timeout=setTimeout(()=>{if(!accepted){socket.destroy();reject(Error('Engine pipe timed out'));}},1500);
    socket.once('connect',()=>{accepted=true;clearTimeout(timeout);this.socket=socket;this.connected=true;resolve(this);});
    socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>4000000){socket.destroy();return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{this.receive(JSON.parse(line));}catch(error){this.emit('diagnostic',error.message);}}});
    socket.on('error',error=>{clearTimeout(timeout);if(!accepted)reject(error);else this.emit('diagnostic',error.message);});
    socket.on('close',()=>{if(this.socket===socket){this.connected=false;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('CODY engine disconnected'));}this.pending.clear();this.emit('offline');}});
  });}
  receive(value){
    if(value.event){if(value.event==='phase')this.status.state=value.data.state;this.emit(value.event,value.data);return;}
    const pending=this.pending.get(value.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(value.id);value.error?pending.reject(Error(value.error)):pending.resolve(value.result);
  }
  async request(command,args={}){
    await this.start();
    if(!this.connected)throw Error('CODY engine is offline. Restart C.O.D.Y.');
    const id=randomUUID();
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Native engine request timed out'));},180000);this.pending.set(id,{resolve,reject,timer});this.socket.write(JSON.stringify({id,command,...args})+'\n');});
  }
  async refresh(){this.status=await this.request('status');return this.status;}
  close(){this.closed=true;if(this.connected)this.socket.write(JSON.stringify({id:randomUUID(),command:'quit'})+'\n');else this.child?.kill();}
}
module.exports={NativeEngine};
