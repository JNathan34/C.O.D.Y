'use strict';
const {app,BrowserWindow,screen}=require('electron'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
const {ControlOverlay}=require('../frontend/original-cody/src/control-overlay');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 let overlay,island;const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
 const check=(name,passed)=>{checks.push({name,passed});if(!passed)throw Error(name);};
 const handle=w=>w.getNativeWindowHandle().readBigUInt64LE().toString();
 try{
  island=new BrowserWindow({width:280,height:50,x:200,y:0,show:false,frame:false,focusable:false,skipTaskbar:true});await island.loadURL('data:text/html,Island layering fixture');island.setAlwaysOnTop(true,'screen-saver');island.showInactive();
  const engine=new EventEmitter();overlay=new ControlOverlay({BrowserWindow,screen,engine,getIslandWindow:()=>island,getCursorOptions:()=>({hideFloatingCursor:true})});
  engine.emit('computer-control',{active:true,acting:true,systemInput:true,x:400,y:200});await wait(700);
  const owner=island.getParentWindow();check('the island is owned by its monitor overlay',!!owner&&[...overlay.windows.values()].includes(owner));
  check('system control hides the separate AI pointer',await owner.webContents.executeJavaScript(`document.getElementById('ai-cursor').hidden&&!document.getElementById('glow').hidden`));
  const samples=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'verify-window-order.ps1'),'-Upper',handle(island),'-Lower',handle(owner)],{windowsHide:true},(e,out)=>e?reject(e):resolve(JSON.parse(out))));check('island stays above the glow after repeated overlay raises',samples.above);
  for(let i=0;i<12;i++){overlay.lastRaisedAt=0;overlay.keepOnTop();await wait(80);}
  const after=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'verify-window-order.ps1'),'-Upper',handle(island),'-Lower',handle(owner)],{windowsHide:true},(e,out)=>e?reject(e):resolve(JSON.parse(out))));check('twelve consecutive raises cannot cover the island',after.above);
  engine.emit('computer-control',{active:false});check('removing the glow preserves the island',!island.isDestroyed()&&island.getParentWindow()===null);
 }catch(error){checks.push({name:'verification error',passed:false,error:error.stack});}
 finally{overlay?.close();island?.destroy();fs.writeFileSync(path.resolve(__dirname,'../reports/overlay-layering-live.json'),JSON.stringify({passed:checks.every(c=>c.passed),checks},null,2));app.quit();}
});
