'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const errors=[],win=new BrowserWindow({show:false,width:940,height:750,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 try{
  await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
  await evaluate(`window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="shortcuts"]').click();void 0`);
  const state=await evaluate(`(()=>{const field=document.querySelector('[data-pref="quickMessagePhrase"]'),toggle=document.querySelector('[data-pref="quickMessageEnabled"]'),r=field.getBoundingClientRect(),p=field.closest('.settings-content').getBoundingClientRect();return {phrase:field.value,enabled:toggle.checked,visible:r.width>100&&r.height>20,inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom};})()`);
  assert.equal(state.phrase,'done');assert.equal(state.enabled,true);assert.ok(state.visible&&state.inside);
  await evaluate(`(()=>{const field=document.querySelector('[data-pref="quickMessagePhrase"]');field.value='help';field.dispatchEvent(new Event('change',{bubbles:true}));const toggle=document.querySelector('[data-pref="quickMessageEnabled"]');toggle.click();})()`);
  assert.equal(await evaluate(`document.querySelector('[data-pref="quickMessagePhrase"]').value`),'help');
  assert.equal(await evaluate(`document.querySelector('[data-pref="quickMessageEnabled"]').checked`),false);
  win.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,250));
  await fs.writeFile(path.resolve(__dirname,'../reports/quick-message-settings.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,...state}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{win.destroy();app.exit(app.exitCode||0);}
});
