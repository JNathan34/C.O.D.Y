'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);let saved;
 const check=(name,passed)=>{results.push({name,passed});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Agents verification timed out');};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));saved=await engine.request('agents-state');
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="agents"]').click()`);await until(()=>evaluate('window.CODYAgents?.snapshot().loaded&&!window.CODYAgents.snapshot().busy'));
  check('all eight Windows privacy capabilities and three native switches are present',await evaluate(`document.querySelectorAll('[data-content="agents"] [data-agent-setting]').length===3&&document.querySelectorAll('[data-capability]').length===8`));
  check('workspace and switches match native saved settings',await evaluate(`document.getElementById('agents-folder-label').textContent.includes(${JSON.stringify(saved.folder||saved.defaultFolder)})&&document.querySelector('[data-agent-setting="voice"]').checked===${saved.voice}&&document.querySelector('[data-agent-setting="cursorUpdates"]').checked===${saved.cursorUpdates}&&document.querySelector('[data-agent-setting="extraUsage"]').checked===${saved.extraUsage}`));
  await evaluate(`document.querySelector('[data-agent-setting="voice"]').click()`);await until(async()=>!(await evaluate('window.CODYAgents.snapshot().busy'))&&(await engine.request('agents-state')).voice!==saved.voice);
  check('announcement switch changes the real native preference',(await engine.request('agents-state')).voice===!saved.voice);
  await evaluate(`document.querySelector('[data-agent-setting="voice"]').click()`);await until(async()=>!(await evaluate('window.CODYAgents.snapshot().busy'))&&(await engine.request('agents-state')).voice===saved.voice);
  check('existing preferences are restored and extra usage is unchanged',(await engine.request('agents-state')).extraUsage===saved.extraUsage);
  await require('node:assert/strict').rejects(engine.request('agents-privacy',{capability:'unknown'}));check('unknown privacy targets are rejected',true);
  await evaluate(`document.querySelector('[data-content="agents"]').scrollTop=0;document.querySelector('.settings-main')?.scrollTo(0,0)`);await wait(300);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/agents-page.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{if(saved)await engine.request('agents-configure',{voice:saved.voice,cursorUpdates:saved.cursorUpdates}).catch(()=>{});island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/agents-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
