'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,overlay,engine,screen})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 const check=(name,passed,detail)=>{results.push({name,passed:Boolean(passed),detail});if(!passed)throw Error(name);};
 const until=async(fn,timeout=30000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(15);}throw Error('Overlay ordering verification timed out');};
 let original;
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));original=await engine.request('drive-state');check('test only changes visuals and does not start computer use',!original.active);
  island.showCompact();const display=screen.getPrimaryDisplay();
  overlay.update({active:true,acting:false,status:'Overlay stacking verification',x:display.bounds.x+300,y:display.bounds.y+200});
  await until(()=>overlay.nativeOrderReady&&[...overlay.windows.values()].every(w=>w.controlReady&&w.isVisible()));
  const initial=await engine.request('control-overlay-order-state');check('native event hooks protect the visible overlays',initial.eventDriven&&initial.visible===screen.getAllDisplays().length,initial);
  const delays=[];
  for(let trial=0;trial<6;trial++){
   const before=await engine.request('control-overlay-order-state'),start=Date.now();
   const contender=await engine.request('control-overlay-order-contender',{show:true});check('always-on-top contender appears without stealing focus '+trial,contender.shown&&contender.foreground===before.foreground);
   await until(async()=>{const value=await engine.request('control-overlay-order-state');return value.aboveApps&&value.islandAbove;},1500);
   const elapsed=Date.now()-start;delays.push(elapsed);check('glow and island recover promptly above another topmost window '+trial,elapsed<300,{elapsed});
   const after=await engine.request('control-overlay-order-state');check('restoring overlay order leaves input focus unchanged '+trial,after.foreground===before.foreground);
   await engine.request('control-overlay-order-contender',{show:false});await wait(50);
  }
  check('island stays owned by its glow window',Boolean(island.window().getParentWindow())&&[...overlay.windows.values()].includes(island.window().getParentWindow()));
  check('native input remains inactive throughout the visual test',!(await engine.request('drive-state')).active,{delays});
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  await engine.request('control-overlay-order-contender',{show:false}).catch(()=>{});
  if(original)overlay.update(original);
  fs.writeFileSync(path.resolve(__dirname,'../reports/overlay-order-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
 }
};
