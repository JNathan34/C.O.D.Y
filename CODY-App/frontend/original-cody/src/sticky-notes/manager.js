'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');

function placeNote(bounds,displays,preferred,position='top-right'){
  if(!displays.length)return null;
  const candidate=bounds&&['x','y','width','height'].every(key=>Number.isFinite(bounds[key]))?bounds:null;
  const overlap=display=>{const area=display.workArea||display.bounds;return candidate?Math.max(0,Math.min(candidate.x+candidate.width,area.x+area.width)-Math.max(candidate.x,area.x))*Math.max(0,Math.min(candidate.y+candidate.height,area.y+area.height)-Math.max(candidate.y,area.y)):0;};
  const touched=[...displays].sort((a,b)=>overlap(b)-overlap(a));
  const display=overlap(touched[0])>0?touched[0]:displays.find(item=>item.id===preferred?.id)||displays[0];
  const area=display.workArea||display.bounds;
  const width=Math.max(Math.min(220,area.width),Math.min(candidate?.width||300,area.width));
  const height=Math.max(Math.min(180,area.height),Math.min(candidate?.height||280,area.height));
  const x=candidate?.x??(position.endsWith('left')?area.x+18:area.x+area.width-width-18);
  const y=candidate?.y??(position.startsWith('bottom')?area.y+area.height-height-18:area.y+18);
  return {x:Math.round(Math.max(area.x,Math.min(x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(y,area.y+area.height-height))),width:Math.round(width),height:Math.round(height)};
}

class StickyNotes{
  constructor({BrowserWindow,ipcMain,file,displays,primary,neutralWindow=async()=>{},diagnostic=()=>{}}){
    Object.assign(this,{BrowserWindow,ipcMain,file,displays,primary,neutralWindow,diagnostic});
    this.notes=new Map();this.windows=new Map();this.closed=false;this.restored=false;
    this.page=path.join(__dirname,'renderer/index.html');this.url=pathToFileURL(this.page).href;
    this.read=event=>{const entry=this.trusted(event);if(!entry)throw Error('Unknown sticky note window.');return {text:entry.note.text};};
    this.write=(event,text)=>{const entry=this.trusted(event);if(!entry||typeof text!=='string'||text.length>30000)return;entry.note.text=text;this.schedule();};
    this.removeListener=event=>{const entry=this.trusted(event);if(entry)this.remove(entry);};
    ipcMain.handle('sticky-note:read',this.read);ipcMain.on('sticky-note:write',this.write);ipcMain.on('sticky-note:close',this.removeListener);
    try{
      const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!Array.isArray(saved.notes))throw Error('Invalid sticky note file.');
      for(const note of saved.notes){
        if(!note||typeof note.id!=='string'||!/^[a-f\d-]{36}$/i.test(note.id)||typeof note.text!=='string'||note.text.length>30000)continue;
        this.notes.set(note.id,{id:note.id,text:note.text,bounds:note.bounds});
      }
    }catch(error){if(error.code!=='ENOENT'){this.loadError=error;diagnostic('Could not load saved sticky notes. '+error.message);}}
  }
  trusted(event){return [...this.windows.values()].find(entry=>!entry.window.isDestroyed()&&event.sender===entry.window.webContents&&event.senderFrame===event.sender.mainFrame&&event.sender.getURL()===this.url);}
  handle(window){return window.getNativeWindowHandle().readBigUInt64LE().toString();}
  schedule(){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.save(),250);this.saveTimer.unref?.();}
  save(){
    clearTimeout(this.saveTimer);
    try{
      // Preserve a damaged existing file for recovery instead of overwriting it.
      if(this.loadError)throw this.loadError;
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,notes:[...this.notes.values()]},null,2),'utf8');
      fs.renameSync(this.file+'.tmp',this.file);
      this.saved(true);return true;
    }catch(error){this.diagnostic('Could not save sticky notes. '+error.message);this.saved(false);return false;}
  }
  saved(ok){for(const {window} of this.windows.values())if(!window.isDestroyed()){try{window.webContents.send('sticky-note:saved',{ok});}catch{}}}
  async create({text='',position='top-right'}={}){
    if(this.closed)throw Error('Sticky notes are closing.');
    if(typeof text!=='string'||text.length>30000)throw Error('Use up to 30,000 characters in a sticky note.');
    const bounds=placeNote(null,this.displays(),this.primary(),position);
    if(!bounds)throw Error('No permitted monitor is available for this note.');
    const note={id:randomUUID(),text,bounds};
    this.notes.set(note.id,note);
    if(!this.save()){this.notes.delete(note.id);throw Error('Could not save a new sticky note.');}
    try{await this.open(note,{focus:true});}catch(error){this.notes.delete(note.id);this.save();throw error;}
    return {id:note.id};
  }
  async open(note,{focus=false}={}){
    if(this.closed||this.windows.has(note.id))return;
    const bounds=placeNote(note.bounds,this.displays(),this.primary());if(!bounds)return;
    const window=new this.BrowserWindow({title:'Cody sticky note',...bounds,minWidth:Math.min(220,bounds.width),minHeight:Math.min(180,bounds.height),frame:false,show:false,backgroundColor:'#fff0a6',skipTaskbar:true,alwaysOnTop:true,hasShadow:true,resizable:true,movable:true,maximizable:false,minimizable:false,fullscreenable:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webgl:false,spellcheck:true,partition:'cody-sticky-notes'}});
    const entry={window,note,handle:this.handle(window)};this.windows.set(note.id,entry);note.bounds=bounds;
    window.setAlwaysOnTop(true,'screen-saver');window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.webContents.on('render-process-gone',()=>this.diagnostic('A sticky note stopped responding. Its saved text will return when Cody restarts.'));
    window.on('close',event=>{if(!this.closed){event.preventDefault();this.remove(entry);}});
    window.on('closed',()=>{this.windows.delete(note.id);void this.neutralWindow(entry.handle,false).catch(()=>{});});
    const remember=()=>{if(this.closed||window.isDestroyed())return;note.bounds=window.getBounds();this.schedule();};
    window.on('move',()=>{remember();this.reposition(entry);});window.on('resize',remember);
    window.on('moved',()=>this.reposition(entry));window.on('resized',()=>this.reposition(entry));
    try{
      await window.loadFile(this.page);
      await this.neutralWindow(entry.handle,true);
      if(this.closed||window.isDestroyed())return;
      entry.ready=true;
      focus?window.show():window.showInactive();
    }catch(error){if(!window.isDestroyed())window.destroy();throw error;}
  }
  remove(entry){
    if(this.closed||entry.window.isDestroyed())return;
    this.notes.delete(entry.note.id);
    if(!this.save()){this.notes.set(entry.note.id,entry.note);return;}
    entry.window.destroy();
  }
  reposition(entry){
    if(entry.window.isDestroyed())return;
    const bounds=placeNote(entry.window.getBounds(),this.displays(),this.primary());
    if(!bounds){entry.window.hide();return;}
    if(Object.keys(bounds).some(key=>bounds[key]!==entry.window.getBounds()[key]))entry.window.setBounds(bounds,false);
    entry.note.bounds=bounds;this.schedule();
    if(entry.ready&&!entry.window.isVisible())entry.window.showInactive();
  }
  async reconcile(){
    for(const entry of this.windows.values())this.reposition(entry);
    if(this.restored)for(const note of this.notes.values())if(!this.windows.has(note.id))await this.open(note);
  }
  async restore(){
    if(this.restored||this.closed)return;this.restored=true;
    for(const note of this.notes.values()){try{await this.open(note);}catch(error){this.diagnostic(error.message);}}
  }
  async syncNeutral(){for(const entry of this.windows.values())if(!entry.window.isDestroyed())await this.neutralWindow(entry.handle,true);}
  close(){
    if(this.closed)return;this.closed=true;this.save();
    for(const {window} of this.windows.values())if(!window.isDestroyed())window.destroy();
    this.ipcMain.removeHandler('sticky-note:read');this.ipcMain.removeListener('sticky-note:write',this.write);this.ipcMain.removeListener('sticky-note:close',this.removeListener);
  }
}
module.exports={StickyNotes,placeNote};
