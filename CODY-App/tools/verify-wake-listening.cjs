'use strict';
const fs=require('node:fs'),path=require('node:path'),{routeRequest}=require('../frontend/original-cody/src/router');
module.exports=async({win,island,engine,wakeListener})=>{
 const results=[],evaluate=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms));const originalHandler=wakeListener.handleCommand,oldState=engine.status.state;let passed=false;
 const check=(name,value,detail)=>{results.push({name,passed:Boolean(value),detail});if(!value)throw Error(name);};
 const until=async test=>{const end=Date.now()+25000;while(Date.now()<end){if(await test())return;await wait(100);}throw Error('Wake-listening verification timed out');};
 const set=async enabled=>{await evaluate(`window.cody.updateSettings({wakeWordEnabled:${enabled},wakeHeyCody:true,wakeOkayCody:true,wakeCody:true})`);};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));await set(false);check('off leaves no wake-recognition process',!wakeListener.child&&wakeListener.snapshot().mode==='off');
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="voice"]').click()`);
  const controls=await evaluate(`['wakeWordEnabled','wakeHeyCody','wakeOkayCody','wakeCody'].every(key=>Boolean(document.querySelector('[data-pref="'+key+'"]')))`);check('Voice settings expose off/on and all phrase choices',controls);
  await evaluate(`document.querySelector('[data-pref="wakeWordEnabled"]').click()`);await until(()=>wakeListener.snapshot().mode==='listening');await wait(700);check('saved switch starts the real local microphone listener',island.preferences().wakeWordEnabled&&wakeListener.ready&&wakeListener.child&&!wakeListener.child.killed,wakeListener.snapshot());
  island.collapse();wakeListener.receive({type:'activity',phrase:'hey cody'});
  await wait(400);check('unconfirmed guesses do not activate the island',wakeListener.mode==='listening'&&await evaluate(`window.CODYIsland.getState()!=='listening'`));
  await wakeListener.accept({text:'Hey Cody',confidence:.9,wakeConfidence:.9,nameConfidence:.9,followup:false});
  await until(()=>evaluate(`document.getElementById('island-info-text').textContent==='Listening…'&&window.CODYIsland.getState()==='listening'`));
  check('confirmed wake phrase displays Listening on the visible island',island.window().isVisible()&&wakeListener.mode==='armed');
  const listeningClip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
  await wait(500);fs.writeFileSync(path.resolve(__dirname,'../reports/wake-listening-indicator.png'),(await win.webContents.capturePage(listeningClip)).toPNG());
  await wakeListener.accept({text:'Hey Cody',confidence:.9,wakeConfidence:.9});
  await until(()=>evaluate(`document.getElementById('island-info-text').textContent==='Listening…'`));check('bare wake phrase keeps listening visible for the follow-up',wakeListener.mode==='armed');
  wakeListener.armedUntil=0;wakeListener.hearingUntil=0;wakeListener.send('wake');wakeListener.update();
  await until(()=>evaluate(`window.CODYIsland.getState()==='idle'`));check('listening indicator clears after the listening window ends',wakeListener.mode==='listening');
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="voice"]').click()`);
  const requests=[];wakeListener.handleCommand=async text=>{requests.push(text);return{started:true};};
  await wakeListener.accept({text:'Hey Cody what is the time',confidence:.9,wakeConfidence:.9,nameConfidence:.9,followup:false});check('recognition strips the address and uses the local time route',requests.length===1&&routeRequest(requests[0],'chat').action==='time',requests);
  engine.status.state='Responding';wakeListener.update();check('CODY speech pauses wake listening',wakeListener.snapshot().mode==='paused');const before=requests.length;await wakeListener.accept({text:'Cody open Firefox',confidence:.99,wakeConfidence:.99,nameConfidence:.99,followup:false});check('speech during replies cannot submit another request',requests.length===before);engine.status.state=oldState;
  await set(false);check('turning off releases the wake microphone process immediately',wakeListener.child===null&&wakeListener.snapshot().mode==='off');
  passed=true;
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  wakeListener.handleCommand=originalHandler;engine.status.state=oldState;await set(passed);if(passed){await until(()=>wakeListener.snapshot().mode==='listening');await wait(600);}
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/wake-listening-settings.png'),(await win.webContents.capturePage(clip)).toPNG());
  fs.writeFileSync(path.resolve(__dirname,'../reports/wake-listening-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results,final:wakeListener.snapshot()},null,2));
 }
};
