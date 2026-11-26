'use strict';
const {EventEmitter}=require('node:events');

class IcueLightingClient extends EventEmitter{
  static async connect(engine){
    const {running,devices}=await engine.request('icue-discover');
    return running?new IcueLightingClient(engine,devices):null;
  }
  constructor(engine,devices){
    super();
    this.engine=engine;this.devices=devices;this.provider='iCUE SDK';
    this.offline=()=>this.emit('closed','iCUE disconnected. Choose Find devices to reconnect.');
    engine.on('offline',this.offline);
    engine.on('icue-disconnected',this.offline);
  }
  async setLayerColor(color){
    const {applied}=await this.engine.request('icue-color',{color});
    return applied;
  }
  async close(){
    this.engine.off('offline',this.offline);
    this.engine.off('icue-disconnected',this.offline);
    if(this.engine.connected)await this.engine.request('icue-close');
  }
}

module.exports={IcueLightingClient};
