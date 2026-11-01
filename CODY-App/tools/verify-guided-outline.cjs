const {app,BrowserWindow,screen}=require('electron');
const {EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {ControlOverlay}=require('../frontend/original-cody/src/control-overlay');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 let overlay,base;const wait=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  base=new BrowserWindow({width:640,height:400,show:false,backgroundColor:'#303030'});await base.loadURL('data:text/html,<body style="background:%23303030;color:white">Overlay verification');base.showInactive();base.setAlwaysOnTop(true,'screen-saver');
  const engine=new EventEmitter();overlay=new ControlOverlay({BrowserWindow,screen,engine,getCursorOptions:()=>({hideFloatingCursor:true})});
  const display=screen.getPrimaryDisplay(),point=screen.dipToScreenPoint({x:display.bounds.x+200,y:display.bounds.y+120});
  engine.emit('cursor-state',{visible:false,target:{x:point.x,y:point.y,radius:40*display.scaleFactor,label:'Add'}});
  await wait(1300);const win=overlay.windows.get(display.id);
  const state=await win.webContents.executeJavaScript(`(()=>{const t=document.getElementById('guided-target'),r=t.getBoundingClientRect();return {hidden:t.hidden,border:getComputedStyle(t).borderWidth,box:{x:r.x,y:r.y,w:r.width,h:r.height},cursorHidden:document.getElementById('ai-cursor').hidden};})()`);
  if(state.hidden||state.border!=='3px'||!state.cursorHidden||Math.abs(state.box.x-155)>1)throw Error('Guide geometry or visibility failed '+JSON.stringify(state));
  fs.writeFileSync(path.resolve(__dirname,'../reports/guided-outline.png'),(await win.webContents.capturePage({x:145,y:65,width:110,height:110})).toPNG());
  base.moveTop();await wait(850);
  const handle=w=>w.getNativeWindowHandle().readBigUInt64LE().toString();
  const order=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'verify-window-order.ps1'),'-Upper',handle(win),'-Lower',handle(base)],{encoding:'utf8',windowsHide:true}));
  if(!order.above)throw Error('Outline did not recover above competing topmost app');
  engine.emit('cursor-state',{visible:false,target:null});if(overlay.windows.size)throw Error('Outline was not cleared');
  fs.writeFileSync(path.resolve(__dirname,'../reports/guided-outline-live.json'),JSON.stringify({passed:true,state,recoveredAboveCompetingWindow:order.above,cleared:true},null,2));
 }catch(e){fs.writeFileSync(path.resolve(__dirname,'../reports/guided-outline-live.json'),JSON.stringify({passed:false,error:e.stack},null,2));process.exitCode=1;}
 finally{overlay?.close();base?.destroy();app.quit();}
});

