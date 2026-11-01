'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
module.exports=async({win,island,store,capture,monitors})=>{
  const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),voice=store.data.settings.voiceAutoSpeak;
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  let wakeEnabled;
  const priorMonitors=monitors?[...monitors.selected]:[];
  async function until(condition){const end=Date.now()+45000;while(Date.now()<end){if(await condition())return;await wait(100);}throw Error('Screen capture check timed out: '+JSON.stringify(capture.snapshot()));}
  async function prompt(text){await evaluate(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);await until(async()=>!await evaluate('window.assistant.state().then(s=>s.busy)'));}
  async function screenshot(name){const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);await fs.writeFile(path.resolve(__dirname,'../reports/'+name),(await win.webContents.capturePage(bounds)).toPNG());}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));wakeEnabled=await evaluate('window.cody.getSettings().then(p=>p.wakeWordEnabled)');await evaluate('window.cody.updateSettings({wakeWordEnabled:false})');store.data.settings.voiceAutoSpeak=false;if(monitors)await monitors.execute({action:'clear'});island.show();
    await prompt('take a screenshot');const image=capture.lastScreenshot;const png=image?await fs.readFile(image):null;
    check('spoken-command route saves real PNG and shows saved card',Boolean(png&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))&&await evaluate(`document.getElementById('island-info-text').textContent==='Screenshot saved'`),{path:image,bytes:png?.length});
    await prompt('start screen recording');await until(()=>capture.status==='recording');island.collapse();await evaluate('window.CODYIsland.togglePanel(false)');await wait(2400);
    const indicator=await evaluate(`(()=>{const dot=document.getElementById('island-recording-dot'),island=document.getElementById('island').getBoundingClientRect(),buttons=[document.getElementById('island-recording-pause'),document.getElementById('island-recording-stop')];return {compact:!document.body.classList.contains('panel-open'),height:island.height,dotVisible:!dot.hidden,animation:getComputedStyle(dot).animationName,buttons:buttons.every(button=>{const r=button.getBoundingClientRect();return !button.disabled&&r.width>0&&r.left>=island.left&&r.right<=island.right;})};})()`);
    check('compact Island shows blinking red dot and usable recording controls',indicator.compact&&indicator.height<=36&&indicator.dotVisible&&indicator.animation==='recording-blink'&&indicator.buttons,indicator);
    await screenshot('island-screen-recording.png');
    await evaluate(`document.getElementById('island-recording-pause').click()`);await until(()=>capture.status==='paused');const paused=capture.snapshot().elapsedMs;await wait(1300);
    check('pause freezes recording timer and changes dot state',capture.snapshot().elapsedMs===paused&&await evaluate(`document.body.dataset.recording==='paused' && getComputedStyle(document.getElementById('island-recording-dot')).animationName==='none'`));
    await screenshot('island-screen-recording-paused.png');
    await prompt('resume screen recording');await until(()=>capture.status==='recording');await wait(1400);
    await evaluate(`document.getElementById('island-recording-stop').click()`);await until(()=>capture.status==='saved'||capture.status==='error');
    check('stop finalizes a nonempty MP4',capture.status==='saved'&&capture.lastSaved.endsWith('.mp4')&&capture.bytes>10000,capture.snapshot());
    const video=await fs.readFile(capture.lastSaved);check('recording has an MP4 container with H.264 video',video.subarray(4,8).toString()==='ftyp'&&video.includes(Buffer.from('avc1')));
    const playback=await evaluate(`new Promise(resolve=>{const video=document.createElement('video');video.muted=true;video.src=${JSON.stringify(pathToFileURL(capture.lastSaved).href)};const timer=setTimeout(()=>{video.remove();resolve({error:'Playback timed out'});},15000);video.onerror=()=>{clearTimeout(timer);resolve({error:video.error?.message});};video.onloadeddata=()=>{clearTimeout(timer);resolve({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,durationMs:video.duration*1000});video.remove();};video.load();})`);
    check('saved recording decodes as playable video',playback.width>0&&playback.height>0,playback);
    check('saved MP4 duration matches the recording timer',Number.isFinite(playback.durationMs)&&Math.abs(playback.durationMs-capture.snapshot().elapsedMs)<1500,playback);
    await until(()=>evaluate(`document.getElementById('island-info-text').textContent==='Recording saved' && document.getElementById('island-recording-controls').hidden`));
    check('saved recording card replaces active controls',await evaluate(`document.getElementById('island-info-text').textContent==='Recording saved' && document.getElementById('island-recording-controls').hidden`));
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{if(capture.active)await capture.execute('stop').catch(()=>{});store.data.settings.voiceAutoSpeak=voice;if(typeof wakeEnabled==='boolean')await evaluate(`window.cody.updateSettings({wakeWordEnabled:${wakeEnabled}})`);if(monitors&&priorMonitors.length)await monitors.execute({action:'show',metrics:priorMonitors});await fs.writeFile(path.resolve(__dirname,'../reports/screen-capture-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));console.log('SCREEN_CAPTURE_VERIFICATION '+JSON.stringify(results));}
};
