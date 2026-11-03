'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[],win=new BrowserWindow({show:false,width:940,height:750,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const size=()=>evaluate('(()=>{const r=document.getElementById("island").getBoundingClientRect(),b=document.getElementById("chat-expand").getBoundingClientRect(),c=document.querySelector(".composer").getBoundingClientRect();return {width:r.width,height:r.height,buttonVisible:b.width>0,buttonInside:b.right<=r.right&&b.left>=r.left,composerInside:c.bottom<=r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight}})()');
 const click=()=>evaluate('document.getElementById("chat-expand").click()');
 try{
  await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
  await evaluate('window.CODYIsland.togglePanel(true);window.CODYIsland.appendMessage("assistant",'+JSON.stringify('## Larger chat\n\nRead longer replies with more room.\n\n- Your conversation stays here\n- Draft messages and attachments stay in place')+');document.getElementById("quick-input").value="Keep my draft";window.CODYIsland.updateInput();void 0');
  const compact=await size();assert.equal(compact.width,520);assert.equal(compact.height,352);
  await click();const expanded=await size();assert.equal(expanded.width,900);assert.equal(expanded.height,716);assert.ok(expanded.buttonInside&&expanded.composerInside);
  assert.ok(await evaluate('document.getElementById("chat-expand").getAttribute("aria-pressed")==="true"&&document.getElementById("quick-input").value==="Keep my draft"&&document.querySelectorAll("#chat-messages .message").length===1'));
  win.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,400));await fs.writeFile(path.resolve(__dirname,'../reports/chat-expanded.png'),(await win.webContents.capturePage()).toPNG());
  await evaluate('window.CODYIsland.setActiveView("settings")');assert.ok(await evaluate('document.getElementById("chat-expand").hidden'));
  await evaluate('window.CODYIsland.setActiveView("chat")');assert.equal((await size()).width,900);
  await evaluate('window.CODYIsland.setState("thinking");window.CODYIsland.setState("idle");');assert.equal((await size()).width,900);
  await evaluate('window.CODYIsland.togglePanel(false);window.CODYIsland.togglePanel(true);');
  assert.equal((await size()).width,520);assert.equal((await size()).height,352);
  assert.equal(await evaluate('document.getElementById("chat-expand").getAttribute("aria-pressed")'),'false');
  assert.equal(await evaluate('document.getElementById("quick-input").value'),'Keep my draft');
  await click();assert.equal((await size()).width,900);
  await click();assert.equal((await size()).width,520);assert.equal(await evaluate('document.getElementById("chat-expand").getAttribute("aria-label")'),'Expand chat');
  win.setContentSize(720,560);await click();const small=await size();assert.ok(small.width<=small.viewportWidth&&small.height<=small.viewportHeight&&small.buttonInside&&small.composerInside);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['top-right expand and compact toggle','conversation and draft preserved','return from Settings and response states preserve size','minimising resets next opening to normal size','fits smaller displays'],compact,expanded,small}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{win.destroy();app.exit(app.exitCode||0);}
});
