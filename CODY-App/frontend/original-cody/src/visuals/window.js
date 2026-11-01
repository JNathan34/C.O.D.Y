'use strict';
const {EventEmitter}=require('node:events'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const branding=require('../branding');
class SceneWindow extends EventEmitter{
 constructor({BrowserWindow,ipcMain,timeoutMs=12000}){
  super();Object.assign(this,{BrowserWindow,ipcMain,timeoutMs});this.window=null;this.pending=new Map();this.revision=0;this.generation=0;this.queue=Promise.resolve();this.lastIds=[];
  this.file=path.join(__dirname,'renderer/index.html');this.url=pathToFileURL(this.file).href;
  this.readyListener=(event,message)=>{if(!this.trusted(event))return;if(message?.error)this.readyReject(Error('renderer_unavailable: '+message.error));else this.readyResolve();};
  this.ackListener=(event,message)=>{
   if(!this.trusted(event)||!message||!Number.isSafeInteger(message.revision))return;
   const pending=this.pending.get(message.revision);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(message.revision);
   if(message.error)pending.reject(Error('renderer_unavailable: '+String(message.error).slice(0,250)));
   else if(!Array.isArray(message.ids)||JSON.stringify(message.ids)!==JSON.stringify(pending.ids)||!Number.isSafeInteger(message.meshes)||message.meshes<1||message.meshes>512)pending.reject(Error('renderer_unavailable: 3D state acknowledgment did not match'));
   else pending.resolve({rendered:true,meshes:message.meshes});
  };
  this.changedListener=(event,message)=>{if(this.trusted(event)&&message?.revision===this.revision&&JSON.stringify(message).length<2000)this.emit('changed',message);};
  ipcMain.on('scene:ready',this.readyListener);ipcMain.on('scene:ack',this.ackListener);ipcMain.on('scene:changed',this.changedListener);
 }
 trusted(event){return this.window&&!this.window.isDestroyed()&&event.sender===this.window.webContents&&event.senderFrame===this.window.webContents.mainFrame&&event.sender.getURL()===this.url;}
 async create(viewport){
  if(this.window&&!this.window.isDestroyed())return this.window;
  const {displayId,...bounds}=viewport;
  const window=new this.BrowserWindow({title:'C.O.D.Y 3D scene',icon:branding.icon,...bounds,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:true,skipTaskbar:true,minimizable:false,maximizable:false,fullscreenable:false,resizable:true,minWidth:240,minHeight:240,webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,webgl:true,partition:'cody-visual-scene'}});
  this.window=window;window.setAlwaysOnTop(true,'floating');window.setContentProtection(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  const lost=reason=>{if(this.window===window){this.emit('lost',reason);this.reset();}};
  window.on('closed',()=>lost('3D viewport closed'));window.webContents.on('render-process-gone',()=>lost('3D renderer exited'));window.on('unresponsive',()=>lost('3D renderer unresponsive'));
  window.on('move',()=>{if(this.window===window)this.emit('changed',{type:'viewport',bounds:window.getBounds()});});window.on('resize',()=>{if(this.window===window)this.emit('changed',{type:'viewport',bounds:window.getBounds()});});
  const ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});ready.catch(()=>{});
  const timer=setTimeout(()=>this.readyReject(Error('timeout: 3D renderer startup timed out')),this.timeoutMs);
  try{await window.loadFile(this.file);await ready;}catch(error){this.reset();throw error;}finally{clearTimeout(timer);}
  return window;
 }
 render(scene,signal){
  const generation=this.generation;
  const run=async()=>{
   if(generation!==this.generation||signal?.aborted)throw Error('stale_turn: 3D rendering cancelled');
   const window=await this.create(scene.viewport);if(generation!==this.generation)throw Error('stale_turn: viewport was replaced');
   const {displayId,...bounds}=scene.viewport;window.setBounds(bounds,false);const revision=++this.revision;this.lastIds=scene.models.map(model=>model.id);
   const pending=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(revision);reject(Error('timeout: 3D renderer did not acknowledge'));},this.timeoutMs);this.pending.set(revision,{resolve,reject,timer,ids:this.lastIds});});
   window.webContents.send('scene:state',{...scene,revision});window.showInactive();window.moveTop();return pending;
  };
  const pending=this.queue.then(run);this.queue=pending.catch(()=>{});return pending;
 }
 withoutVisuals(callback,include=false){
  const run=async()=>{
  const window=this.window,generation=this.generation,visible=window&&!window.isDestroyed()&&window.isVisible();
  try{if(visible){if(include)window.setContentProtection(false);else window.hide();await new Promise(resolve=>setTimeout(resolve,80));}return await callback();}
  finally{if(visible&&generation===this.generation&&!window.isDestroyed()){window.setContentProtection(false);window.showInactive();}}
  };
  const pending=this.queue.then(run);this.queue=pending.catch(()=>{});return pending;
 }
 reset(){this.generation++;this.readyReject?.(Error('renderer_unavailable: 3D scene reset'));for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(Error('renderer_unavailable: 3D scene reset'));}this.pending.clear();const window=this.window;this.window=null;if(window&&!window.isDestroyed()){window.hide();window.destroy();}}
 close(){this.reset();this.ipcMain.removeListener('scene:ready',this.readyListener);this.ipcMain.removeListener('scene:ack',this.ackListener);this.ipcMain.removeListener('scene:changed',this.changedListener);}
}
module.exports={SceneWindow};
