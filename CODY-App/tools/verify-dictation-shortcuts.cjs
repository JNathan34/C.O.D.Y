'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),results=[];
 try{
  const end=Date.now()+20000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(80);
  const state=await engine.request('dictation-shortcuts');if(!state.installed)throw Error('Dictation listener is not installed');results.push({name:'dedicated dictation listener is installed',passed:true});
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="shortcuts"]').click()`);await wait(400);
  const rows=await evaluate(`(()=>{const heading=[...document.querySelectorAll('[data-content="shortcuts"] .group-title')].find(e=>e.textContent==='DICTATION');return [...heading.nextElementSibling.children].map(e=>({label:e.querySelector('strong').textContent,keys:[...e.querySelectorAll('kbd')].map(k=>k.textContent),overflow:e.scrollWidth>e.clientWidth}));})()`);
  if(rows.length!==4||rows.some(r=>r.overflow)||rows[0].keys.join('+')!=='Ctrl+Win'||rows[3].keys[0]!=='Esc')throw Error('Dictation shortcut rows are incorrect');results.push({name:'four dictation controls fit in Shortcuts',passed:true,rows});
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 fs.writeFileSync(path.resolve(__dirname,'../reports/dictation-shortcuts-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));
};
