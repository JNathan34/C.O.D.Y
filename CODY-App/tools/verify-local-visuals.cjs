'use strict';
const fs=require('node:fs'),path=require('node:path'),{CodexClient}=require('../frontend/original-cody/src/codex-client');
module.exports=async({win,island,annotations,scene,engine})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),start=CodexClient.prototype.start;
 const oldAnnotations=new Set(annotations.items.keys()),oldModels=new Set(scene.models.keys()),request=engine.request.bind(engine);let starts=0,nativeAI=0;
 engine.request=async(command,...args)=>{if(['submit','speak','begin','game-prepare'].includes(command))nativeAI++;return request(command,...args);};
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async predicate=>{const end=Date.now()+25000;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Local visuals verification timed out');};
 CodexClient.prototype.start=function(...args){starts++;return start.apply(this,args);};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="annotations"]').click()`);await wait(600);
  check('Visuals has only its two local demo buttons and no setting inputs',await evaluate(`(()=>{const page=document.querySelector('[data-content="annotations"]');return page.querySelectorAll('button').length===2&&!page.querySelector('input,select,textarea')&&Boolean(page.querySelector('#annotation-demo')&&page.querySelector('#visual-demo'));})()`));
  await evaluate(`document.getElementById('annotation-demo').click()`);await until(()=>evaluate(`!document.getElementById('annotation-demo').disabled`));
  check('the annotation demo renders locally',annotations.items.size>oldAnnotations.size,await evaluate(`document.getElementById('annotation-status').textContent`));
  await evaluate(`document.getElementById('visual-demo').click()`);await until(()=>evaluate(`!document.getElementById('visual-demo').disabled`));
  check('the computer demo is a local procedural model',scene.models.size>oldModels.size,await evaluate(`document.getElementById('visual-status').textContent`));
  check('opening Visuals and using both demos never starts personal Codex',starts===0,{personalCodexStartAttempts:starts});
  check('neither demo submits AI requests to HeyClicky',nativeAI===0,{nativeAIRequests:nativeAI});await wait(300);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/visuals-demos-only.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{CodexClient.prototype.start=start;engine.request=request;const ids=[...annotations.items.keys()].filter(id=>!oldAnnotations.has(id));if(ids.length)await annotations.execute('draw.clear',{ids},{origin:'gui'}).catch(()=>{});for(const id of scene.models.keys())if(!oldModels.has(id))await scene.execute('model.remove',{id},{origin:'gui'}).catch(()=>{});island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/local-visuals-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
