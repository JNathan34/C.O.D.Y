'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store,monitors,weather,engine,bindings})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),request=engine.request.bind(engine),originalWeather=weather.current;
 const originalMetrics=[...monitors.selected],originalVoice=store.data.settings.voiceAutoSpeak,originalChat=store.data.activeChatId;let transcript='',wakeEnabled,testChat;
 const check=(name,passed,detail)=>{results.push({name,passed:Boolean(passed),detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Pinned-result verification timed out');};
 const showingPin=()=>evaluate(`Boolean(document.getElementById('island-info').dataset.monitor)`);
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));check('no active voice or task request is interrupted',!bindings.isBusy());
  wakeEnabled=await evaluate('window.cody.getSettings().then(s=>s.wakeWordEnabled)');await evaluate('window.cody.updateSettings({wakeWordEnabled:false})');testChat=store.newChat().id;store.data.settings.voiceAutoSpeak=false;await monitors.execute({action:'show',metrics:['ram']});island.showCompact();
  await until(showingPin);const pinned=[...monitors.selected];
  engine.request=async(command,args)=>command==='begin'?{listening:true}:command==='end'?{utilityText:transcript,transcript}:command==='speak'?{played:true}:request(command,args);
  weather.current=async()=>({reply:'Weather preview check.',card:{kind:'weather',text:'Weather preview',detail:'Temporary display check',icon:'cloud'}});
  // Drive the same begin/end path used by an actual confirmed wake phrase.
  transcript="Hey Cody, what's the time?";await bindings.beginVoice({wake:true});await bindings.endWakeVoice();
  await until(()=>evaluate(`document.getElementById('island-info-detail').textContent==='Local time'&&!document.getElementById('island-info').dataset.monitor`));
  check('Hey Cody time requests show a temporary clock over pinned monitors',true);
  await wait(1100);check('live monitor updates cannot overwrite the requested clock',await evaluate(`document.getElementById('island-info-detail').textContent==='Local time'`));
  await until(showingPin);check('clock expires naturally and restores the pinned selection',JSON.stringify([...monitors.selected])===JSON.stringify(pinned));
  transcript="Okay Cody, what's the weather?";await bindings.beginVoice({wake:true});await bindings.endWakeVoice();
  await until(()=>evaluate(`document.body.classList.contains('weather-layout')&&document.getElementById('island-info-text').textContent==='Weather preview'`));
  check('wake weather requests use the weather card while RAM stays pinned',monitors.selected.has('ram'));
  await wait(1100);check('weather remains visible during telemetry refreshes',await evaluate(`document.body.classList.contains('weather-layout')&&document.getElementById('island-info-text').textContent==='Weather preview'`));
  await until(showingPin);check('weather expiry restores pinned content and removes weather layout',JSON.stringify([...monitors.selected])===JSON.stringify(pinned)&&await evaluate(`!document.body.classList.contains('weather-layout')`));
  check('time and weather requests finish through the local utility route',!bindings.isBusy());
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/pinned-result-restored.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{
  engine.request=request;weather.current=originalWeather;store.data.settings.voiceAutoSpeak=originalVoice;
  const added=[...monitors.selected].filter(metric=>!originalMetrics.includes(metric));if(added.length)await monitors.execute({action:'hide',metrics:added});
  if(testChat){store.deleteChat(testChat);if(originalChat&&store.chat(originalChat))store.select(originalChat);win.webContents.send('chats-changed',store.publicState());}
  if(typeof wakeEnabled==='boolean')await evaluate(`window.cody.updateSettings({wakeWordEnabled:${wakeEnabled}})`);
  fs.writeFileSync(path.resolve(__dirname,'../reports/pinned-result-cards-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
 }
};
