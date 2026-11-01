'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine,rps})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),results=[];
  const evaluate=source=>win.webContents.executeJavaScript(source);
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  const steps=[],visualChecks=[];let duringMove;
  const onCue=data=>{
    const digit=({'Three.':3,'Two.':2,'One.':1})[data.text];
    if(digit){
      steps.push(digit);
      visualChecks.push(evaluate(`({compact:document.getElementById('island-info-text').textContent,large:document.getElementById('rps-you-hand').textContent})`).then(detail=>({digit,detail})));
      if(digit===1)visualChecks.push(win.webContents.capturePage({x:210,y:0,width:520,height:370}).then(png=>fs.writeFileSync(path.resolve(__dirname,'../reports/island-rps-countdown.png'),png.toPNG())));
    }else if(['Rock.','Paper.','Scissors.'].includes(data.text))duringMove=engine.refresh();
  };
  engine.on('game-cue',onCue);
  async function until(condition,timeout=60000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await condition())return;await wait(100);}throw Error('Timed out waiting for game state: '+JSON.stringify(rps.snapshot()));}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.show();
    await evaluate(`window.CODYIsland.onPrompt("Let's play rock paper scissors")`);
    await until(()=>rps.snapshot().voice.status==='countdown');check('game starts spoken countdown',true);
    await until(()=>['listening','error'].includes(rps.snapshot().voice.status));
    check('real HeyClicky microphone is open during announced move',(await duringMove)?.state==='Listening',rps.snapshot());
    check('spoken countdown contains exactly three two one',steps.slice(0,3).join(',')==='3,2,1',steps);
    const visual=await Promise.all(visualChecks);check('compact and expanded Island show each audible countdown number',visual.filter(Boolean).every(item=>item.detail.compact===String(item.digit)&&item.detail.large===String(item.digit)),visual.filter(Boolean));
    win.blur();await wait(500);
    check('game stays expanded after losing keyboard focus',win.isVisible()&&await evaluate(`document.body.classList.contains('panel-open')`));
    win.hide();await wait(800);
    check('temporary native hide restores expanded game',win.isVisible()&&await evaluate(`document.body.classList.contains('panel-open') && document.body.dataset.reveal==='visible'`));
    await wait(1600);check('no answer leaves microphone open',rps.snapshot().voice.status==='listening');
    check('Island displays announced move and hands-free listening state',await evaluate(`document.getElementById('rps-message').textContent.includes('Listening') && document.getElementById('rps-cody-hand').textContent!=='?'`));
    fs.writeFileSync(path.resolve(__dirname,'../reports/island-rps-voice.png'),(await win.webContents.capturePage({x:210,y:0,width:520,height:370})).toPNG());
    await evaluate(`document.getElementById('rps-close').click()`);await until(()=>!rps.active);
    check('closing game stops real microphone',(await engine.refresh()).state==='Idle');
    await evaluate(`window.assistant.rps.action({action:'start'})`);await until(()=>rps.snapshot().voice.status==='countdown');
    await evaluate(`window.assistant.rps.action({action:'close'})`);await wait(1000);
    check('cancelling countdown cannot reopen microphone',!rps.active&&(await engine.refresh()).state==='Idle');
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{
    engine.removeListener('game-cue',onCue);
    await evaluate(`window.assistant.rps.action({action:'close'})`).catch(()=>{});
    fs.writeFileSync(path.resolve(__dirname,'../reports/rps-voice-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));console.log('RPS_VOICE_VERIFICATION '+JSON.stringify(results));
  }
};
