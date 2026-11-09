'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store,monitors})=>{
  const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),voice=store.data.settings.voiceAutoSpeak,prior=[...monitors.selected];
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate){const end=Date.now()+45000;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Grouped monitor check timed out');}
  async function prompt(text){await evaluate(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);await until(async()=>!await evaluate('window.assistant.state().then(state=>state.busy)'));await wait(150);}
  async function card(id){await until(()=>evaluate(`document.getElementById('island-info').dataset.monitor===${JSON.stringify(id)}&&!document.getElementById('island-info').hidden`));return evaluate(`(()=>{const top=document.getElementById('island-info-text'),bottom=document.getElementById('island-info-detail');return {top:top.textContent,bottom:bottom.textContent,topSize:parseFloat(getComputedStyle(top).fontSize),bottomSize:parseFloat(getComputedStyle(bottom).fontSize),topFits:top.scrollWidth<=top.clientWidth,bottomFits:bottom.scrollWidth<=bottom.clientWidth};})()`);}
  async function screenshot(name){const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/island-'+name+'.png'),(await win.webContents.capturePage(bounds)).toPNG());}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));store.data.settings.voiceAutoSpeak=false;
    await prompt('clear the island');await prompt('show CPU usage and CPU temperature');await until(()=>!monitors.pending);island.showCompact();await wait(500);
    const cpu=await card('cpu');check('CPU usage and temperature share one card',monitors.snapshot().metrics.join(',')==='cpu'&&/^CPU \d+%$/.test(cpu.top)&&/^(?:Temp \d+°C)?$/.test(cpu.bottom),cpu);
    check('usage is larger and both lines fit',cpu.topSize>cpu.bottomSize&&cpu.topFits&&cpu.bottomFits,cpu);await screenshot('cpu-combined');
    await prompt('stop showing CPU temperature');await wait(1100);check('hiding temperature removes the entire CPU card',!monitors.selected.has('cpu'));
    await prompt('show GPU usage and GPU temp');await until(()=>Number.isFinite(monitors.data.gpu)&&!monitors.pending);const gpu=await card('gpu');
    check('GPU uses a real counter and paired temperature line',monitors.snapshot().metrics.join(',')==='gpu'&&/^GPU \d+%$/.test(gpu.top)&&/^(?:Temp \d+°C)?$/.test(gpu.bottom)&&gpu.topFits&&gpu.bottomFits,gpu);await screenshot('gpu-combined');
    await prompt('hide GPU temp');await prompt('show RAM');const ram=await card('ram');check('RAM shows usage and used/total memory without truncation',/^RAM \d+%$/.test(ram.top)&&/ GB$/.test(ram.bottom)&&ram.topFits&&ram.bottomFits,ram);await screenshot('ram-reviewed');
    await prompt('hide RAM');await prompt('show Wi-Fi details');await until(()=>Boolean(monitors.data.wifi?.connected)&&!monitors.pending);const wifi=await card('wifiDetails');check('Wi-Fi details show signal and paired link rates',/^Wi-Fi/.test(wifi.top)&&/^RX .+ · TX .+$/.test(wifi.bottom)&&wifi.topFits&&wifi.bottomFits,{...wifi,connected:monitors.data.wifi.connected});await screenshot('wifi-details-reviewed');
    await prompt('hide Wi-Fi details');await prompt('show Wi-Fi speed');await until(()=>Number.isFinite(monitors.rx)&&!monitors.pending);const traffic=await card('wifiSpeed');check('Wi-Fi traffic shows measured download above upload',/^↓[\d.]+ Mbps$/.test(traffic.top)&&/^↑[\d.]+ Mbps$/.test(traffic.bottom)&&traffic.topFits&&traffic.bottomFits,traffic);await screenshot('wifi-speed-reviewed');
    await prompt('hide Wi-Fi speed');await prompt('show FPS 24/7');
    await until(()=>evaluate(`!document.getElementById('island-fps').hidden&&/^FPS [0-9]+$/.test(document.getElementById('island-fps-value').textContent)`));
    await prompt('show RAM');await card('ram');
    check('Measured desktop FPS stays visible alongside rotating monitors',await evaluate(`!document.getElementById('island-fps').hidden&&document.getElementById('island-fps-source').textContent==='Desktop'`));
    await prompt('clear the island');await wait(1200);check('cleared monitors stay hidden during sampling',!monitors.snapshot().active&&!JSON.parse(fs.readFileSync(monitors.settingsFile,'utf8')).metrics.length);
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{
    await monitors.execute({action:'clear'});if(prior.length)await monitors.execute({action:'show',metrics:prior});store.data.settings.voiceAutoSpeak=voice;
    fs.writeFileSync(path.resolve(__dirname,'../reports/monitor-groups-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));console.log('MONITOR_GROUPS_VERIFICATION '+JSON.stringify(results));
  }
};
