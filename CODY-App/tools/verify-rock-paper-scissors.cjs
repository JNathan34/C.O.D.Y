'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,store,rps})=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),results=[];
  const evaluate=source=>win.webContents.executeJavaScript(source);
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  const voice=store.data.settings.voiceAutoSpeak;
  async function waitForListening(){const end=Date.now()+60000;while(Date.now()<end){if(rps.snapshot().voice.status==='listening')return;if(rps.snapshot().voice.status==='error')throw Error(rps.snapshot().voice.message);await wait(100);}throw Error('Microphone did not become ready');}
  try{
    const deadline=Date.now()+60000;while(Date.now()<deadline&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(250);
    store.data.settings.voiceAutoSpeak=false;island.show();
    await evaluate(`window.CODYIsland.onPrompt("Let's play rock paper scissors")`);await wait(700);
    check('typed request opens Island game',rps.snapshot().active&&rps.snapshot().phase==='ready');
    check('opponent choice hidden before playing',await evaluate(`document.getElementById('rps-cody-hand').textContent==='?' && !document.getElementById('rps-game').hidden`));
    await waitForListening();
    await evaluate(`document.querySelector('[data-rps-move="rock"]').click()`);await wait(300);
    check('button resolves and scores one round',rps.snapshot().phase==='result'&&Object.values(rps.snapshot().score).reduce((a,b)=>a+b)===1,rps.snapshot());
    const bounds=await evaluate(`(()=>{const game=document.getElementById('rps-game').getBoundingClientRect(),panel=document.querySelector('.quick-panel').getBoundingClientRect(),hint=document.querySelector('.rps-hint').getBoundingClientRect();return {game:{top:game.top,bottom:game.bottom},panel:{top:panel.top,bottom:panel.bottom},hintBottom:hint.bottom};})()`);
    check('game controls fit inside Island',bounds.hintBottom<=bounds.panel.bottom,bounds);
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-rps.png'),(await win.webContents.capturePage({x:210,y:0,width:520,height:370})).toPNG());
    await evaluate(`document.getElementById('rps-again').click()`);await wait(200);
    check('next round retains score and hides next move',rps.snapshot().round===2&&rps.snapshot().cody===null&&Object.values(rps.snapshot().score).reduce((a,b)=>a+b)===1);
    await waitForListening();
    await evaluate(`document.querySelector('[data-rps-move="paper"]').click()`);await wait(200);
    check('second round scores once',Object.values(rps.snapshot().score).reduce((a,b)=>a+b)===2);
    await evaluate(`document.getElementById('rps-close').click()`);await wait(200);
    check('back to chat restores composer',await evaluate(`!document.body.classList.contains('game-active') && getComputedStyle(document.querySelector('.composer-area')).display!=='none'`));
    rps.start();await wait(300);
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{store.data.settings.voiceAutoSpeak=voice;fs.writeFileSync(path.resolve(__dirname,'../reports/rps-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));console.log('RPS_VERIFICATION '+JSON.stringify(results));}
};
