'use strict';
const {EventEmitter}=require('node:events');
const RELEASES_URL='https://github.com/JNathan34/C.O.D.Y/releases';
class UpdateService extends EventEmitter{
  constructor({version,packaged,platform=process.platform,createUpdater,enabled=true,saveEnabled=()=>{},installBlocked=()=>false}){
    super();Object.assign(this,{createUpdater,saveEnabled,installBlocked});
    this.state={currentVersion:version,enabled:enabled!==false,supported:packaged&&platform==='win32',status:packaged&&platform==='win32'?'idle':'development',availableVersion:null,progress:0,lastChecked:null,error:null,releasesUrl:RELEASES_URL};
  }
  snapshot(){return {...this.state};}
  set(patch){Object.assign(this.state,patch);this.emit('change',this.snapshot());return this.snapshot();}
  updater(){
    if(this.client)return this.client;
    const client=this.createUpdater();
    client.autoDownload=false;client.autoInstallOnAppQuit=false;
    client.allowPrerelease=false;client.allowDowngrade=false;
    // This installer ships the full native engine; avoid differential updates.
    client.disableDifferentialDownload=true;
    client.on('checking-for-update',()=>this.set({status:'checking',error:null}));
    client.on('update-available',info=>this.set({status:'available',availableVersion:info.version,progress:0,error:null,lastChecked:new Date().toISOString()}));
    client.on('update-not-available',()=>this.set({status:'current',availableVersion:null,error:null,lastChecked:new Date().toISOString()}));
    client.on('download-progress',value=>this.set({status:'downloading',progress:Math.max(0,Math.min(100,Number(value.percent)||0))}));
    client.on('update-downloaded',info=>this.set({status:'ready',availableVersion:info.version,progress:100,error:null}));
    client.on('error',error=>this.failure(error));
    this.client=client;return client;
  }
  failure(error){
    const noRelease=['ERR_UPDATER_NO_PUBLISHED_VERSIONS','ERR_UPDATER_LATEST_VERSION_NOT_FOUND','ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'].includes(error?.code);
    return this.set({status:'error',error:noRelease?'No update package has been published yet.':String(error?.message||error).slice(0,600)});
  }
  async check(){
    if(!this.state.supported||['checking','downloading','ready','installing'].includes(this.state.status))return this.snapshot();
    this.set({status:'checking',error:null});
    try{await this.updater().checkForUpdates();}catch(error){this.failure(error);}
    return this.snapshot();
  }
  async download(){
    if(!this.state.supported||this.state.status!=='available')throw Error('Check for an available update first.');
    this.set({status:'downloading',progress:0,error:null});
    try{await this.updater().downloadUpdate();}catch(error){this.failure(error);}
    return this.snapshot();
  }
  install(){
    if(!this.state.supported||this.state.status!=='ready')throw Error('Download the update before installing.');
    if(this.installBlocked())throw Error('Finish the current task, voice session, or screen recording before restarting.');
    this.set({status:'installing',error:null});
    try{this.updater().quitAndInstall(false,true);}catch(error){this.failure(error);}
    return this.snapshot();
  }
  configure(enabled){
    if(typeof enabled!=='boolean')throw Error('Invalid update preference.');
    this.saveEnabled(enabled);this.set({enabled});this.schedule();return this.snapshot();
  }
  start(){this.schedule();}
  schedule(){
    this.close();if(!this.state.enabled||!this.state.supported)return;
    this.startTimer=setTimeout(()=>void this.check(),15000);this.startTimer.unref?.();
    this.checkTimer=setInterval(()=>void this.check(),6*60*60*1000);this.checkTimer.unref?.();
  }
  close(){clearTimeout(this.startTimer);clearInterval(this.checkTimer);}
}
function registerUpdateIpc({ipcMain,updates,getWindow,shell}){
  const trusted=event=>{const win=getWindow();if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted update request.');};
  for(const [name,action] of Object.entries({state:()=>updates.snapshot(),check:()=>updates.check(),download:()=>updates.download(),install:()=>updates.install(),configure:value=>updates.configure(value),releases:()=>shell.openExternal(RELEASES_URL)})){
    ipcMain.handle('updates-'+name,(event,value)=>{trusted(event);return action(value);});
  }
}
module.exports={UpdateService,registerUpdateIpc,RELEASES_URL};
