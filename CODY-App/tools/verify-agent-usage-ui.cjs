'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{contextIsolation:false,offscreen:true,backgroundThrottling:false}}),root=path.resolve(__dirname,'..');
 const evaluate=code=>win.webContents.executeJavaScript(code);
 try{
  await win.loadFile(path.join(root,'frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'1'}});
  await evaluate(`window.usageFixture={available:true,plan:'Hey Clicky Pro',agents:{used:42,cap:100,remaining:58},messages:{used:12,cap:200,remaining:188},resetsAt:'2026-11-15T12:00:00Z',updatedAt:'2026-10-31T16:00:00Z'};window.assistant={agents:{usage:async()=>{if(window.usageFailure)throw Error('Engine offline');return window.usageFixture;}},on:()=>{}};void 0;`);
  await evaluate(fs.readFileSync(path.join(root,'frontend/original-cody/src/island/renderer/agent-usage.js'),'utf8'));
  await evaluate(`window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="agents"]').click();`);
  const read=()=>evaluate(`({hidden:document.getElementById('agent-usage-details').hidden,status:document.getElementById('agent-usage-status').textContent,used:document.getElementById('agent-usage-agents-value').textContent,remaining:document.getElementById('agent-usage-agents-remaining').textContent,progress:document.getElementById('agent-usage-agents-meter').value,unlimited:document.getElementById('agent-usage-messages-meter').hidden,reset:document.getElementById('agent-usage-reset').textContent})`);
  async function refresh(code){await evaluate(code+`;document.getElementById('agent-usage-refresh').click()`);await evaluate('Promise.resolve()');return read();}
  let state=await read();assert.equal(state.hidden,false);assert.equal(state.used,'42 / 100 used');assert.equal(state.remaining,'58 remaining');assert.equal(state.progress,42);assert.match(state.reset,/2026/);
  await evaluate("document.body.dataset.reveal='visible';void 0");await new Promise(resolve=>setTimeout(resolve,700));fs.writeFileSync(path.join(root,'reports/agent-usage-ui.png'),(await win.webContents.capturePage()).toPNG());
  state=await refresh('window.usageFixture.agents={used:120,cap:100,remaining:0};window.usageFixture.messages.unlimited=true');assert.equal(state.progress,100);assert.equal(state.used,'120 / 100 used');assert.equal(state.remaining,'0 remaining');assert.equal(state.unlimited,true);
  state=await refresh('window.usageFixture.stale=true;window.usageFixture.error="Cached account data"');assert.equal(state.status,'Cached account data');assert.equal(state.hidden,false);
  state=await refresh('window.usageFixture={available:false,error:"Sign in to Hey Clicky to see your usage."}');assert.equal(state.hidden,true);assert.match(state.status,/Sign in/);
  state=await refresh('window.usageFailure=true');assert.equal(state.hidden,true);assert.match(state.status,/Engine offline/);
  console.log('PASS: allowance, remaining, reset date, over-cap progress, unlimited conversations, stale data, signed-out and offline states.');
 }catch(error){console.error(error);process.exitCode=1;}finally{win.destroy();app.quit();}
});
