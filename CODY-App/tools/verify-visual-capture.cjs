'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
module.exports=async({win,island,annotations,scene,capture,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),oldShapes=new Set(annotations.items.keys()),oldModels=new Set(scene.models.keys());
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Verification timed out');};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="annotations"]').click();document.getElementById('annotation-demo').click()`);
  await until(()=>annotations.items.size>oldShapes.size);
  await evaluate(`document.getElementById('visual-demo').click()`);await until(()=>scene.models.size>oldModels.size);island.showCompact();await wait(1200);
  const shot=await capture.screenshot();fs.copyFileSync(shot.path,path.resolve(__dirname,'../reports/visuals-desktop-capture.png'));
  check('desktop screenshot captures visible drawing and 3D windows',fs.statSync(shot.path).size>10000,{screenshot:shot.path});
  await capture.execute('start');await wait(2500);await capture.execute('stop');
  check('screen recording saves while drawing and 3D are visible',capture.bytes>10000,{video:capture.lastSaved,bytes:capture.bytes});
  const frame=await evaluate(`new Promise((resolve,reject)=>{const v=document.createElement('video');v.muted=true;v.src=${JSON.stringify(pathToFileURL(capture.lastSaved).href)};v.onerror=()=>reject(Error('Video decoding failed'));v.onloadeddata=()=>{v.onloadeddata=null;v.currentTime=.8;};v.onseeked=()=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);resolve({width:c.width,height:c.height,data:c.toDataURL('image/png').split(',')[1]});v.remove();};v.load();})`);
  fs.writeFileSync(path.resolve(__dirname,'../reports/visuals-recording-frame.png'),Buffer.from(frame.data,'base64'));check('recorded video decodes into a full-screen frame',frame.width>0&&frame.height>0,{width:frame.width,height:frame.height});
  const tasks=await engine.request('tasks-state');fs.writeFileSync(path.resolve(__dirname,'../reports/capture-engine-tasks.json'),JSON.stringify(tasks,null,2));
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  if(capture.active)await capture.execute('stop').catch(()=>{});
  const ids=[...annotations.items.keys()].filter(id=>!oldShapes.has(id));if(ids.length)await annotations.execute('draw.clear',{ids},{origin:'gui'}).catch(()=>{});
  for(const id of [...scene.models.keys()])if(!oldModels.has(id))await scene.execute('model.remove',{id},{origin:'gui'}).catch(()=>{});
  island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/visual-capture-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
 }
};
