'use strict';
const fs=require('node:fs'),path=require('node:path'),looks=require('../frontend/original-cody/src/island/renderer/mascot-looks');
module.exports=async({win,island,engine})=>{
 const results=[],original=island.preferences(),wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async test=>{const end=Date.now()+20000;while(Date.now()<end){if(await test())return;await wait(80);}throw Error('Palette verification timed out');};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="appearance"]').click()`);await wait(400);
  const palette=await evaluate(`({theme:[...document.querySelectorAll('[data-accent]')].map(b=>b.dataset.accent),cursor:[...document.querySelectorAll('[data-cursor-color]')].filter(b=>b.dataset.cursorColor!=='accent').map(b=>b.dataset.cursorColor)})`),colors=Object.values(looks).map(l=>l.color);
  check('theme and cursor both offer all ten matching CODY colours',JSON.stringify(palette.theme)===JSON.stringify(colors)&&JSON.stringify(palette.cursor)===JSON.stringify(colors),palette);
  await evaluate(`document.querySelector('[data-accent="#F4D35E"]').click()`);await until(()=>island.preferences().accentColor==='#F4D35E');
  check('Gold theme selection is applied and saved',await evaluate(`document.body.style.getPropertyValue('--ui-accent')==='#F4D35E'&&document.querySelector('[data-accent="#F4D35E"]').getAttribute('aria-pressed')==='true'`));
  const capture=async name=>{const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/'+name+'.png'),(await win.webContents.capturePage(clip)).toPNG());};await capture('full-theme-palette');
  await evaluate(`document.querySelector('[data-tab="cursor"]').click();document.querySelector('[data-cursor-color="#C084FC"]').click()`);await until(async()=>island.preferences().cursorColor==='#C084FC'&&(await engine.request('cursor-preferences')).cursorColor==='#C084FC');
  const layout=await evaluate(`(()=>{const g=document.querySelector('.cursor-options'),r=g.getBoundingClientRect();return{height:r.height,overflow:g.scrollWidth>g.clientWidth,preview:getComputedStyle(document.querySelector('[data-cursor-color="#C084FC"] .cursor-option-preview')).backgroundColor};})()`);
  check('Violet cursor reaches the native engine and has the correct preview',layout.preview==='rgb(192, 132, 252)'&&!layout.overflow,layout);
  check('native computer-control cursor files exist for the full palette',colors.every(color=>fs.existsSync(path.resolve(__dirname,'../run/current/Assets/Cody/Cursors/cody-'+color.slice(1).toLowerCase()+'.cur'))));await wait(200);await capture('full-cursor-palette');
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{await evaluate(`window.cody.updateSettings(${JSON.stringify({accentColor:original.accentColor,cursorColor:original.cursorColor})})`).catch(()=>{});fs.writeFileSync(path.resolve(__dirname,'../reports/full-palette-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
