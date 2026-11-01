'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island})=>{
  const evaluate=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),results=[];
  try{
    const end=Date.now()+30000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
    island.show();await wait(700);
    const layout=await evaluate(`(()=>{const button=document.getElementById('new-chat'),settings=document.getElementById('panel-settings'),r=button.getBoundingClientRect(),s=settings.getBoundingClientRect(),panel=document.getElementById('quick-panel').getBoundingClientRect();return {ready:Boolean(window.CODYIsland?.integrationReady),rightOfSettings:r.x>s.x,nearRight:panel.right-r.right<70,arrowRemoved:!document.getElementById('close-panel'),engineButtonRemoved:!document.getElementById('core-mode')};})()`);
    results.push({name:'New Chat replaces arrow at top right; engine pill removed',passed:Object.values(layout).every(Boolean),detail:layout});
    const old=await evaluate('window.assistant.state().then(s=>s.activeChatId)');
    await evaluate(`document.getElementById('new-chat').click()`);await wait(700);
    const current=await evaluate(`window.assistant.state().then(s=>({id:s.activeChatId,empty:document.getElementById('chat-messages').children.length===0,focused:document.activeElement.id==='quick-input'}))`);
    results.push({name:'New Chat opens an empty conversation and focuses input',passed:current.id!==old&&current.empty&&current.focused});
    if(old)await evaluate(`window.assistant.selectChat(${JSON.stringify(old)})`);await wait(250);
    const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return {x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
    fs.writeFileSync(path.resolve(__dirname,'../reports/chat-layout.png'),(await win.webContents.capturePage(bounds)).toPNG());
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
  fs.writeFileSync(path.resolve(__dirname,'../reports/chat-layout-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));
};
