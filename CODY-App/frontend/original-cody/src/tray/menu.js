'use strict';
const path=require('node:path');
class TrayMenu {
  constructor({BrowserWindow,ipcMain,screen,getState,onAction}){
    Object.assign(this,{BrowserWindow,ipcMain,screen,getState,onAction});
    this.handle=(event,action)=>{
      if(!this.window||event.sender!==this.window.webContents||!['open','controls','background','quit','close'].includes(action))return;
      if(['open','quit','close'].includes(action))this.hide();
      if(action!=='close')this.onAction(action);
      this.refresh();
    };
    ipcMain.on('cody-tray-action',this.handle);
  }
  create(){
    if(this.window&&!this.window.isDestroyed())return;
    const w=this.window=new this.BrowserWindow({width:336,height:300,show:false,frame:false,transparent:true,resizable:false,movable:false,skipTaskbar:true,alwaysOnTop:true,hasShadow:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    w.setAlwaysOnTop(true,'pop-up-menu');
    w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    w.webContents.on('will-navigate',event=>event.preventDefault());
    w.on('blur',()=>this.hide());
    w.on('closed',()=>{this.window=null;});
    w.webContents.on('did-finish-load',()=>{this.loaded=true;this.refresh();if(this.pendingShow){this.pendingShow=false;this.show(this.anchor);}});
    this.loaded=false;w.loadFile(path.join(__dirname,'index.html'));
  }
  refresh(){if(this.loaded&&this.window&&!this.window.isDestroyed())this.window.webContents.send('cody-tray-state',this.getState());}
  show(anchor){
    this.anchor=anchor;this.create();if(!this.loaded){this.pendingShow=true;return;}
    const area=this.screen.getDisplayNearestPoint({x:Math.round(anchor.x+anchor.width/2),y:Math.round(anchor.y+anchor.height/2)}).workArea;
    const width=336,height=300;
    const x=Math.max(area.x,Math.min(area.x+area.width-width,Math.round(anchor.x+anchor.width/2-width/2)));
    const y=anchor.y>=area.y+area.height/2?Math.max(area.y,Math.min(anchor.y-height,area.y+area.height-height)):Math.min(area.y+area.height-height,Math.max(area.y,anchor.y+anchor.height));
    this.window.setBounds({x,y,width,height});this.refresh();this.window.show();this.window.focus();
  }
  toggle(anchor){if(this.window?.isVisible())this.hide();else this.show(anchor);}
  hide(){this.pendingShow=false;if(this.window&&!this.window.isDestroyed())this.window.hide();}
  close(){this.ipcMain.removeListener('cody-tray-action',this.handle);this.pendingShow=false;this.window?.destroy();}
}
module.exports={TrayMenu};
