'use strict';
const fs=require('node:fs'),path=require('node:path');
const {BrowserWindow,powerMonitor,screen}=require('electron');
const execFile=require('node:util').promisify(require('node:child_process').execFile);
module.exports=async({win,island})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code);
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const visible=async()=>win.isVisible()&&!win.isMinimized()&&await evaluate(`['visible','entering'].includes(document.body.dataset.reveal)`);
 let focusWindow;
 try{
  const end=Date.now()+30000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
  check('Always visible preference is active',island.preferences().visibility==='always');
  island.show();await wait(600);win.close();await wait(850);
  check('Closing chat leaves the compact Island visible',await visible()&&await evaluate(`!document.body.classList.contains('panel-open')`));
  for(let i=0;i<10;i++){win.webContents.send('island:visibility',false);await wait(20);}
  win.webContents.send('island:visibility',true);
  for(let i=0;i<10;i++){await wait(20);win.webContents.send('island:visibility',true);}
  await wait(600);
  check('Repeated visibility updates finish the reveal',await evaluate(`document.body.dataset.reveal==='visible'`));
  focusWindow=new BrowserWindow({width:240,height:100,show:false,skipTaskbar:true,title:'CODY visibility verification',webPreferences:{sandbox:true}});
  await focusWindow.loadURL('data:text/html,<title>CODY visibility verification</title>Visibility verification');focusWindow.show();focusWindow.focus();await wait(400);
  check('Owned focus fixture is focused',focusWindow.isFocused());
  focusWindow.setAlwaysOnTop(true,'screen-saver');focusWindow.moveTop();await wait(600);
  const handle=window=>{const bytes=window.getNativeWindowHandle();return String(bytes.length>=8?bytes.readBigUInt64LE():BigInt(bytes.readUInt32LE()));};
  const nativeOrder=JSON.parse((await execFile('powershell.exe',['-NoProfile','-File',path.resolve(__dirname,'verify-window-order.ps1'),'-Upper',handle(win),'-Lower',handle(focusWindow)],{windowsHide:true})).stdout);
  check('Island stays above another always-on-top app without taking its focus',nativeOrder.above&&focusWindow.isFocused(),nativeOrder);
  win.hide();await wait(900);
  check('Unexpected Windows hide restores Island without stealing focus',await visible()&&focusWindow.isFocused());
  win.setAlwaysOnTop(false);await wait(2300);
  check('Lost topmost state recovers without stealing focus',win.isAlwaysOnTop()&&focusWindow.isFocused());
  win.minimize();await wait(900);
  check('Minimizing cannot strand the Island',await visible()&&focusWindow.isFocused(),{visible:win.isVisible(),minimized:win.isMinimized(),focusPreserved:focusWindow.isFocused()});
  const original=win.getBounds();win.setBounds({...original,x:original.x+30,y:original.y+30});powerMonitor.emit('resume');await wait(400);
  const bounds=screen.getPrimaryDisplay().bounds,actual=win.getBounds();
  check('Resume reattaches Island to primary display',actual.y===bounds.y&&actual.x===Math.round(bounds.x+(bounds.width-actual.width)/2));
  island.hide();await wait(2500);
  check('An explicit hide is respected by recovery',!win.isVisible());
  island.showCompact();await wait(600);check('Compact Island returns after explicit show',await visible());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{focusWindow?.destroy();island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/island-visibility-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
