'use strict';
const {OpenRgbClient}=require('./openrgb');

const COLORS={listening:[36,233,245],thinking:[243,51,200],speaking:[255,180,92]};

class RgbLighting{
  constructor({connect=()=>new OpenRgbClient(),onChange=()=>{}}={}){
    Object.assign(this,{connect,onChange});
    this.devices=new Map();this.phase='idle';this.enabled=false;this.busy=false;
    this.message='Start the SDK Server in OpenRGB, then find your devices.';
  }
  status(){
    return {enabled:this.enabled,busy:this.busy,connected:Boolean(this.client),message:this.message,
      devices:[...this.devices].map(([id,{name,direct,selected}])=>({id,name,direct,selected:Boolean(selected)}))};
  }
  update(message){if(message)this.message=message;const status=this.status();this.onChange(status);return status;}
  disconnect(message){
    const client=this.client;
    this.client=null;this.enabled=false;this.devices.clear();clearTimeout(this.timer);
    client?.close();this.update(message);
  }
  async discover(){
    if(this.enabled||this.busy)throw Error('Turn off reactive lighting before finding devices.');
    this.busy=true;this.disconnect('Finding devices…');
    const client=this.client=this.connect();
    client.on('devices-changed',()=>{
      if(this.client===client)this.disconnect('The OpenRGB device list changed. Find devices and select them again.');
    });
    client.on('closed',()=>{
      if(this.client===client)this.disconnect('OpenRGB disconnected. Find devices to reconnect.');
    });
    try{
      await client.connect();
      const count=await client.count(),found=new Map();
      for(let id=0;id<count;id++)found.set(id,await client.device(id));
      if(this.client===client){
        this.devices=found;
        this.message=count?'Select your devices. Set them to Direct mode in OpenRGB first.':'OpenRGB found no devices.';
      }
    }catch{
      if(this.client===client)this.disconnect('Could not read OpenRGB. Start its local SDK Server on port 6742 and try again.');
    }finally{this.busy=false;}
    return this.update();
  }
  select(id,selected){
    if(this.enabled||this.busy)throw Error('Turn off reactive lighting before changing devices.');
    const device=this.devices.get(id);
    if(!device?.direct)throw Error('Select a device in Direct mode.');
    if(selected&&!device.selected&&[...this.devices.values()].filter(item=>item.selected).length>=8)throw Error('Select up to eight devices.');
    device.selected=selected===true;
    return this.update();
  }
  async enable(value){
    if(this.busy)throw Error('Wait for OpenRGB to finish.');
    if(value===this.enabled)return this.status();
    if(value){
      if(!this.client||![...this.devices.values()].some(device=>device.selected))throw Error('Find and select an OpenRGB device first.');
      this.enabled=true;this.schedule();
      return this.update('Reactive lighting is on.');
    }
    this.enabled=false;this.busy=true;clearTimeout(this.timer);this.update('Restoring device colors…');
    this.restoring=this.restore();
    try{return await this.restoring;}
    finally{this.restoring=null;}
  }
  async restore(){
    await this.running;
    await this.apply(null);
    this.busy=false;
    return this.update(this.message==='Restoring device colors…'?'Reactive lighting is off.':undefined);
  }
  setPhase(phase){if(this.phase!==phase){this.phase=phase;if(this.enabled)this.schedule();}}
  schedule(){
    clearTimeout(this.timer);
    if(!this.enabled||this.running)return;
    this.timer=setTimeout(()=>{
      const phase=this.phase;
      this.running=this.apply(COLORS[phase]||null).finally(()=>{
        this.running=null;
        if(this.enabled&&phase!==this.phase)this.schedule();
      });
    },125);
  }
  async apply(color){
    const client=this.client;
    if(!client)return;
    for(const [id,device] of this.devices){
      if(!device.selected||(!color&&!device.last))continue;
      if(this.client!==client||(color&&(!this.enabled||COLORS[this.phase]!==color)))return;
      try{
        const current=await client.device(id);
        if(this.client!==client||(color&&(!this.enabled||COLORS[this.phase]!==color)))return;
        if(!current.direct||current.signature!==device.signature||(device.last&&!current.colors.equals(device.last))){
          device.selected=false;device.direct=current.direct&&current.signature===device.signature;
          delete device.last;delete device.original;
          if(![...this.devices.values()].some(item=>item.selected))this.enabled=false;
          this.update(`${device.name} changed outside Cody. Reactive lighting paused for this device.`);
          continue;
        }
        if(color){
          device.original??=current.colors;
          const next=Buffer.alloc(current.colors.length,Buffer.from([...color,0]));
          if(!next.equals(current.colors))await client.updateColors(id,next);
          device.last=next;
        }else{
          if(!device.original.equals(current.colors))await client.updateColors(id,device.original);
          delete device.last;delete device.original;
        }
      }catch{
        if(this.client===client)this.disconnect('OpenRGB stopped responding. Check the device colors in OpenRGB before reconnecting.');
        return;
      }
    }
  }
  async close(){
    if(this.enabled&&!this.busy)await this.enable(false);
    await this.restoring;
    this.disconnect();
  }
}

module.exports={RgbLighting};
