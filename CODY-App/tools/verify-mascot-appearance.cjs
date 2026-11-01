'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),original=island.preferences().mascotLook||'blue';
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async test=>{const end=Date.now()+20000;while(Date.now()<end){if(await test())return;await wait(80);}throw Error('Appearance verification timed out');};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));const voice=(await engine.request('status')).voice;
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="appearance"]').click()`);await wait(450);
  const layout=await evaluate(`(()=>{const grid=document.getElementById('mascot-options'),cards=[...grid.children],r=grid.getBoundingClientRect();return{count:cards.length,columns:getComputedStyle(grid).gridTemplateColumns,overflow:cards.some(c=>c.scrollWidth>c.clientWidth),images:cards.every(c=>c.querySelector('img').naturalWidth>0),width:r.width,rows:new Set(cards.map(c=>c.getBoundingClientRect().top)).size};})()`);
  check('ten mascot looks fit in two rows with loaded previews',layout.count===10&&layout.rows===2&&!layout.overflow&&layout.images,layout);
  await evaluate(`document.querySelector('[data-mascot-look="green"]').click()`);await until(()=>island.preferences().mascotLook==='green');
  check('selection immediately changes the live mascot',await evaluate(`getComputedStyle(document.querySelector('.mascot')).filter==='hue-rotate(-70deg)'&&document.querySelectorAll('#mascot-options [aria-pressed="true"]').length===1&&document.querySelector('[data-mascot-look="green"]').getAttribute('aria-pressed')==='true'`));
  const saved=JSON.parse(fs.readFileSync(path.join(require('electron').app.getPath('userData'),'island-settings.json'),'utf8'));check('look is saved independently of voice',saved.mascotLook==='green'&&(await engine.request('status')).voice===voice);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));await until(()=>evaluate(`document.body.dataset.mascotLook==='green'`));
  check('saved appearance survives renderer reload',await evaluate(`getComputedStyle(document.querySelector('.mascot')).filter==='hue-rotate(-70deg)'`));
  await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="appearance"]').click()`);await wait(450);
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/mascot-appearance.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{await evaluate(`window.cody.updateSettings({mascotLook:${JSON.stringify(original)}})`);fs.writeFileSync(path.resolve(__dirname,'../reports/mascot-appearance-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
