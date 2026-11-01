'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));let created=false;
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+40000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Model zoom verification timed out');};
 const state=()=>engine.request('model-zoom-state');
 try{
  await until(()=>win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'));
  const initial=await state();check('native wheel hook is installed',initial.hookInstalled,initial);
  if(initial.figures.length)throw Error('Keep the existing model; fixture needs an empty canvas');
  await engine.request('model-zoom-demo');created=true;await until(async()=>(await state()).figures.length>0);await wait(1800);
  let figure=(await state()).figures[0];const baseline=figure.cameraDistance;check('real native 3D figure is ready',baseline>0,figure);
  const before=Buffer.from((await engine.request('model-zoom-image')).png,'base64');fs.writeFileSync(path.resolve(__dirname,'../reports/model-zoom-before.png'),before);
  const x=Math.round(figure.bounds.x+figure.bounds.width/2),y=Math.round(figure.bounds.y+figure.bounds.height/2),routed=await engine.request('model-zoom-point-test',{x,y,delta:360});check('wheel routing reaches the model under the pointer',routed.accepted,{x,y});
  await until(async()=>{figure=(await state()).figures[0];return figure.initialized&&!figure.animating;});check('scroll up smoothly moves the native camera closer',figure.cameraDistance<baseline*.8&&Math.abs(figure.cameraDistance-figure.target)<.001,figure);
  const after=Buffer.from((await engine.request('model-zoom-image')).png,'base64');fs.writeFileSync(path.resolve(__dirname,'../reports/model-zoom-after.png'),after);check('native model rendering changes after zoom',before.length>1000&&after.length>1000&&!before.equals(after),{beforeBytes:before.length,afterBytes:after.length});
  await engine.request('model-zoom-test',{handle:figure.handle,delta:-360});await until(async()=>{figure=(await state()).figures[0];return !figure.animating;});check('scroll down returns to the original distance',Math.abs(figure.cameraDistance-baseline)<.002,figure);
  check('scroll outside the model is not intercepted',!(await engine.request('model-zoom-point-test',{x:0,y:0,delta:120})).accepted);
  const handle=figure.handle;for(let i=0;i<12;i++)await engine.request('model-zoom-test',{handle,delta:1200});await until(async()=>{figure=(await state()).figures[0];return !figure.animating;});check('zoom in stops at the safe camera limit',Math.abs(figure.cameraDistance-baseline*.45)<.002,figure);
  for(let i=0;i<12;i++)await engine.request('model-zoom-test',{handle,delta:-1200});await until(async()=>{figure=(await state()).figures[0];return !figure.animating;});check('zoom out has a recoverable limit',Math.abs(figure.cameraDistance-baseline*4)<.002,figure);
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{if(created)await engine.request('model-zoom-demo-clear').catch(()=>{});fs.writeFileSync(path.resolve(__dirname,'../reports/model-zoom-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
