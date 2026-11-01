'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine,controller,store})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 const local=structuredClone(store.data.settings.computerControl);let original;
 const check=(name,passed,detail)=>{results.push({name,passed:Boolean(passed),detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Settings verification timed out');};
 const configure=patch=>evaluate(`window.assistant.control.configure(${JSON.stringify(patch)})`);
 const snapshot=async name=>{await wait(300);const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/'+name),(await win.webContents.capturePage(clip)).toPNG());};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));original=await engine.request('permissions-state');
  const tasks=await engine.request('tasks-state');check('no active computer use or tasks during permission verification',!(await engine.request('drive-state')).active&&!tasks.tasks.some(t=>['Starting','Running','WaitingForUser'].includes(t.status)));
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="agents"]').click()`);
  await until(()=>evaluate('document.querySelectorAll("#agents-privacy button").length===8'));
  const compact=await evaluate(`(()=>{const group=document.getElementById('agents-privacy'),rows=[...group.children];return{height:group.getBoundingClientRect().height,columns:getComputedStyle(group).gridTemplateColumns,count:rows.length,dividers:getComputedStyle(rows[0]).borderRightWidth,labels:rows.every(r=>r.textContent.trim()&&r.querySelector('svg'))};})()`);
  check('eight agent permissions fit into compact paired rows',compact.count===8&&compact.height<=190&&compact.labels&&compact.dividers==='1px',compact);
  await evaluate(`document.getElementById('agents-privacy').scrollIntoView({block:'center'})`);await snapshot('agents-access-compact.png');
  await evaluate(`document.querySelector('[data-tab="permissions"]').click();document.querySelector('.settings-content').scrollTop=0`);
  check('Full access replaces Automatic control and Custom is available',await evaluate(`document.querySelector('#core-control-level option[value="full"] strong').textContent==='Full access'&&Boolean(document.querySelector('#core-control-level option[value="custom"]'))`));
  await configure({enabled:true,level:'ask'});await until(()=>evaluate(`document.getElementById('core-custom-permissions').hidden`));
  check('permission switches are hidden outside Custom mode',await evaluate(`getComputedStyle(document.getElementById('core-custom-permissions')).display==='none'`));
  await configure({level:'custom',computerUse:false,backgroundTasks:true});await until(()=>evaluate(`!document.getElementById('core-custom-permissions').hidden`));
  check('Custom reveals all local and native switches',await evaluate(`document.querySelectorAll('#core-custom-permissions [data-core-permission]').length===15&&document.querySelectorAll('#core-custom-permissions [data-native-permission]').length===4`));
  const probe=kind=>engine.request('permissions-probe',{kind});
  check('disabled computer use blocks main and background takeover', (await probe('takeover')).allowed===false&&(await probe('agent')).allowed===false);
  await configure({computerUse:true,backgroundTasks:false});check('background computer use can be blocked separately',(await probe('takeover')).allowed===true&&(await probe('agent')).allowed===false);
  await configure({clipboard:false,applications:true});check('disabled local permission is enforced',controller.catalog().find(a=>a.name==='clipboard.read').enabled===false&&controller.catalog().find(a=>a.name==='app.open').enabled===true);
  const status=await engine.request('status'),saved=JSON.parse(fs.readFileSync(path.join(status.stateDirectory,'permissions.json'),'utf8'));check('Custom mode and native switches persist',saved.level==='custom'&&saved.computerUse===true&&saved.backgroundTasks===false);
  await snapshot('custom-permissions.png');
  await configure({level:'full'});await until(()=>evaluate(`document.getElementById('core-custom-permissions').hidden`));
  await configure({level:'custom'});check('returning to Custom restores local choices',controller.permissions().clipboard===false);
  // Exercise actual saved website thumbnails without launching their outputs.
  await evaluate('window.CODYTasks.open()');await wait(1800);
  const images=await evaluate(`(()=>{return [...document.querySelectorAll('.task-website-preview img')].filter(img=>img.complete&&img.naturalWidth).map(img=>{const r=img.getBoundingClientRect(),c=img.parentElement.getBoundingClientRect(),bar=img.previousElementSibling.getBoundingClientRect();return{width:r.width,height:r.height,ratio:img.naturalWidth/img.naturalHeight,blank:c.height-r.height-bar.height};});})()`);
  check('website previews fit their whole captured viewport without square blank space',images.length>0&&images.every(x=>Math.abs(x.width/x.height-x.ratio)<.02&&x.blank<4),images);await evaluate(`document.querySelector('.task-website-preview')?.closest('.task-row').scrollIntoView({block:'center'})`);await snapshot('task-previews-fitted.png');
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  if(original){const {workingFolder,...restore}=original;await engine.request('permissions-configure',restore).catch(()=>{});store.data.settings.computerControl=local;store.save();store.setNativePermissions(original);win.webContents.send('settings-changed',store.data.settings);}
  island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/settings-refinement-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
 }
};
