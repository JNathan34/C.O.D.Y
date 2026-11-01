'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {EventEmitter}=require('node:events');
class AnnotationOverlay extends EventEmitter{
 constructor({BrowserWindow,ipcMain,screen,timeoutMs=8000}){
  super();
  Object.assign(this,{BrowserWindow,ipcMain,screen,timeoutMs});this.windows=new Map();this.pending=new Map();this.revision=0;this.generation=0;this.queue=Promise.resolve();this.lastScene=[];this.displays=[];
  this.file=path.join(__dirname,'renderer/index.html');this.url=pathToFileURL(this.file).href;
  this.readyListener=event=>{const entry=this.trusted(event);if(entry)entry.readyResolve();};
  this.ackListener=(event,message)=>{
   const entry=this.trusted(event);if(!entry||!message||!Number.isSafeInteger(message.revision))return;
   const key=entry.id+':'+message.revision,pending=this.pending.get(key);if(!pending)return;
   clearTimeout(pending.timer);this.pending.delete(key);
   if(message.error)pending.reject(Error('Annotation renderer: '+String(message.error).slice(0,250)));
   else if(!Array.isArray(message.ids)||JSON.stringify([...message.ids].sort())!==JSON.stringify([...pending.ids].sort()))pending.reject(Error('Annotation overlay did not render the expected shapes'));
   else pending.resolve();
  };
  ipcMain.on('annotation-overlay:ready',this.readyListener);ipcMain.on('annotation-overlay:ack',this.ackListener);
 }
 trusted(event){return [...this.windows.values()].find(entry=>!entry.window.isDestroyed()&&event.sender===entry.window.webContents&&event.senderFrame===entry.window.webContents.mainFrame&&event.sender.getURL()===this.url);}
 async create(display){
  const id=String(display.id);let entry=this.windows.get(id);if(entry&&!entry.window.isDestroyed())return entry;
  const window=new this.BrowserWindow({title:'C.O.D.Y screen annotations',...display.bounds,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,show:false,skipTaskbar:true,focusable:false,resizable:false,movable:false,fullscreenable:false,minimizable:false,maximizable:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webgl:false,backgroundThrottling:false,partition:'cody-screen-annotations'}});
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  ready.catch(()=>{});
  entry={id,window,ready,readyResolve,readyReject};this.windows.set(id,entry);
  window.setIgnoreMouseEvents(true,{forward:true});window.setAlwaysOnTop(true,'screen-saver');window.setContentProtection(false);window.setFocusable(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
  const failed=()=>{readyReject(Error('Annotation overlay crashed'));this.emit('lost','annotation renderer crashed');this.reset();};
  window.webContents.once('render-process-gone',failed);window.webContents.on('unresponsive',failed);
  window.once('closed',()=>{if(this.windows.get(id)===entry){this.windows.delete(id);this.emit('lost','annotation renderer closed');}readyReject(Error('Annotation overlay closed'));});
  const timer=setTimeout(()=>readyReject(Error('Annotation overlay startup timeout')),this.timeoutMs);
  try{await window.loadFile(this.file);await ready;}catch(error){this.reset();throw error;}finally{clearTimeout(timer);}
  return entry;
 }
 render(scene,displays,signal){
  const generation=this.generation;this.lastScene=scene;this.displays=displays;
  const run=async()=>{
   if(generation!==this.generation||signal?.aborted)throw Error('Annotation overlay request cancelled');
   if(!scene.length){for(const entry of this.windows.values())entry.window.hide();return;}
   const revision=++this.revision;
   await Promise.all(displays.map(async display=>{
    const entry=await this.create(display);if(generation!==this.generation||signal?.aborted)throw Error('Annotation overlay request cancelled');
    const window=entry.window;window.setBounds(display.bounds,false);window.setIgnoreMouseEvents(true,{forward:true});
    const done=new Promise((resolve,reject)=>{
     const key=entry.id+':'+revision;
     const timer=setTimeout(()=>{this.pending.delete(key);reject(Error('Annotation overlay render timeout'));},this.timeoutMs);
     this.pending.set(key,{resolve,reject,timer,ids:scene.map(shape=>shape.id)});
     window.webContents.send('annotation-overlay:scene',{revision,display,shapes:scene});
    });
    window.showInactive();window.setAlwaysOnTop(true,'screen-saver');window.moveTop();await done;
    if(generation!==this.generation||signal?.aborted)throw Error('Annotation overlay request cancelled');
   }));
  };
  const pending=this.queue.then(run);this.queue=pending.catch(()=>{});return pending;
 }
 withoutAnnotations(capture,{includeAnnotations=false}={}){
  const run=async()=>{
   const generation=this.generation,visible=[...this.windows.values()].filter(entry=>entry.window.isVisible());
   try{
    for(const entry of visible){if(includeAnnotations)entry.window.setContentProtection(false);else entry.window.hide();}
    if(visible.length)await new Promise(resolve=>setTimeout(resolve,100));
    return await capture();
   }finally{
    if(generation===this.generation)for(const entry of visible)if(!entry.window.isDestroyed()){entry.window.setContentProtection(false);if(this.lastScene.length){entry.window.showInactive();entry.window.moveTop();}}
   }
  };
  const pending=this.queue.then(run);this.queue=pending.catch(()=>{});return pending;
 }
 reset(){
  this.generation++;this.lastScene=[];
  for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('Annotation overlay cancelled'));}this.pending.clear();
  const entries=[...this.windows.values()];this.windows.clear();for(const entry of entries)if(!entry.window.isDestroyed()){entry.window.hide();entry.window.destroy();}
 }
 close(){this.reset();this.ipcMain.removeListener('annotation-overlay:ready',this.readyListener);this.ipcMain.removeListener('annotation-overlay:ack',this.ackListener);}
}
module.exports={AnnotationOverlay};
