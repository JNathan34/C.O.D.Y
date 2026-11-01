'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine,controller,store})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),local=controller.permissions();let original;
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Native permissions verification timed out');};
 const configure=patch=>evaluate(`window.assistant.control.configure(${JSON.stringify(patch)})`);
 const probe=async()=>Promise.all(['takeover','agent'].map(kind=>engine.request('permissions-probe',{kind})));
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));original=await engine.request('permissions-state');
  const tasks=await engine.request('tasks-state'),drive=await engine.request('drive-state');check('permission tests have no active control or background jobs',!drive.active&&!tasks.tasks?.some(t=>!['completed','cancelled','failed','done','stopped'].includes(String(t.status||t.state).toLowerCase())));
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="permissions"]').click()`);await wait(400);
  check('page exposes the native backend controls and clearly scopes local commands',await evaluate(`document.querySelectorAll('[data-native-permission]').length===2&&document.querySelector('[data-content="permissions"]').textContent.includes('C.O.D.Y. QUICK COMMANDS')`));
  check('native controls remain enabled after real settings updates',await evaluate(`[...document.querySelectorAll('[data-native-permission]')].every(input=>!input.disabled)`));
  await evaluate(`document.getElementById('core-control-enabled').checked=false;document.getElementById('core-control-enabled').dispatchEvent(new Event('change',{bubbles:true}))`);await until(async()=>!(await engine.request('permissions-state')).enabled);await wait(100);
  check('master switch blocks both native approval routes without prompting',(await probe()).every(p=>p.decided&&p.allowed===false&&p.pending===0));
  await configure({enabled:true,level:'ask'});check('Ask keeps main and background control requests waiting for a decision',(await probe()).every(p=>!p.decided&&p.pending===1));
  await evaluate(`document.getElementById('core-control-level').value='full';document.getElementById('core-control-level').dispatchEvent(new Event('change',{bubbles:true}))`);await until(async()=>(await engine.request('permissions-state')).level==='full');await wait(150);
  check('Automatic control resolves both native routes without a duplicate permission card',(await probe()).every(p=>p.decided&&p.allowed===true&&p.pending===0));
  check('automatic control never enables paid extra usage implicitly',(await engine.request('permissions-state')).extraUsage===original.extraUsage);
  const status=await engine.request('status'),saved=JSON.parse(fs.readFileSync(path.join(status.stateDirectory,'permissions.json'),'utf8'));check('native permission mode is persisted',saved.enabled===true&&saved.level==='full');
  const input=await evaluate(`(()=>{const x=document.querySelector('[data-native-permission="readApps"]');x.checked=!x.checked;x.dispatchEvent(new Event('change',{bubbles:true}));return x.checked;})()`);await until(async()=>(await engine.request('permissions-state')).readApps===input);check('on-screen context switch changes the real HeyClicky setting',true);
  await configure({level:'approve-safe'});check('Approve for me still asks before native takeover',(await probe()).every(p=>!p.decided&&p.pending===1));
  await evaluate(`document.getElementById('core-emergency').click()`);await until(async()=>!(await engine.request('permissions-state')).enabled);await wait(200);check('emergency stop disables native and local control',!controller.permissions().enabled&&(await probe()).every(p=>p.allowed===false));
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/native-permissions.png'),(await win.webContents.capturePage(clip)).toPNG());
  check('permission probes never start real computer control',!(await engine.request('drive-state')).active);
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  if(original){const {workingFolder,...restore}=original;await engine.request('permissions-configure',restore).catch(()=>{});controller.configure(local);store.setNativePermissions(original);}
  island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/native-permissions-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
 }
};
