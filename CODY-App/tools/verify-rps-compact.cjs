'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine,rps})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),results=[],countdown=[];
  const evaluate=source=>win.webContents.executeJavaScript(source);
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(condition){const end=Date.now()+60000;while(Date.now()<end){if(await condition())return;await wait(100);}throw Error('Game check timed out: '+JSON.stringify(rps.snapshot()));}
  const trace=state=>{if(state.voice.status==='countdown')countdown.push(state.voice.countdown);};rps.on('change',trace);
  async function capture(name){const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/'+name),(await win.webContents.capturePage(bounds)).toPNG());}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.show();
    await evaluate(`window.CODYIsland.onPrompt("Let's play rock the paper scissors.")`);
    await until(()=>rps.active&&!win.isDestroyed());await wait(300);
    check('no game panel exists and chat stays collapsed',await evaluate(`!document.getElementById('rps-game')&&!document.body.classList.contains('panel-open')`));
    await until(()=>rps.snapshot().voice.status==='listening'||rps.snapshot().voice.status==='error');
    check('voice game works in compact Island',rps.snapshot().voice.status==='listening'&&(await engine.refresh()).state==='Listening');
    check('countdown remains three two one',countdown.slice(0,3).join(',')==='3,2,1');
    const point=await evaluate(`(()=>{const r=document.getElementById('island-info').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});await wait(250);
    const layout=await evaluate(`(()=>{const island=document.getElementById('island').getBoundingClientRect(),strip=document.getElementById('island-rps-controls');return {height:island.height,visible:getComputedStyle(strip).display!=='none',moves:[...strip.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return {move:button.dataset.rpsMove,enabled:!button.disabled,fits:r.left>=island.left&&r.right<=island.right&&r.top>=0&&r.bottom<=island.bottom};})};})()`);
    check('Spotify-style hover strip has three usable moves inside compact Island',layout.visible&&layout.height<=36&&layout.moves.length===3&&layout.moves.every(move=>move.fits&&move.enabled),layout);
    await capture('island-rps-compact-controls.png');
    await evaluate(`document.querySelector('[data-rps-move="paper"]').click()`);await until(()=>rps.snapshot().phase==='result');await wait(200);
    check('move button scores one round without expanding',Object.values(rps.snapshot().score).reduce((a,b)=>a+b)===1&&await evaluate(`!document.body.classList.contains('panel-open')`),rps.snapshot());
    win.webContents.sendInputEvent({type:'mouseMove',x:0,y:300});await wait(200);await capture('island-rps-compact-result.png');
    await evaluate(`document.getElementById('island-info').click()`);await until(()=>rps.snapshot().round===2&&rps.snapshot().voice.status==='countdown');
    check('click result begins next voice round in compact Island',await evaluate(`!document.body.classList.contains('panel-open')`));
    win.webContents.send('island:game-command','close');await until(()=>!rps.active);
    check('end game stops microphone and removes game controls',(await engine.refresh()).state==='Idle'&&await evaluate(`document.getElementById('island-rps-controls').hidden&&!document.body.classList.contains('rps-active')`));
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});console.error(error);}
  finally{rps.removeListener('change',trace);await evaluate(`window.assistant.rps.action({action:'close'})`).catch(()=>{});fs.writeFileSync(path.resolve(__dirname,'../reports/rps-compact-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));console.log('RPS_COMPACT_VERIFICATION '+JSON.stringify(results));}
};
