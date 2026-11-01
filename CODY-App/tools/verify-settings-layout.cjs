'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island})=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);const results=[];
 try{
  for(let i=0;i<300&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)');i++)await wait(100);
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="general"]').click()`);await wait(500);
  const state=await evaluate(`(()=>{const nav=document.querySelector('.settings-nav'),caption=nav.querySelector('.nav-group-caption'),content=document.querySelector('.settings-content');const original=nav.scrollTop;nav.scrollTop=9999;const scrolled=nav.scrollTop;nav.scrollTop=original;return{brandRemoved:!nav.querySelector('.nav-brand'),topGap:caption.getBoundingClientRect().top-nav.getBoundingClientRect().top,thumb:getComputedStyle(nav,'::-webkit-scrollbar-thumb').borderRadius,scrollbar:getComputedStyle(nav,'::-webkit-scrollbar').width,buttons:getComputedStyle(nav,'::-webkit-scrollbar-button').display,scrolled,scrollHeight:nav.scrollHeight,height:nav.clientHeight,contentScrollbar:getComputedStyle(content,'::-webkit-scrollbar').width};})()`);
  results.push({passed:state.brandRemoved&&state.topGap<12&&state.scrollbar==='5px'&&state.contentScrollbar==='5px'&&state.buttons==='none'&&(state.scrollHeight<=state.height||state.scrolled>0),...state});
  const microphone=await evaluate(`(()=>{const page=document.querySelector('[data-content="microphone"]'),sliders=document.querySelectorAll('[data-pref="micSensitivity"]');return{removed:!page.querySelector('#voice-recognition,#recognition-install,#mic-record-check,#mic-check-result')&&!page.textContent.includes('Record and transcribe'),moved:sliders.length===1&&sliders[0].closest('[data-content]').dataset.content==='behaviour',value:sliders[0]?.value};})()`);results.push({passed:microphone.removed&&microphone.moved,...microphone});
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/settings-clean-layout.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({passed:false,error:error.stack});}
 fs.writeFileSync(path.resolve(__dirname,'../reports/settings-clean-layout.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
};
