'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),{EventEmitter}=require('node:events');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {UpdateService,registerUpdateIpc}=require('../frontend/original-cody/src/updates');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const errors=[],checks=[];
  const win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{preload:path.join(__dirname,'updates-preview-preload.cjs'),contextIsolation:true,sandbox:false,backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
  const client=new EventEmitter();
  client.checkForUpdates=async()=>client.emit('update-available',{version:'0.15.2'});
  client.downloadUpdate=async()=>{client.emit('download-progress',{percent:43});client.emit('update-downloaded',{version:'0.15.2'});};
  let installs=0;client.quitAndInstall=()=>installs++;
  const updates=new UpdateService({version:'0.15.1',packaged:true,platform:'win32',createUpdater:()=>client});
  updates.on('change',value=>win.webContents.send('updates-state',value));
  registerUpdateIpc({ipcMain,updates,getWindow:()=>win,shell:{openExternal:()=>{}}});
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function until(code){for(let n=0;n<40;n++){if(await evaluate(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('UI condition timed out: '+code);}
  try{
    await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
    await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
    await until('Boolean(window.CODYIsland)&&document.getElementById("update-version").textContent.includes("0.15.1")');
    await evaluate('window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView("settings");document.querySelector("[data-tab=updates]").click()');
    await new Promise(resolve=>setTimeout(resolve,500));
    await evaluate('document.getElementById("update-check").click()');
    await until('!document.getElementById("update-download").hidden');checks.push('check reveals available version and download action');
    await fs.writeFile(path.resolve(__dirname,'../reports/updates-available.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate('document.getElementById("update-download").click()');
    await until('!document.getElementById("update-install").hidden');checks.push('download reveals restart action');
    const layout=await evaluate('(()=>{const page=document.querySelector("[data-content=updates]"),button=document.getElementById("update-install"),r=button.getBoundingClientRect();return {visible:!page.hidden,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,scroll:page.scrollWidth,client:page.clientWidth};})()');
    assert.ok(layout.visible&&layout.width>0&&layout.height>0&&layout.right<=layout.viewportWidth&&layout.bottom<=layout.viewportHeight&&layout.scroll<=layout.client);checks.push('update page and restart action fit inside window');
    await new Promise(resolve=>setTimeout(resolve,150));
    await fs.writeFile(path.resolve(__dirname,'../reports/updates-ready.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate('document.getElementById("update-install").click()');await until('document.getElementById("update-status").textContent.includes("Opening")');assert.equal(installs,1);checks.push('restart invokes install once');
    updates.set({status:'development',supported:false});await until('document.getElementById("update-check").disabled');checks.push('development UI explains unavailable installation');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,layout}));
  }catch(error){console.error(error);app.exitCode=1;}
  finally{updates.close();win.destroy();app.exit(app.exitCode||0);}
});
