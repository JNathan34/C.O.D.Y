'use strict';
const {app,BrowserWindow,screen}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const profile=path.resolve(__dirname,'../reports/model-chat-order-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const engine=new NativeEngine(),results=[];let fixture=false,win;
app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),order=()=>engine.request('control-overlay-order-state');
async function until(predicate){let value;for(let n=0;n<80;n++){value=await order();if(predicate(value))return value;await wait(50);}throw Error('Model/chat ordering timed out: '+JSON.stringify(value));}
app.whenReady().then(async()=>{
 try{
  await engine.refresh();const display=screen.getPrimaryDisplay();win=new BrowserWindow({show:false,x:Math.round(display.bounds.x+(display.bounds.width-940)/2),y:display.bounds.y,width:940,height:750,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.setAlwaysOnTop(true,'screen-saver');await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await win.webContents.executeJavaScript('window.CODYIsland.showIsland(true);window.CODYIsland.togglePanel(true);window.CODYIsland.appendMessage("assistant","The chat stays above your 3D model.");void 0');
  const raw=win.getNativeWindowHandle(),islandHandle=raw.length>=8?raw.readBigUInt64LE(0).toString():String(raw.readUInt32LE(0));await engine.request('control-overlay-order',{clientPid:process.pid,handles:[],islandHandle});
  await engine.request('model-zoom-demo',{streaming:true});fixture=true;win.showInactive();
  await until(value=>value.drawing>0&&value.islandAbove);results.push('chat is above the generating model with no active computer-control overlays');
  await engine.request('drawing-controls-test-finish');await wait(800);const stable=await until(value=>value.islandAbove);let maxRepairs=stable.repairs;
  for(let n=0;n<30;n++){await wait(70);const value=await order();assert.equal(value.islandAbove,true);maxRepairs=Math.max(maxRepairs,value.repairs);}
  assert.ok(maxRepairs-stable.repairs<=1,'Window order is repeatedly being repaired: '+JSON.stringify({before:stable.repairs,after:maxRepairs}));results.push({check:'finished model and chat stay in a stable order',repairsDuringObservation:maxRepairs-stable.repairs});
  for(let n=0;n<3;n++){win.hide();await wait(200);win.showInactive();await until(value=>value.islandAbove);}
  results.push('reopening chat keeps it above the model');
  const before=await order();await engine.request('control-overlay-order-contender',{show:true});await until(value=>value.aboveApps&&value.islandAbove);const after=await order();assert.equal(after.foreground,before.foreground);results.push('an unrelated topmost window does not reverse the model/chat order or steal focus');
  await engine.request('control-overlay-order-contender',{show:false});
  const control=new BrowserWindow({show:false,focusable:false,frame:false,transparent:true,backgroundColor:'#00000000',width:display.bounds.width,height:display.bounds.height,x:display.bounds.x,y:display.bounds.y});
  try{
   control.setAlwaysOnTop(true,'screen-saver');control.setIgnoreMouseEvents(true);control.showInactive();win.setParentWindow(control);
   const handle=control.getNativeWindowHandle(),controlHandle=handle.length>=8?handle.readBigUInt64LE(0).toString():String(handle.readUInt32LE(0));
   await engine.request('control-overlay-order',{clientPid:process.pid,handles:[controlHandle],islandHandle});await engine.request('control-overlay-order-contender',{show:true});
   await until(value=>value.visible===1&&value.aboveApps&&value.islandAbove);results.push('computer-control overlays retain their ordering below chat');
  }finally{win.setParentWindow(null);control.destroy();await engine.request('control-overlay-order',{clientPid:process.pid,handles:[],islandHandle});}
  assert.ok((await engine.request('drawing-controls-state')).models>0);results.push('model remains present behind chat');console.log(JSON.stringify({passed:true,results}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{await engine.request('control-overlay-order-contender',{show:false}).catch(()=>{});if(fixture)await engine.request('model-zoom-demo-clear').catch(()=>{});win?.destroy();fs.writeFileSync(path.resolve(__dirname,'../reports/model-chat-order.json'),JSON.stringify({passed:!app.exitCode,results},null,2));engine.close();await wait(600);app.exit(app.exitCode||0);}
});
