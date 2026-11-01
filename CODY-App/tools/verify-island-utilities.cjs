'use strict';
const fs=require('node:fs');const path=require('node:path');
module.exports=async({win,island,store,engine,desktopTimer})=>{
  const report=path.resolve(__dirname,'../reports/island-utilities-live.json');
  const results=[];const originalSpeak=store.data.settings.voiceAutoSpeak;const hadTimer=Boolean(desktopTimer.snapshot());
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const dom=()=>win.webContents.executeJavaScript(`({text:document.getElementById('island-info-text').textContent,detail:document.getElementById('island-info-detail').textContent,infoVisible:!document.getElementById('island-info').hidden,timerVisible:!document.getElementById('island-timer').hidden,timer:document.getElementById('island-timer-value').textContent,classes:document.body.className})`);
  async function send(text){
    await win.webContents.executeJavaScript(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){await wait(250);if(!await win.webContents.executeJavaScript('window.assistant.state().then(s=>s.busy)'))return;}
    throw Error('Utility request did not finish: '+text);
  }
  try{
    const deadline=Date.now()+60000;
    while(Date.now()<deadline&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))await wait(250);
    island.show();await wait(500);
    await win.webContents.executeJavaScript('window.assistant.saveSettings({voiceAutoSpeak:true})');
    const before=await engine.refresh();await send("What's the time?");
    await win.webContents.executeJavaScript('window.CODYIsland.togglePanel(false)');await wait(600);
    const clock=await dom();await wait(100);let after=await engine.refresh();const speechDeadline=Date.now()+20000;while(after.customSpeech&&Date.now()<speechDeadline){await wait(30);after=await engine.refresh();}results.push({name:'time card and HeyClicky voice',passed:clock.infoVisible&&clock.detail==='Local time'&&after.audioPlaybackStarts>before.audioPlaybackStarts,card:clock,audioPlaybackStarts:after.audioPlaybackStarts-before.audioPlaybackStarts});
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-time-card.png'),(await win.webContents.capturePage({x:210,y:0,width:520,height:90})).toPNG());
    await win.webContents.executeJavaScript('window.assistant.saveSettings({voiceAutoSpeak:false})');
    await send("What's the date?");results.push({name:'date card',passed:(await dom()).infoVisible,card:await dom()});
    await send('12 * 4');results.push({name:'calculator card',passed:/48/.test((await dom()).text),card:await dom()});
    await send('weather in London');const weather=await dom();results.push({name:'weather card',passed:weather.infoVisible&&/weather-layout/.test(weather.classes),liveWeatherAvailable:weather.text!=='Unavailable',card:weather});
    await send("What's the volume?");const volume=await dom();results.push({name:'actual volume card, no volume change',passed:volume.infoVisible&&/Muted|\d+%/.test(volume.text),card:volume});
    await send("What's playing?");const media=await dom();results.push({name:'music display',passed:media.infoVisible,card:media});
    if(!hadTimer){await send('set a timer for 1 minute');await wait(350);const timer=await dom();results.push({name:'timer countdown',passed:timer.timerVisible&&/\d+:\d+/.test(timer.timer),card:timer});await send('cancel timer');}
    fs.writeFileSync(report,JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
    console.log('ISLAND_UTILITIES_VERIFICATION '+JSON.stringify({passed:results.every(r=>r.passed),results}));
  }catch(error){fs.writeFileSync(report,JSON.stringify({passed:false,error:error.stack,results},null,2));console.error(error);}
  finally{if(!hadTimer&&desktopTimer.snapshot())desktopTimer.execute({action:'cancel'});await win.webContents.executeJavaScript(`window.assistant.saveSettings({voiceAutoSpeak:${JSON.stringify(originalSpeak)}})`);}
};
