'use strict';
// Run with Electron. Capture the current renderer in an isolated demo window;
// no live account, settings, microphone or computer controls are used.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const output=path.resolve(__dirname,'../../docs/screenshots');
const {IslandMonitors,monitorCommand}=require('../frontend/original-cody/src/island-monitors');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 let win,monitors;
 try{
  fs.mkdirSync(output,{recursive:true});
  win=new BrowserWindow({show:false,width:940,height:850,backgroundColor:'#101114',webPreferences:{contextIsolation:true,offscreen:true,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code);
  const capture=async(selector,name,aspect)=>{
   await wait(450);
   const bounds=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
   const zoom=win.webContents.getZoomFactor();
   if(aspect)bounds.height=bounds.width/aspect;
   const rect=Object.fromEntries(Object.entries(bounds).map(([key,value])=>[key,Math.round(value*zoom)]));
   const picture=await win.webContents.capturePage(rect);
   fs.writeFileSync(path.join(output,name+'.png'),picture.toPNG());
   console.log(name,JSON.stringify({css:bounds,pixels:picture.getSize()}));
  };
  await win.loadFile(path.join(root,'frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'1'}});
  win.webContents.setZoomFactor(1);await wait(100);
  await js("window.CODYIsland.applySettings({animationSpeed:'off',idleReactions:'off',pretendSleepEnabled:false,microphoneMuted:false});window.CODYIsland.showIsland(true);window.CODYIsland.togglePanel(true);document.body.classList.add('chat-expanded');");
  await capture('#island','expanded-chat');
  await js("document.body.classList.remove('chat-expanded');window.CODYIsland.setActiveView('settings');window.CODYIsland.setSettingsTab('shortcuts');document.querySelector('.settings-content').scrollTop=0;");
  await capture('.settings-content','settings-shortcuts',1246/1244);
  await js("window.CODYIsland.setSettingsTab('permissions');document.getElementById('core-control-level').value='custom';document.getElementById('core-custom-permissions').hidden=false;document.querySelectorAll('[data-core-permission]').forEach(input=>input.checked=true);document.querySelector('[data-core-permission=systemSettings]').closest('.setting-row').scrollIntoView({block:'center'});");
  await js("(()=>{const content=document.querySelector('.settings-content'),group=document.querySelector('[data-core-permission=systemSettings]').closest('.settings-group'),heading=group.previousElementSibling.previousElementSibling;content.scrollTop+=heading.getBoundingClientRect().top-content.getBoundingClientRect().top;})()");
  await capture('.settings-content','settings-windows-permissions',1246/1110);
  await js("window.CODYIsland.setActiveView('chat');window.CODYIsland.togglePanel(false);");
  win.setContentSize(940,250);win.webContents.setZoomFactor(2);
  const source=fs.readFileSync(path.join(root,'frontend/original-cody/src/island/renderer/assistant.js'),'utf8');
  const begin=source.indexOf('function renderTimer(){'),render=source.slice(begin,source.indexOf("api.on('rps-state'",begin));
  await js("var $=id=>document.getElementById(id),wakeListening=()=>false,capture={status:'idle'},tasks={connected:false,tasks:[]},game={active:false},timer=null,quickCard=null,media={available:false},island=window.CODYIsland,art=$('island-media-art'),monitors={};"+render);
  // Weather is example data for documentation, explicitly labelled in the guide.
  monitors=new IslandMonitors({weather:{current:async()=>({reply:'Example weather reading',card:{kind:'weather',text:'12°C',detail:'Derby',icon:'cloud-sun',tooltip:'Example weather reading for the guide'}})}});
  for(const pin of ['clock','weather']){
   await monitors.execute(monitorCommand('clear the island'));await monitors.execute(monitorCommand('show '+pin));await wait(25);
   await js('monitors='+JSON.stringify(monitors.snapshot())+';renderTimer();window.CODYIsland.setState("idle");document.body.offsetHeight;');
   await capture('#island','pinned-'+pin);
  }
  await js("monitors={active:false,items:[]};renderTimer();window.CODYIsland.applySettings({animationSpeed:'normal',microphoneMuted:true});");
  await capture('#island','microphone-muted');
  await js('window.CODYIsland.applySettings({microphoneMuted:false});');
  await capture('#island','microphone-unmuted');
 }catch(error){console.error(error);process.exitCode=1;}
 finally{monitors?.close();win?.destroy();app.quit();}
});
