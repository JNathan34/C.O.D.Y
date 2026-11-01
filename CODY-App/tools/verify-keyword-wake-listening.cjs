'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine,wakeListener})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 const saved={begin:wakeListener.beginVoice,end:wakeListener.endVoice,cancel:wakeListener.cancelVoice,cue:wakeListener.onWake};let original;
 const check=(name,passed,detail)=>{results.push({name,passed:Boolean(passed),detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Keyword wake verification timed out: '+JSON.stringify(wakeListener.snapshot()));};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));original=await evaluate('window.cody.getSettings()');
  await evaluate('window.cody.updateSettings({wakeWordEnabled:false})');check('off releases the native wake process',!wakeListener.child);
  await evaluate('window.cody.updateSettings({wakeWordEnabled:true,wakeHeyCody:true,wakeOkayCody:true,wakeCody:true})');
  await until(()=>wakeListener.mode==='listening');await wait(600);check('real local keyword detector and microphone reach acknowledged standby',wakeListener.ready&&wakeListener.confirmed===wakeListener.epoch&&wakeListener.child&&!wakeListener.child.killed,wakeListener.snapshot());
  const calls=[];wakeListener.beginVoice=async options=>{calls.push(['begin',options]);return{listening:true};};wakeListener.endVoice=async()=>{calls.push(['end']);};wakeListener.cancelVoice=async()=>calls.push(['cancel']);wakeListener.onWake=async()=>calls.push(['cue']);
  wakeListener.receive({type:'activity',phrase:'hey cody'});wakeListener.receive({type:'wake',phrase:'hey cody',epoch:wakeListener.epoch-1});await wait(200);check('ambient activity and stale detections cannot open a request',calls.length===0&&wakeListener.mode==='listening');
  island.collapse();wakeListener.receive({type:'wake',phrase:'hey cody',epoch:wakeListener.epoch});await until(()=>wakeListener.capture);
  await until(()=>evaluate(`document.getElementById('island-info-text').textContent==='Listening…'&&window.CODYIsland.getState()==='listening'`));check('confirmed wake shows listening and completes microphone handoff before cue',calls.map(x=>x[0]).join(',')==='begin,cue'&&wakeListener.wire==='pause'&&wakeListener.confirmed===wakeListener.epoch);
  wakeListener.heard('Hey Cody what is the time');wakeListener.lastSpeech=Date.now()-1500;wakeListener.lastTranscriptAt=Date.now()-600;wakeListener.update();await until(()=>calls.some(c=>c[0]==='end'));check('one-sentence request ends automatically after silence',calls.filter(c=>c[0]==='end').length===1);
  await until(()=>wakeListener.mode==='listening');
  wakeListener.receive({type:'wake',phrase:'hey cody',epoch:wakeListener.epoch});await until(()=>wakeListener.capture);wakeListener.heard('Hey Cody');wakeListener.started=Date.now()-8100;wakeListener.update();await until(()=>calls.some(c=>c[0]==='cancel'));check('wake without a request times out without submitting',calls.filter(c=>c[0]==='end').length===1);
  await until(()=>wakeListener.mode==='listening');
  wakeListener.receive({type:'wake',phrase:'hey cody',epoch:wakeListener.epoch});await until(()=>wakeListener.capture);
  wakeListener.heard('open Firefox and then');wakeListener.lastSpeech=Date.now()-1500;wakeListener.lastTranscriptAt=Date.now()-600;wakeListener.update();
  check('unfinished sentence stays open through a thinking pause',wakeListener.capture&&calls.filter(c=>c[0]==='end').length===1);
  wakeListener.heard('open Firefox and then actually cancel');await until(()=>!wakeListener.capture&&!wakeListener.finishing);
  await until(()=>evaluate(`window.CODYIsland.getState()!=='listening'`));check('spoken cancel closes the listening UI without submitting the request',calls.filter(c=>c[0]==='end').length===1&&calls.filter(c=>c[0]==='cancel').length===2);
  await until(()=>wakeListener.mode==='listening');
  const oldEpoch=wakeListener.epoch;await evaluate('window.cody.updateSettings({wakeHeyCody:false,wakeCody:false})');await until(()=>wakeListener.mode==='listening');wakeListener.receive({type:'wake',phrase:'hey cody',epoch:oldEpoch});wakeListener.receive({type:'wake',phrase:'cody',epoch:wakeListener.epoch});check('disabled aliases and detections from replaced processes are ignored',!wakeListener.capture);
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="voice"]').click()`);await wait(300);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/keyword-wake-settings.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  wakeListener.beginVoice=saved.begin;wakeListener.endVoice=saved.end;wakeListener.cancelVoice=saved.cancel;wakeListener.onWake=saved.cue;
  if(original)await evaluate(`window.cody.updateSettings(${JSON.stringify(Object.fromEntries(['wakeWordEnabled','wakeHeyCody','wakeOkayCody','wakeCody'].map(k=>[k,original[k]])))})`);
  if(original?.wakeWordEnabled&&original&&(original.wakeHeyCody||original.wakeOkayCody||original.wakeCody))await until(()=>wakeListener.mode==='listening');
  island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/keyword-wake-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results,final:wakeListener.snapshot()},null,2));
 }
};
