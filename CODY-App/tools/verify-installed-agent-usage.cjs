'use strict';
const fs=require('node:fs'),path=require('node:path'),WebSocket=require('ws'),assert=require('node:assert/strict');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9337/json')).json(),page=pages.find(p=>p.url.includes('/island/renderer/index.html'));
 const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 let next=0;const pending=new Map();socket.on('message',raw=>{const value=JSON.parse(raw),request=pending.get(value.id);if(request){pending.delete(value.id);clearTimeout(request.timer);value.error?request.reject(Error(value.error.message)):request.resolve(value.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('CDP timeout')),60000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
 try{
  const value=await evaluate('window.assistant.agents.usage()');assert.equal(typeof value.available,'boolean');
  if(value.available){assert.equal(typeof value.agents.used,'number');assert.equal(typeof value.agents.cap,'number');assert.equal(value.agents.remaining,Math.max(0,value.agents.cap-value.agents.used));}
  await evaluate(`window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="agents"]').click();void 0;`);
  await new Promise(resolve=>setTimeout(resolve,1500));
  const ui=await evaluate(`({status:document.getElementById('agent-usage-status').textContent,hidden:document.getElementById('agent-usage-details').hidden,used:document.getElementById('agent-usage-agents-value').textContent,remaining:document.getElementById('agent-usage-agents-remaining').textContent})`);
  assert.equal(ui.hidden,!value.available);if(value.available)assert.ok(ui.used.includes(value.agents.used.toLocaleString()));
  const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.resolve(__dirname,'../reports/agent-usage-installed.png'),Buffer.from(screenshot.data,'base64'));
  fs.writeFileSync(path.resolve(__dirname,'../reports/agent-usage-installed.json'),JSON.stringify({passed:true,account:value,ui},null,2));console.log(JSON.stringify({passed:true,account:value,ui}));
 }finally{socket.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
