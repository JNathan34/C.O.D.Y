'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({app,win,engine})=>{
 const checks=[],report=process.env.CODY_SMOKE_REPORT||path.join(app.getPath('userData'),'standalone-smoke.json');
 const check=(name,passed,detail)=>{checks.push({name,passed,detail});if(!passed)throw Error(name);};
 try{
  const status=await engine.refresh();
  const end=Date.now()+45000;while(Date.now()<end){if(await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))break;await new Promise(resolve=>setTimeout(resolve,100));}
  check('current Island GUI loads from packaged application',await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'),await win.webContents.executeJavaScript('document.getElementById("integration-note")?.textContent'));
  const expected=path.join(process.resourcesPath,'native-engine');
  check('engine starts from inside the C.O.D.Y. package',path.resolve(status.engineDirectory).toLowerCase()===path.resolve(expected).toLowerCase(),status.engineDirectory);
  check('fresh profile works without an existing HeyClicky login',status.signedIn===false&&path.resolve(status.dataDirectory).toLowerCase()===path.resolve(app.getPath('userData'),'native-account').toLowerCase(),{signedIn:status.signedIn,dataDirectory:status.dataDirectory});
  check('engine state uses a writable user profile',path.resolve(status.stateDirectory).toLowerCase()===path.resolve(app.getPath('userData'),'native-state').toLowerCase(),status.stateDirectory);
  check('automatic app updates remain disabled',status.automaticUpdatesEnabled===false);
  const cursor=await engine.request('cursor-style-status');check('C.O.D.Y. replaces the old cursor overlay',cursor.presentation==='cody'&&cursor.originalOverlayCreated===false,cursor);
  check('history and simplified settings are included',await win.webContents.executeJavaScript(`Boolean(document.getElementById('view-history')&&document.getElementById('history-list')&&document.getElementById('core-history').tagName==='BUTTON'&&!document.getElementById('voice-engine')&&!document.getElementById('core-background'))`));
  check('background task service and task view are available',Array.isArray((await engine.request('tasks-state')).tasks)&&await win.webContents.executeJavaScript('Boolean(window.CODYTasks&&document.getElementById("panel-tasks"))'));
  const modules=await engine.request('deployment-state');
  check('native CLR and WinUI load from the bundled engine',modules.modules.length>=2&&modules.modules.every(module=>path.resolve(module.path).toLowerCase().startsWith(path.resolve(expected).toLowerCase()+path.sep)),modules);
  check('core drawing and 3D assets are included',['Assets/Engine/clicky-three.js','Assets/Engine/clicky-draw-engine.js','HeyClicky.Drawing3D.dll','HeyClicky.Drawing.dll','coreclr.dll'].every(file=>fs.existsSync(path.join(expected,file))));
  check('native Windows scripts are available outside asar',['app-layout.ps1','telemetry-snapshot.ps1','ctrl-alt-listener.ps1','spotify-media.ps1'].every(file=>fs.existsSync(path.join(process.resourcesPath,'app.asar.unpacked/windows',file))));
 }catch(error){checks.push({name:'verification error',passed:false,error:error.message});}
 finally{fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify({passed:checks.every(check=>check.passed),checks},null,2));app.quit();}
};
