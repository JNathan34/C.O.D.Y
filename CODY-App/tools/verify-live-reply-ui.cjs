'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:940,height:750,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=()=>new Promise(resolve=>setTimeout(resolve,350));
 try{
  await win.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/index.html'),{query:{demo:'true'}});
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}');
  const source=fs.readFileSync(path.resolve(__dirname,'../frontend/original-cody/src/island/renderer/assistant.js'),'utf8');
  const update=source.slice(source.indexOf('  function updateMessage('),source.indexOf('  function busy('));
  await evaluate(`(()=>{const app={data:{activeChatId:'chat',chats:[{id:'chat',messages:[{id:'reply',role:'assistant',text:'First spoken line.'}]}]}},island=window.CODYIsland,$=id=>document.getElementById(id),displayText=text=>text;${update};window.testReplyUpdate=text=>updateMessage('chat','reply',text);island.togglePanel(true);island.appendMessage('user','Tell me more.');island.appendMessage('assistant','First spoken line.').dataset.messageId='reply';})()`);
  await pause();
  const gap=()=>evaluate(`(()=>{const log=document.getElementById('conversation');return log.scrollHeight-log.clientHeight-log.scrollTop;})()`);
  const full=Array.from({length:30},(_,i)=>'Spoken line '+(i+1)+': This sentence should appear in the chat immediately.').join('\n\n');
  await evaluate(`window.testReplyUpdate(${JSON.stringify(full)})`);assert.ok(await gap()<3,'first large live update stays visible');
  await evaluate(`window.testReplyUpdate(${JSON.stringify(full+'\n\nAnother spoken line.\n\nThe last spoken line.')})`);assert.ok(await gap()<3,'later spoken lines stay visible');
  await evaluate(`document.getElementById('conversation').scrollTop=0;window.testReplyUpdate(${JSON.stringify(full+'\n\nUpdated while reading history.')})`);
  assert.equal(await evaluate(`document.getElementById('conversation').scrollTop`),0);
  await evaluate(`window.CODYIsland.togglePanel(false);window.testReplyUpdate(${JSON.stringify(full+'\n\nSpoken while chat was closed.')});window.CODYIsland.togglePanel(true);`);await pause();assert.ok(await gap()<3,'reopening shows the latest spoken reply');
  await evaluate(`window.CODYIsland.setActiveView('settings');window.testReplyUpdate(${JSON.stringify(full+'\n\nSpoken while in settings.')});window.CODYIsland.setActiveView('chat');`);await pause();assert.ok(await gap()<3,'returning from settings shows the latest reply');
  fs.writeFileSync(path.resolve(__dirname,'../reports/live-reply-chat.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({passed:true,checks:['large live reply visible immediately','subsequent lines follow','reading history stays put','reopen follows latest reply','return from settings follows latest reply']}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{win.destroy();app.exit(app.exitCode||0);}
});
