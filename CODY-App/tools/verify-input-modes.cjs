'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const originalWake=island.preferences().wakeWordEnabled;
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await wait(80);}throw Error('Input mode verification timed out');};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));await evaluate('window.cody.updateSettings({wakeWordEnabled:false})');island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="cursor"]').click()`);await wait(300);
  check('the input mode selector has been removed',await evaluate(`!document.querySelector('[data-pref="controlInputMode"]')`));
  const prefs=await evaluate(`window.cody.updateSettings({controlInputMode:'independent'})`);
  check('older input mode preferences are ignored',!Object.hasOwn(prefs,'controlInputMode'));
  await engine.request('configure',{systemInput:false});
  check('computer control stays on the Windows mouse and keyboard',(await engine.request('cursor-preferences')).controlInputMode==='system');
  await engine.request('control-fixtures-create');await until(async()=>{const s=await engine.request('control-fixtures-state');return s.native?.button?.width>0;});
  await engine.request('control-fixtures-focus',{family:'native'});await wait(250);let state=await engine.request('control-fixtures-state'),button=state.native.button,before=state.native.clicks;
  const physical=await engine.request('independent-input-probe',{handle:state.native.handle,x:button.x,y:button.y,systemInput:true});await wait(180);state=await engine.request('control-fixtures-state');
  check('system mode moves the real pointer and clicks the native button',physical.clicked==='Done'&&Math.abs(physical.after.x-button.x)<2&&Math.abs(physical.after.y-button.y)<2&&state.native.clicks===before+1,physical);
  check('stopped system control refuses queued clicks',physical.stoppedInputRefused===true);
  check('system control applies the custom cursor and restores it on completion',physical.protectedMouse&&physical.customCursor&&physical.mouseReleased&&physical.normalCursorRestored);
  const guarded=await engine.request('independent-input-probe',{handle:state.native.handle,x:button.x,y:button.y,systemInput:true,gesture:'guard'});
  check('untagged mouse and trackpad-style movement cannot displace Cody',guarded.untaggedBlocked===true&&guarded.mouseReleased&&guarded.normalCursorRestored,guarded);
  const escaped=await engine.request('independent-input-probe',{handle:state.native.handle,x:button.x,y:button.y,systemInput:true,gesture:'escape'});
  check('Esc releases protected input and restores the ordinary pointer',escaped.clicked==='Refused'&&escaped.mouseReleased&&escaped.normalCursorRestored,escaped);

 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{await engine.request('control-fixtures-close').catch(()=>{});island.show();await evaluate(`window.cody.updateSettings({wakeWordEnabled:${Boolean(originalWake)}})`).catch(()=>{});island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/input-modes-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
