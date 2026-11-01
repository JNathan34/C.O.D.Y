'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,monitors,engine})=>{
  const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),voice=store.data.settings.voiceAutoSpeak;
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate){const end=Date.now()+45000;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Monitor hide check timed out');}
  async function prompt(text){await evaluate(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);await until(async()=>!await evaluate('window.assistant.state().then(state=>state.busy)'));await wait(150);}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));store.data.settings.voiceAutoSpeak=false;
    await prompt('show CPU usage');await prompt("های it's CPV یوسش");
    check('reported misheard hide command removes CPU locally',!monitors.selected.has('cpu'));
    await prompt('show CPU usage');await prompt('hide CPU usage');await wait(1300);
    check('CPU stays hidden across subsequent samples',!monitors.selected.has('cpu')&&await evaluate(`!document.getElementById('island-info-text').textContent.startsWith('CPU ') || document.getElementById('island-info').hidden`));
    const saved=JSON.parse(fs.readFileSync(monitors.settingsFile,'utf8'));check('hidden state persists on disk',!saved.metrics.includes('cpu'));
    const status=await engine.refresh();check('native speech recognition uses English',status.recognitionLanguage==='en');
    check('language setting offers English and Automatic',await evaluate(`(()=>{const select=document.getElementById('voice-language');return !select.disabled&&select.value==='en'&&[...select.options].some(option=>option.value==='multi');})()`));
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{store.data.settings.voiceAutoSpeak=voice;fs.writeFileSync(path.resolve(__dirname,'../reports/monitor-hide-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));console.log('MONITOR_HIDE_VERIFICATION '+JSON.stringify(results));}
};
