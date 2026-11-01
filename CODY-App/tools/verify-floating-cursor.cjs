'use strict';
const fs=require('node:fs'),path=require('node:path'),{app}=require('electron');
module.exports=async({win,island,overlay,engine,screen})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),original=island.preferences();
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Floating cursor check timed out');};
 const set=patch=>evaluate(`window.cody.updateSettings(${JSON.stringify(patch)})`);
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="cursor"]').click()`);
  await set({hideFloatingCursor:false,screenHighlight:true,shakeToDetach:true});await until(()=>overlay.windows.size>0);await wait(400);
  check('floating cursor is enabled by default',original.hideFloatingCursor===false);
  const pointer=screen.getCursorScreenPoint(),point=overlay.floating.point;check('floating cursor follows the desktop pointer with an offset',Math.abs(point.x-pointer.x-14)<2&&Math.abs(point.y-pointer.y-16)<2,{pointer,point});
  const layout=await evaluate(`(()=>{const p=document.querySelector('.cursor-options'),r=p.getBoundingClientRect(),preview=document.querySelector('.cursor-option-preview');return{height:r.height,width:r.width,mask:getComputedStyle(preview).maskImage,toggles:[...document.querySelectorAll('[data-content="cursor"] input')].map(x=>x.dataset.pref)};})()`);
  check('compact colour picker uses sharp vector previews and has all three toggles',layout.height<180&&layout.mask.includes('cursor.svg')&&['hideFloatingCursor','screenHighlight','shakeToDetach'].every(key=>layout.toggles.includes(key)),layout);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/cursor-compact.png'),(await win.webContents.capturePage(clip)).toPNG());
  await set({hideFloatingCursor:true});check('hiding starts a return flight into the notch',overlay.flight?.kind==='return'&&overlay.visible());await until(()=>overlay.windows.size===0);check('Hide floating cursor removes the overlay after landing',!overlay.visible());
  await set({hideFloatingCursor:false});check('showing launches from the notch',overlay.flight?.kind==='launch'&&overlay.flight.from.y<50);await until(()=>overlay.windows.size>0&&!overlay.flight);check('turning Hide off restores the floating cursor after launch',overlay.visible());
  await set({hideFloatingCursor:true});await wait(100);const previousLayer=[...overlay.windows.values()][0];await set({hideFloatingCursor:false});check('changing direction mid-flight keeps the existing overlay and current size',overlay.flight?.kind==='launch'&&overlay.flight.startScale>.18&&[...overlay.windows.values()][0]===previousLayer);await until(()=>!overlay.flight);
  await set({screenHighlight:false});await until(async()=>!(await engine.request('cursor-preferences')).highlightActive);check('Screen highlight off reaches the real native highlighter',!(await engine.request('cursor-preferences')).screenHighlight);
  await set({screenHighlight:true});await until(async()=>(await engine.request('cursor-preferences')).highlightActive);check('Screen highlight on enables the real native highlighter',(await engine.request('cursor-preferences')).screenHighlight);
  overlay.floating.reset();const start=Date.now();for(let i=0;i<8;i++)overlay.floating.update({x:i%2?320:140,y:50},{},start+i*50);overlay.present();const parked={...overlay.floating.point};await wait(350);check('shaking parks the cursor while the real mouse continues independently',overlay.floating.detached&&JSON.stringify(parked)===JSON.stringify(overlay.floating.point),parked);
  await set({shakeToDetach:false});await until(()=>!overlay.floating.detached);check('disabling Shake to detach returns the cursor to following',!overlay.floating.detached);
  const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'island-settings.json'),'utf8'));check('all three cursor options are saved',saved.hideFloatingCursor===false&&saved.screenHighlight===true&&saved.shakeToDetach===false);
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{await set({hideFloatingCursor:original.hideFloatingCursor,screenHighlight:original.screenHighlight,shakeToDetach:original.shakeToDetach}).catch(()=>{});overlay.floating.reset();overlay.preferencesChanged();island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/floating-cursor-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
