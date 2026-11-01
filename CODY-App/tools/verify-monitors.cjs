'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store,monitors,engine})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),results=[],voice=store.data.settings.voiceAutoSpeak;
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Monitor check timed out');}
  async function prompt(text){await evaluate(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);await until(async()=>!await evaluate('window.assistant.state().then(s=>s.busy)'));}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));store.data.settings.voiceAutoSpeak=false;island.show();
    await prompt('show my cpu usage and ram');await wait(11000);
    check('CPU and RAM remain pinned after ordinary cards expire',monitors.snapshot().active&&monitors.snapshot().metrics.length===2&&await evaluate(`!document.body.classList.contains('panel-open')&&!document.getElementById('island-info').hidden`));
    await prompt('stop showing cpu');check('individual stop keeps other monitors',monitors.snapshot().metrics.join(',')==='ram');
    await prompt('show wifi details and wifi speed');await until(()=>monitors.data.wifi!==undefined);
    check('Wi-Fi data comes from the active adapter',monitors.data.wifi?.connected===true,{connected:monitors.data.wifi?.connected,linkMbps:monitors.data.wifi?.linkMbps,signalAvailable:Boolean(monitors.data.wifi?.signal)});
    await prompt('run a wifi speed test');await until(()=>!monitors.speedRunning,50000);
    check('real Internet speed test completes and remains pinned',monitors.selected.has('speedtest')&&/Mbps/.test(monitors.values.speedtest.detail),monitors.values.speedtest);
    await prompt('clear the island');check('clear removes all pinned monitors',!monitors.snapshot().active);
    await prompt('show cpu and ram');await wait(500);
    const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-live-monitors.png'),(await win.webContents.capturePage(bounds)).toPNG());
    const status=await engine.refresh();check('CODY native automatic updates disabled',status.automaticUpdatesEnabled===false);
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{store.data.settings.voiceAutoSpeak=voice;fs.writeFileSync(path.resolve(__dirname,'../reports/monitors-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));console.log('MONITORS_VERIFICATION '+JSON.stringify(results));}
};
