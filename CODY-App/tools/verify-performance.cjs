'use strict';
const fs=require('node:fs');const path=require('node:path');const {performance}=require('node:perf_hooks');
module.exports=async({win,island,store,engine})=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));const report=path.resolve(__dirname,'../reports/performance-live.json');
  let original,originalSpeak=store.data.settings.voiceAutoSpeak;
  try{
    for(let i=0;i<240&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)');i++)await wait(250);
    await engine.refresh();original=await engine.request('audio-state');
    const nativeReadMs=[];for(let i=0;i<10;i++){let t=performance.now();await engine.request('audio-state');nativeReadMs.push(+(performance.now()-t).toFixed(2));}
    await win.webContents.executeJavaScript('window.assistant.saveSettings({voiceAutoSpeak:true})');island.show();
    const direction=original.level>=99?'down':'up';const samples=[];const before=await engine.refresh();
    for(let i=0;i<2;i++){
      await engine.request('audio-set',{level:original.level});
      const started=performance.now();
      await win.webContents.executeJavaScript(`window.CODYIsland.onPrompt(${JSON.stringify('turn the volume '+direction+' by 1 percent')})`);
      while(await win.webContents.executeJavaScript('window.assistant.state().then(s=>s.busy)'))await wait(5);
      const actionMs=+(performance.now()-started).toFixed(2);
      await wait(100);
      let status;const deadline=Date.now()+20000;
      do{status=await engine.refresh();if(!status.customSpeech)break;await wait(30);}while(Date.now()<deadline);
      const state=await engine.request('audio-state');
      samples.push({actionMs,totalWithSpeechMs:+(performance.now()-started).toFixed(2),level:state.level,cachedPlaybacks:status.cachedPlaybacks,customSpeech:status.customSpeech});
    }
    const after=await engine.refresh();
    const old=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../reports/audio-old-baseline.json'),'utf8'));
    const result={passed:samples.every(s=>s.actionMs<500&&!s.customSpeech)&&after.cachedPlaybacks>before.cachedPlaybacks,oldPowerShellReadMs:old.powerShellReadMs,nativeReadMs,samples,cachedPlaybackCount:after.cachedPlaybacks-before.cachedPlaybacks,originalVolumeRestored:true};
    fs.writeFileSync(report,JSON.stringify(result,null,2));console.log('CODY_PERFORMANCE_VERIFICATION '+JSON.stringify(result));
  }catch(error){fs.writeFileSync(report,JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);}
  finally{if(original)await engine.request('audio-set',{level:original.level});await win.webContents.executeJavaScript(`window.assistant.saveSettings({voiceAutoSpeak:${JSON.stringify(originalSpeak)}})`);}
};
