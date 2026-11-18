'use strict';
const path=require('node:path');
const windows=require('./windows');
const {normalizeApp}=require('../app-commands');
function validateSplitApps(apps){
  if(!Array.isArray(apps)||apps.length!==2||apps.some(app=>typeof app!=='string'||!normalizeApp(app)))throw Error('Choose two supported applications for split screen.');
  const clean=apps.map(normalizeApp);if(clean[0]===clean[1])throw Error('Choose two different applications for split screen.');return clean;
}
async function splitApps(apps,{runner=windows.runPowerShell}={}){
  const clean=validateSplitApps(apps),source=windows.psQuote(path.join(__dirname,'../../windows/app-layout.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
  const raw=await runner(`$ProgressPreference='SilentlyContinue'; try { & ${source} -AppsJson ${windows.psQuote(JSON.stringify(clean))} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,{timeout:35000});
  const result=typeof raw==='string'?JSON.parse(raw):raw;
  if(!result?.arranged||result.windows?.length!==2||!result.windows.every((window,index)=>window.app===clean[index]))throw Error('Windows did not confirm both split-screen windows.');
  return result;
}
async function appPin(app,pinned,{runner=windows.runPowerShell,readOnly=false}={}){
  const clean=normalizeApp(app);if(!clean||typeof pinned!=='boolean')throw Error('Choose a supported app and pin state.');
  const source=windows.psQuote(path.join(__dirname,'../../windows/app-layout.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
  const raw=await runner(`$ProgressPreference='SilentlyContinue'; try { & ${source} -AppsJson ${windows.psQuote(JSON.stringify([clean]))} -Mode ${readOnly?'status':'pin'} -Topmost $${pinned?'true':'false'} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,{timeout:35000});
  const result=typeof raw==='string'?JSON.parse(raw):raw;
  if(result?.app!==clean||typeof result.pinned!=='boolean'||(!readOnly&&result.pinned!==pinned)||(!readOnly&&pinned&&!result.wasOpen))throw Error('Windows did not confirm the requested pin state.');
  return result;
}
async function focusOrLaunchApp(app,{runner=windows.runPowerShell}={}){
  const clean=normalizeApp(app);
  if(!clean)throw Error('Choose a supported application.');
  const source=windows.psQuote(path.join(__dirname,'../../windows/app-layout.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
  const raw=await runner(`$ProgressPreference='SilentlyContinue'; try { & ${source} -AppsJson ${windows.psQuote(JSON.stringify([clean]))} -Mode focus } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,{timeout:30000});
  let result;try{result=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Windows did not report whether the app was opened or reused.');}
  if(result?.app!==clean||result.focused!==true||!Number.isInteger(result.pid)||result.pid<1||typeof result.reused!=='boolean')
    throw Error('Windows could not verify the focused application.');
  return result;
}
module.exports={splitApps,validateSplitApps,appPin,focusOrLaunchApp};
