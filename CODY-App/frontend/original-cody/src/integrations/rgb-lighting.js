'use strict';
const {OpenRgbClient}=require('./openrgb');
const {RGB_DISABLED_MESSAGE}=require('../rgb-commands');

const COLORS={listening:[36,233,245],thinking:[243,51,200],speaking:[255,180,92]};

class RgbLighting{
  constructor({connect=()=>new OpenRgbClient(),openClient,stopRuntime=()=>{},onChange=()=>{},pluginEnabled=true}={}){
    this.openClient=openClient|| (async()=>{const client=connect();await client.connect();return client;});
    Object.assign(this,{stopRuntime,onChange,pluginEnabled});
    this.devices=new Map();this.phase='idle';this.enabled=false;this.busy=false;
    this.color='#50dcab';this.brightness=100;
    this.message=pluginEnabled?'Find your compatible RGB devices.':RGB_DISABLED_MESSAGE;
  }
  status(){
    return {pluginEnabled:this.pluginEnabled,enabled:this.enabled,busy:this.busy||Boolean(this.releasing),connected:Boolean(this.client),message:this.message,color:this.color,brightness:this.brightness,
      devices:[...this.devices].map(([id,{name,directIndex,selected}])=>({id,name,available:directIndex>=0,selected:Boolean(selected)}))};
  }
  requirePlugin(){
    if(this.closed)throw Error('Lighting is shutting down.');
    if(!this.pluginEnabled)throw Error(RGB_DISABLED_MESSAGE);
  }
  async setPluginEnabled(enabled){
    if(this.closed)throw Error('Lighting is shutting down.');
    if(this.releasing)throw Error('Wait for RGB Lighting to finish turning off.');
    if(enabled===this.pluginEnabled)return this.status();
    this.pluginEnabled=enabled;
    if(!enabled){
      const release=this.release(RGB_DISABLED_MESSAGE);
      this.update(RGB_DISABLED_MESSAGE);
      await release;
    }
    return this.update(enabled?'Find your compatible RGB devices.':RGB_DISABLED_MESSAGE);
  }
  update(message){if(message)this.message=message;const status=this.status();this.onChange(status);return status;}
  disconnect(message){
    const client=this.client;
    this.client=null;this.enabled=false;this.devices.clear();clearTimeout(this.timer);
    client?.close();this.update(message);
  }
  async discover(){
    this.requirePlugin();
    if(this.enabled||this.busy)throw Error('Turn off reactive lighting before finding devices.');
    const discovery=this.discovery=this.scanDevices();
    try{await discovery;}
    finally{this.discovery=null;}
    return this.update();
  }
  async scanDevices(){
    this.busy=true;this.disconnect('Finding devices…');
    let client;
    let readingList=true;
    try{
      client=await this.openClient();
      if(this.closed||!this.pluginEnabled){client.close();return;}
      this.client=client;
      client.on('devices-changed',()=>{
        if(!readingList&&this.client===client)this.disconnect('The lighting device list changed. Find devices again.');
      });
      client.on('closed',()=>{
        if(this.client===client)this.disconnect('Lighting disconnected. Find devices to reconnect.');
      });
      let stableList;
      for(let attempt=0;attempt<3&&this.pluginEnabled&&!this.closed;attempt++){
        const revision=client.deviceRevision;
        const count=await client.count(),found=new Map();
        for(let id=0;id<count&&client.deviceRevision===revision;id++)found.set(id,await client.device(id));
        if(client.deviceRevision===revision){stableList=found;break;}
      }
      if(this.client===client&&this.pluginEnabled&&!this.closed){
        if(stableList){
          this.devices=stableList;
          this.message=stableList.size?'Choose the devices you want to control.':'No compatible RGB devices found.';
        }else this.message='Lighting devices are still changing. Try Find devices again.';
      }
    }catch(error){
      if(this.pluginEnabled&&!this.closed&&(!client||this.client===client))this.disconnect(error?.message||'Could not read the lighting devices.');
    }finally{readingList=false;this.busy=false;}
  }
  select(id,selected){
    this.requirePlugin();
    if(this.enabled||this.busy)throw Error('Turn off reactive lighting before changing devices.');
    const device=this.devices.get(id);
    if(!device||device.directIndex<0)throw Error('Select a device that supports Direct mode.');
    if(selected&&!device.selected&&[...this.devices.values()].filter(item=>item.selected).length>=8)throw Error('Select up to eight devices.');
    device.selected=selected===true;
    return this.update();
  }
  async enable(value){
    this.requirePlugin();
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
  async setColor(color,brightness=this.brightness,{signal}={}){
    this.requirePlugin();
    if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)||!Number.isInteger(brightness)||brightness<0||brightness>100)
      throw Error('Choose a hex color and brightness between 0 and 100.');
    if(this.busy)throw Error('Lighting is busy.');
    if(!this.client||!this.devices.size)await this.discover();
    signal?.throwIfAborted();
    this.requirePlugin();
    const available=[...this.devices.values()].filter(device=>device.directIndex>=0);
    if(!available.length)return this.update(this.devices.size?'No connected device supports Direct mode.':this.message);
    if(!available.some(device=>device.selected)){
      if(available.length!==1)return this.update('Choose the devices you want to control.');
      available[0].selected=true;
    }
    this.busy=true;clearTimeout(this.timer);
    try{
      await this.running;
      signal?.throwIfAborted();
      this.requirePlugin();
      this.enabled=false;clearTimeout(this.timer);
      const rgb=[...Buffer.from(color.slice(1),'hex')].map(channel=>Math.round(channel*brightness/100));
      const selected=[...this.devices.values()].filter(device=>device.selected).length;
      const applied=await (this.manualWrite=this.apply(rgb,{manual:true}));
      if(applied&&this.pluginEnabled&&!this.closed){this.color=color.toLowerCase();this.brightness=brightness;this.message=`Color set on ${applied===selected?applied:`${applied} of ${selected}`} ${selected===1?'device':'devices'}.`;}
      return {...this.status(),busy:false,applied};
    }finally{this.manualWrite=null;this.busy=false;if(this.enabled)this.schedule();this.update();}
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
    if(!this.pluginEnabled||this.closed||!this.enabled||this.running)return;
    this.timer=setTimeout(()=>{
      const phase=this.phase;
      this.running=this.apply(COLORS[phase]||null).finally(()=>{
        this.running=null;
        if(this.enabled&&phase!==this.phase)this.schedule();
      });
    },125);
  }
  async apply(color,{manual=false}={}){
    const client=this.client;
    const stale=()=>this.client!==client||Boolean(color&&(!this.pluginEnabled||this.closed||!manual&&(!this.enabled||COLORS[this.phase]!==color)));
    let applied=0;
    if(!client)return applied;
    for(const [id,device] of this.devices){
      if(!device.selected||(!color&&!device.last&&!device.originalMode))continue;
      if(stale())break;
      try{
        let current=await client.device(id);
        if(stale())break;
        if(current.directIndex<0||current.signature!==device.signature||
          (device.last&&(!current.direct||!current.colors.equals(device.last)))){
          device.selected=false;device.directIndex=current.signature===device.signature?current.directIndex:-1;
          delete device.last;delete device.original;delete device.originalMode;
          if(![...this.devices.values()].some(item=>item.selected))this.enabled=false;
          this.update(`${device.name} changed outside Cody. Reactive lighting paused for this device.`);
          continue;
        }
        if(color){
          device.original??=current.colors;
          if(!current.direct){
            if(current.modes[current.active])device.originalMode={index:current.active,bytes:current.modes[current.active]};
            await client.setMode(id,current.directIndex,current.modes[current.directIndex]);
            current=await client.device(id);
            if(stale())break;
            if(!current.direct||current.signature!==device.signature)throw Error('Could not activate Direct mode.');
          }
          const next=Buffer.alloc(current.colors.length,Buffer.from([...color,0]));
          if(!next.equals(current.colors))await client.updateColors(id,next);
          device.last=next;
          if(manual){
            const readback=await client.device(id);
            if(!readback.direct||readback.signature!==device.signature||!readback.colors.equals(next))throw Error('Could not verify the new lighting color.');
            delete device.last;delete device.original;delete device.originalMode;
          }
          applied++;
        }else{
          if(!device.original.equals(current.colors))await client.updateColors(id,device.original);
          if(device.originalMode)await client.setMode(id,device.originalMode.index,device.originalMode.bytes);
          delete device.last;delete device.original;delete device.originalMode;
        }
      }catch{
        if(this.client===client)this.disconnect('Could not finish the lighting change. Find devices to reconnect.');
        break;
      }
    }
    return applied;
  }
  async release(message){
    if(this.releasing)return this.releasing;
    this.enabled=false;
    clearTimeout(this.timer);
    this.releasing=(async()=>{
      await this.discovery;
      await this.running;
      await this.restoring;
      await this.manualWrite;
      await this.apply(null);
      this.disconnect(message);
      this.stopRuntime(this.closed===true);
    })();
    try{await this.releasing;}
    finally{this.releasing=null;}
  }
  async close(){
    this.closed=true;
    await this.release();
  }
}

module.exports={RgbLighting};
