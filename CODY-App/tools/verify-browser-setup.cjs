'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),request=engine.request.bind(engine),emit=engine.emit,calls=[];
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const fixture={testFixture:true,connected:false,pending:true,targetId:'CODY-extension-fixture',busy:false,showingHow:false,canInstall:true,fromStore:false};let mock={...fixture};
 try{
  const end=Date.now()+45000;while(Date.now()<end&&!await evaluate('Boolean(window.CODYBrowserSetup&&window.CODYIsland?.integrationReady)'))await wait(100);
  const real=await request('browser-setup-state');check('native browser setup endpoint reports the actual extension state',typeof real.connected==='boolean'&&typeof real.pending==='boolean'&&typeof real.canInstall==='boolean');
  try{await request('browser-setup-choice',{choice:'invalid',targetId:'invalid-stale-target'});throw Error('Stale setup unexpectedly accepted');}catch(error){check('stale native setup decisions are rejected before any installation',/request changed|Invalid browser setup choice/.test(error.message));}
  engine.request=async(command,args)=>{
   if(command==='browser-setup-state')return mock;
   if(command==='browser-setup-choice'){calls.push(args);mock=args.choice==='not_now'?{...mock,pending:false,busy:false}:{...mock,busy:true,showingHow:args.choice==='show_me_how'};return mock;}
   if(command==='browser-setup-folder'){calls.push({folder:true});return {opened:true};}
   return request(command,args);
  };
  engine.emit=function(event,value,...args){if(event==='browser-setup'&&!value.testFixture)return false;return emit.call(this,event,value,...args);};
  const send=async(value=fixture)=>{mock={...value};engine.emit('browser-setup',mock);island.show();await wait(500);};
  await send();check('extension request opens inside Island with all three choices',await evaluate(`!document.getElementById('browser-setup').hidden&&['install','guide','later'].every(id=>!document.getElementById('browser-setup-'+id).disabled)`));
  check('displaying a setup request never installs anything',calls.length===0);
  island.showCompact();await wait(700);
  check('collapsed notch hides the complete setup card',await evaluate(`getComputedStyle(document.getElementById('browser-setup')).display==='none'&&document.getElementById('browser-setup').getBoundingClientRect().height===0`));
  island.show();await wait(600);
  check('reopening restores the setup panel without clipping',await evaluate(`(()=>{const r=document.getElementById('browser-setup').getBoundingClientRect(),i=document.getElementById('island').getBoundingClientRect();return r.height>100&&r.left>=i.left&&r.right<=i.right&&r.bottom<=i.bottom;})()`));
  await evaluate(`window.CODYIsland.setActiveView('settings')`);await wait(500);
  check('setup does not obscure Settings',await evaluate(`getComputedStyle(document.getElementById('browser-setup')).display==='none'&&getComputedStyle(document.querySelector('.view-stack')).visibility==='visible'`));
  await evaluate(`window.CODYIsland.setActiveView('chat')`);await wait(400);

  await evaluate(`document.getElementById('browser-setup-install').click()`);await wait(300);
  check('Install for me forwards the selected request exactly once',calls.length===1&&calls[0].choice==='do_it_for_me'&&calls[0].targetId===fixture.targetId);
  check('duplicate installation is disabled during setup',await evaluate(`document.getElementById('browser-setup-install').disabled`));
  await send({...fixture,targetId:'guide-fixture',canInstall:false});check('unavailable automatic installation retains the manual guide',await evaluate(`document.getElementById('browser-setup-install').hidden&&!document.getElementById('browser-setup-guide').disabled`));
  await evaluate(`document.getElementById('browser-setup-guide').click()`);await wait(300);
  check('manual guide exposes folder and Load unpacked instructions',calls.at(-1).choice==='show_me_how'&&await evaluate(`document.getElementById('browser-setup-steps').textContent.includes('Load unpacked')&&!document.getElementById('browser-setup-folder').hidden`));
  await evaluate(`document.getElementById('browser-setup-folder').click()`);await wait(200);check('extension folder control reaches only the native folder action',calls.at(-1).folder===true);
  const bounds=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);
  fs.writeFileSync(path.resolve(__dirname,'../reports/browser-setup.png'),(await win.webContents.capturePage(bounds)).toPNG());
  await evaluate(`document.getElementById('browser-setup-later').click()`);await wait(300);check('Not now dismisses setup through the native choice',calls.at(-1).choice==='not_now'&&await evaluate(`document.getElementById('browser-setup').hidden`));
  await send({...fixture,pending:false,connected:true,busy:false});await evaluate(`window.CODYBrowserSetup.open()`);await wait(400);check('setup can be reopened from Settings and reports connected state',await evaluate(`!document.getElementById('browser-setup').hidden&&document.getElementById('browser-setup-title').textContent==='CODY’s browser extension'`));
  for(const browser of ['Chrome','Edge']){
   await evaluate(`window.CODYBrowserSetup.open('${browser}')`);await wait(400);
   check(browser+' setup retains its CODY title',await evaluate(`document.getElementById('browser-setup-title').textContent==='CODY’s ${browser} extension'&&!document.getElementById('browser-setup-description').textContent.includes('HeyClicky')`));
  }
  await evaluate(`document.getElementById('browser-setup-close').click()`);
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{engine.request=request;engine.emit=emit;try{engine.emit('browser-setup',await request('browser-setup-state'));}catch{}island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/browser-setup-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
