'use strict';
const fs=require('node:fs'),path=require('node:path'),{BrowserWindow}=require('electron');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);let other;
 const check=(name,passed)=>{results.push({name,passed});if(!passed)throw Error(name);};
 try{
  const end=Date.now()+30000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="agents"]').click()`);await wait(350);
  const before=win.getBounds();engine.emit('screen-capture-ui',{active:true});
  other=new BrowserWindow({show:false,width:200,height:100,skipTaskbar:true,webPreferences:{sandbox:true}});await other.loadURL('data:text/html,Snip focus fixture');other.show();other.focus();await wait(450);
  check('snipping focus change preserves the expanded settings menu',await evaluate(`document.body.classList.contains('panel-open')&&document.body.classList.contains('settings-open')&&!document.querySelector('[data-content="agents"]').hidden`));
  island.handleHotkey({type:'pointer',x:before.x+before.width+50,y:before.y+400});await wait(100);
  check('screenshot selection outside the menu does not close it',await evaluate(`document.body.classList.contains('panel-open')`));
  win.hide();await wait(500);check('visibility recovery waits instead of fighting the snipping overlay',!win.isVisible());
  engine.emit('screen-capture-ui',{active:false});await wait(1000);
  check('menu returns at its original size without stealing focus',win.isVisible()&&win.getBounds().width===before.width&&win.getBounds().height===before.height&&other.isFocused()&&await evaluate(`document.body.classList.contains('panel-open')&&!document.querySelector('[data-content="agents"]').hidden`));
  island.handleHotkey({type:'pointer',x:before.x+before.width+50,y:before.y+400});await wait(250);check('normal outside-click dismissal still works after the snip',await evaluate(`!document.body.classList.contains('panel-open')`));
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{engine.emit('screen-capture-ui',{active:false});other?.destroy();island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/screenshot-menu-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
