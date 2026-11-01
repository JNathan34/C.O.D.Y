'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store,spotify,monitors,controller})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),results=[],voice=store.data.settings.voiceAutoSpeak,prior=[...monitors.selected];
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(150);}throw Error('Media check timed out');}
  async function prompt(text){await evaluate(`window.CODYIsland.onPrompt(${JSON.stringify(text)})`);await until(async()=>!await evaluate('window.assistant.state().then(s=>s.busy)'));await wait(250);}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));store.data.settings.voiceAutoSpeak=false;await monitors.execute({action:'clear'});island.show();
    check('media controls enabled by existing app permissions',controller.permissions().enabled&&controller.permissions().audio);
    await prompt('play Iron Man on Plezy');await wait(2500);
    const playback=spotify.snapshot(),reply=store.chat(store.data.activeChatId).messages.filter(message=>message.role==='assistant').at(-1)?.text;
    check('exact requested movie starts in Plezy',playback.app==='Plezy'&&/iron\s*man/i.test(playback.title)&&playback.playing,{app:playback.app,title:playback.title,playing:playback.playing,reply});
    await prompt('pause');await wait(2200);check('plain pause pauses Plezy instead of Spotify',spotify.snapshot().app==='Plezy'&&!spotify.snapshot().playing);
    const before=spotify.snapshot().positionSeconds;await prompt('skip 2 mins');await wait(2200);const after=spotify.snapshot().positionSeconds;
    check('relative seek advances Plezy by two minutes',Number.isFinite(before)&&after-before>=115&&after-before<=125,{before,after});
    await prompt('go back 2 minutes');await wait(2200);check('backward seek returns near the previous position',Math.abs(spotify.snapshot().positionSeconds-before)<5);
    await prompt('play');await wait(2200);check('plain play resumes Plezy',spotify.snapshot().app==='Plezy'&&spotify.snapshot().playing);
    await prompt('pause');
    const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-plezy-playing.png'),(await win.webContents.capturePage(bounds)).toPNG());
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{store.data.settings.voiceAutoSpeak=voice;await monitors.execute({action:'clear'});if(prior.length)await monitors.execute({action:'show',metrics:prior});fs.writeFileSync(path.resolve(__dirname,'../reports/media-controls-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));console.log('MEDIA_CONTROLS_VERIFICATION '+JSON.stringify(results));}
};
