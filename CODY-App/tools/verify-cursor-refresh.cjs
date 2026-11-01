'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,overlay,screen})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),follow=overlay.follow;let ticks=0;
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 try{
  for(let i=0;i<300&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)');i++)await wait(100);
  await wait(1000);const display=screen.getDisplayNearestPoint(overlay.floating.point||screen.getCursorScreenPoint()),layer=overlay.windows.get(display.id);if(!layer?.controlReady)throw Error('Floating cursor is hidden or not ready');
  overlay.follow=function(){ticks++;return follow.call(this);};const start=performance.now();await wait(2000);const elapsed=performance.now()-start;
  const timing=await layer.webContents.executeJavaScript(`(()=>{const a=[...window.CODYCursorTiming.intervals].filter(x=>x>0).sort((a,b)=>a-b);return{frames:window.CODYCursorTiming.frames,interval:a[Math.floor(a.length/2)]};})()`),observedHz=1000/timing.interval,pollHz=ticks*1000/elapsed;
  check('renderer frames follow the current monitor refresh rate',Math.abs(observedHz-display.displayFrequency)<Math.max(3,display.displayFrequency*.15),{monitorHz:display.displayFrequency,observedHz,displayId:display.id});
  check('cursor movement is driven by those display frames',Math.abs(pollHz-observedHz)<observedHz*.2,{pollHz,observedHz,elapsed,ticks});
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{overlay.follow=follow;fs.writeFileSync(path.resolve(__dirname,'../reports/cursor-refresh-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
