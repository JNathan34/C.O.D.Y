'use strict';
const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {commandText}=require('./command-text');
const {finalizeMp4}=require('./screen-recorder/finalize-mp4');
function captureCommand(input,{recording=false}={}){
  const text=commandText(input).toLowerCase().replace(/[’']/g,'').replace(/[-,]/g,' ').replace(/\s+/g,' ').trim();
  if(/^(?:(?:take|capture|save|grab|make) )?(?:a |the )?(?:screenshot|screen shot|screen capture)(?: (?:of )?(?:my |the )?screen)?$/.test(text)||/^(?:take|capture|save|grab) (?:a )?(?:picture|photo) of (?:my |the )?screen$/.test(text))return 'screenshot';
  if(/^(?:capture|screenshot) (?:my|the) screen$/.test(text))return 'screenshot';
  if(/^(?:(?:start|begin) (?:a |the )?)?(?:screen recording|recording (?:my |the )?screen)$/.test(text)||/^record (?:my |the )?screen$/.test(text))return 'start';
  if(/^(?:start|begin) (?:a |the )?recording$/.test(text))return 'start';
  const match=/^(pause|resume|continue|stop|end|finish) (?:the |my )?(screen recording|screen capture|recording)$/.exec(text);
  if(match)return ({continue:'resume',end:'stop',finish:'stop'})[match[1]]||match[1];
  return null;
}
class ScreenCapture extends EventEmitter{
  constructor({BrowserWindow,ipcMain,desktopCapturer,screen,clipboard,shell,pictures,videos,now=Date.now}){
    super();Object.assign(this,{BrowserWindow,ipcMain,desktopCapturer,screen,clipboard,shell,pictures,videos,now});
    this.status='idle';this.elapsed=0;this.bytes=0;this.pending=new Map();this.tail=Promise.resolve();
    const authorize=event=>{if(event.sender!==this.worker?.webContents||event.senderFrame!==event.sender.mainFrame)throw Error('Untrusted screen recorder');};
    ipcMain.handle('screen-recorder-chunk',async(event,value)=>{
      authorize(event);if(value.session!==this.session||!this.file||value.sequence!==this.sequence++)throw Error('Invalid recording chunk');
      if(!(value.bytes instanceof ArrayBuffer)||value.bytes.byteLength>16*1024*1024)throw Error('Invalid recording data');
      await this.file.writeFile(Buffer.from(value.bytes));this.bytes+=value.bytes.byteLength;return true;
    });
    ipcMain.on('screen-recorder-response',(event,value)=>{try{authorize(event);}catch{return;}
      const request=this.pending.get(value.id);if(!request)return;this.pending.delete(value.id);clearTimeout(request.timer);
      value.error?request.reject(Error(value.error)):request.resolve(value.result);
    });
    ipcMain.on('screen-recorder-failure',(event,message)=>{try{authorize(event);}catch{return;}void this.fail(Error(String(message).slice(0,500)));});
  }
  get active(){return ['starting','recording','paused','stopping'].includes(this.status);}
  snapshot(){const now=this.now();return {status:this.status,elapsedMs:this.elapsed+(this.status==='recording'?now-this.segment:0),capturedAt:now,bytes:this.bytes,savedPath:this.lastSaved||null,screenshotPath:this.lastScreenshot||null,error:this.error||null};}
  publish(){const state=this.snapshot();this.emit('change',state);return state;}
  match(text){return captureCommand(text,{recording:this.active});}
  async source(thumbnail=false){
    const display=this.screen.getPrimaryDisplay(),scale=display.scaleFactor||1;
    const sources=await this.desktopCapturer.getSources({types:['screen'],thumbnailSize:thumbnail?{width:Math.round(display.size.width*scale),height:Math.round(display.size.height*scale)}:{width:0,height:0}});
    const source=sources.find(item=>String(item.display_id)===String(display.id))||(sources.length===1?sources[0]:null);
    if(!source)throw Error('Primary screen is unavailable.');return {source,display};
  }
  filename(prefix,extension){return `${prefix} ${new Date(this.now()).toISOString().replace(/[:.]/g,'-')} ${randomUUID().slice(0,6)}.${extension}`;}
  async screenshot(){
    const {source}=await this.source(true);if(source.thumbnail.isEmpty())throw Error('Windows returned an empty screenshot.');
    await fs.mkdir(this.pictures,{recursive:true});const file=path.join(this.pictures,this.filename('Screenshot','png'));
    await fs.writeFile(file,source.thumbnail.toPNG(),{flag:'wx'});this.lastScreenshot=file;
    this.clipboard?.writeImage(source.thumbnail);this.publish();return {path:file,reply:'Screenshot saved and copied to the clipboard.',confirmation:'Done.'};
  }
  execute(action){
    if(action==='screenshot')return this.screenshot();
    const operation=this.tail.then(()=>this.perform(action));this.tail=operation.catch(()=>{});return operation;
  }
  async request(action,args={}){
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Screen recorder ${action} timed out.`));},30000);
      this.pending.set(id,{resolve,reject,timer});this.worker.webContents.send('screen-recorder-command',{id,action,session:this.session,...args});
    });
  }
  async makeWorker(){
    this.worker=new this.BrowserWindow({show:false,width:320,height:180,webPreferences:{preload:path.join(__dirname,'screen-recorder','preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,partition:'cody-screen-recorder'}});
    this.worker.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(wc===this.worker?.webContents&&permission==='media'));
    this.worker.webContents.session.setPermissionCheckHandler((wc,permission)=>wc===this.worker?.webContents&&permission==='media');
    this.worker.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.worker.webContents.on('will-navigate',event=>event.preventDefault());
    this.worker.webContents.on('render-process-gone',()=>{if(this.active)void this.fail(Error('Screen recorder stopped unexpectedly.'));});
    await this.worker.loadFile(path.join(__dirname,'screen-recorder','index.html'));
  }
  async perform(action){
    if(action==='start'){
      if(this.active)return {reply:'Screen recording is already active.',state:this.snapshot()};
      this.status='starting';this.error=null;this.elapsed=0;this.bytes=0;this.sequence=0;this.session=randomUUID();this.publish();
      try{
        const {source,display}=await this.source();await fs.mkdir(this.videos,{recursive:true});
        this.output=path.join(this.videos,this.filename('Screen recording','mp4'));this.partial=this.output+'.partial';
        this.file=await fs.open(this.partial,'wx');await this.makeWorker();
        await this.request('start',{sourceId:source.id,width:Math.round(display.size.width*(display.scaleFactor||1)),height:Math.round(display.size.height*(display.scaleFactor||1))});
        this.segment=this.now();this.status='recording';this.publish();return {reply:'Screen recording started.',confirmation:'Done.'};
      }catch(error){await this.fail(error);throw error;}
    }
    if(action==='pause'||action==='resume'){
      if(!['recording','paused'].includes(this.status))return {reply:'No screen recording is active.'};
      const desired=action==='pause'?'paused':'recording';if(this.status===desired)return {reply:action==='pause'?'Screen recording is already paused.':'Screen recording is already running.'};
      try{await this.request(action);if(action==='pause')this.elapsed+=this.now()-this.segment;else this.segment=this.now();this.status=desired;this.publish();return {reply:action==='pause'?'Screen recording paused.':'Screen recording resumed.',confirmation:action==='pause'?'Paused.':'Done.'};}
      catch(error){await this.fail(error);throw error;}
    }
    if(action==='stop'){
      if(!['recording','paused'].includes(this.status))return {reply:'No screen recording is active.'};
      if(this.status==='recording')this.elapsed+=this.now()-this.segment;this.status='stopping';this.publish();
      try{
        await this.request('stop');await this.file.sync();await this.file.close();this.file=null;
        if(!this.bytes)throw Error('The recording contained no video.');
        await finalizeMp4(this.partial);
        await fs.rename(this.partial,this.output);this.lastSaved=this.output;this.status='saved';this.destroyWorker();this.publish();
        return {path:this.lastSaved,reply:'Screen recording saved.',confirmation:'Done.'};
      }catch(error){await this.fail(error);throw error;}
    }
    throw Error('Unknown screen capture action.');
  }
  destroyWorker(){const worker=this.worker;this.worker=null;if(worker&&!worker.isDestroyed())worker.destroy();}
  async fail(error){
    this.status='error';this.error=error.message;
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();
    this.destroyWorker();const file=this.file;this.file=null;if(file)await file.close().catch(()=>{});
    if(this.partial){if(this.bytes)await fs.rename(this.partial,this.output.replace(/\.mp4$/i,'.partial.mp4')).catch(()=>{});else await fs.unlink(this.partial).catch(()=>{});}
    this.publish();
  }
  reveal(kind){const file=kind==='screenshot'?this.lastScreenshot:this.lastSaved;if(!file)return false;this.shell.showItemInFolder(file);return true;}
}
module.exports={ScreenCapture,captureCommand};
