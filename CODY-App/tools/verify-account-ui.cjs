'use strict';
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 let signedIn=true;const actions=[],errors=[];
 ipcMain.handle('preview-account',(_event,name,value)=>{
  if(name==='state')return {defaultFolder:'CODY',privacy:[]};
  if(name==='provider')return {provider:'codex',label:'ChatGPT Codex'};
  if(name==='claudeAccount'){actions.push(value);signedIn=value==='signIn';return {signedIn};}
  if(name==='usage')return {signedIn,available:signedIn,plan:'Hey Clicky Pro',agents:{used:60,cap:150,remaining:90},messages:{unlimited:true},resetsAt:'2026-11-28T20:51:00Z',updatedAt:'2026-11-02T10:00:00Z',error:signedIn?null:'Sign in to Hey Clicky.'};
  if(name==='codexUsage')return {signedIn:true,available:true,plan:'plus',windows:[{label:'5-hour limit',usedPercent:25,remainingPercent:75,resetsAt:'2026-11-02T15:00:00Z'},{label:'Weekly limit',usedPercent:60,remainingPercent:40,resetsAt:'2026-11-08T15:00:00Z'}],updatedAt:'2026-11-02T10:00:00Z'};
  throw Error('Unexpected preview call');
 });
 const win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{offscreen:true,preload:path.join(__dirname,'account-preview-preload.cjs'),contextIsolation:true,sandbox:false,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 async function until(code){for(let n=0;n<60;n++){if(await evaluate(code))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('UI condition timed out: '+code);}
 try{
  await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await until('Boolean(window.CODYIsland)');
  await evaluate('Object.defineProperty(document,"hidden",{get:()=>false});window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView("settings");document.querySelector("[data-tab=agents]").click()');
  await until('!document.getElementById("agent-usage-details").hidden && document.querySelectorAll("#codex-usage-details progress").length===2');
  assert.equal(await evaluate('document.getElementById("agent-usage-plan").textContent'),'Claude Code Usage');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#codex-usage-details progress")].map(x=>x.value)'),[25,60]);
  await evaluate('document.getElementById("claude-sign-out").click()');
  await until('!document.getElementById("claude-sign-in").hidden && document.getElementById("agent-usage-details").hidden');
  assert.ok(!await evaluate('document.getElementById("agent-usage-status").textContent.includes("Clicky")'));
  await evaluate('document.getElementById("claude-sign-in").click()');
  await until('!document.getElementById("claude-sign-out").hidden && !document.getElementById("agent-usage-details").hidden');
  assert.deepEqual(actions,['signOut','signIn']);
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
  await evaluate('window.CODYIsland.showIsland(true);document.querySelector("[data-content=agents]").parentElement.scrollTop=150');
  await new Promise(resolve=>setTimeout(resolve,600));
  const layout=await evaluate('(()=>{const p=document.querySelector("[data-content=agents]"),island=document.getElementById("island");return {width:p.clientWidth,scroll:p.scrollWidth,body:document.body.className,islandHeight:island.getBoundingClientRect().height};})()');assert.ok(layout.scroll<=layout.width);assert.ok(layout.islandHeight>500);
  win.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,300));
  await fs.writeFile(path.resolve(__dirname,'../reports/account-cards.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['Claude Code title','matching Codex progress meters','sign-out and sign-in states (mock account)','no horizontal overflow'],layout}));
 }catch(error){console.error(error);console.error(await evaluate('JSON.stringify({body:document.body.className,hidden:document.querySelector("[data-content=agents]").hidden,status:document.getElementById("agent-usage-status").textContent,codex:document.getElementById("codex-usage-status").textContent,api:!!window.assistant?.agents})'));console.error(errors);app.exitCode=1;}
 finally{win.destroy();app.exit(app.exitCode||0);}
});
