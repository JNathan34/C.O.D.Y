'use strict';
const path=require('node:path');
const windows=require('./windows');
const {normalizeApp}=require('../app-commands');
function validateSplitApps(apps){
  if(!Array.isArray(apps)||apps.length<2||apps.length>4||apps.some(app=>typeof app!=='string'||!normalizeApp(app)))throw Error('Choose two to four supported applications for split screen.');
  const clean=apps.map(normalizeApp);
  if(new Set(clean).size!==clean.length)throw Error('Choose different applications for split screen.');
  return clean;
}
function validateTitle(title){
  if(typeof title!=='string'||!title.trim()||title.length>256)throw Error('Choose a valid window title.');
  return title.trim();
}
const optionsArg=options=>' -OptionsJson '+windows.psQuote(JSON.stringify(options));
async function splitApps(apps,{runner=windows.runPowerShell,ratio,titles}={}){
  const clean=validateSplitApps(apps),source=windows.psQuote(path.join(__dirname,'../../windows/app-layout.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
  if(ratio!==undefined&&(!Number.isFinite(ratio)||ratio<0.2||ratio>0.8||clean.length!==2))throw Error('Choose a split ratio between 20/80 and 80/20 for two apps.');
  if(titles!==undefined&&(!Array.isArray(titles)||titles.length!==clean.length))throw Error('Choose one title or no title for each window.');
  const options={ratio,titles:titles?.map(title=>title===null?null:validateTitle(title))};
  const raw=await runner(`$ProgressPreference='SilentlyContinue'; try { & ${source} -AppsJson ${windows.psQuote(JSON.stringify(clean))}${optionsArg(options)} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,{timeout:35000});
  let result;
  try{result=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Windows did not return a readable split-screen result.');}
  if(result?.arranged!==true||!Array.isArray(result.windows)||result.windows.length!==clean.length||!result.windows.every((window,index)=>window?.app===clean[index]))throw Error('Windows did not confirm all split-screen windows.');
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
async function focusOrLaunchApp(app,{runner=windows.runPowerShell,title,newWindow=false}={}){
  const clean=normalizeApp(app);
  if(!clean)throw Error('Choose a supported application.');
  if(title!==undefined)title=validateTitle(title);
  if(newWindow&&title)throw Error('Choose a new window or an existing window title.');
  const source=windows.psQuote(path.join(__dirname,'../../windows/app-layout.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
  const raw=await runner(`$ProgressPreference='SilentlyContinue'; try { & ${source} -AppsJson ${windows.psQuote(JSON.stringify([clean]))} -Mode focus${optionsArg({title,newWindow})} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,{timeout:30000});
  let result;try{result=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Windows did not report whether the app was opened or reused.');}
  if(result?.app!==clean||result.focused!==true||!Number.isInteger(result.pid)||result.pid<1||typeof result.reused!=='boolean')
    throw Error('Windows could not verify the focused application.');
  return result;
}
async function manageWindow({app,title,windowName,operation,display,width,height},{runner=windows.runPowerShell}={}){
  const clean=windowName===undefined?normalizeApp(app):validateTitle(windowName);
  const supported=windowName===undefined?['inspect','focus','restore','minimize','maximize','move','resize']:['inspect','focus','restore','minimize','maximize'];
  if(!clean||!supported.includes(operation))throw Error('Choose a supported window operation.');
  if(title!==undefined)title=validateTitle(title);
  if(operation==='move'&&(!Number.isInteger(display)||display<1||display>64))throw Error('Choose a valid monitor number.');
  if(operation==='resize'&&[width,height].some(size=>!Number.isInteger(size)||size<1||size>16384))throw Error('Choose a valid window width and height.');
  const source=windows.psQuote(path.join(__dirname,'../../windows/app-layout.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
  const apps=windowName===undefined?[clean]:[];
  const raw=await runner(`try { & ${source} -AppsJson ${windows.psQuote(JSON.stringify(apps))} -Mode manage${optionsArg({title,windowName:windowName===undefined?undefined:clean,operation,display,width,height})} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,{timeout:12000});
  const result=typeof raw==='string'?JSON.parse(raw):raw;
  if(result?.app!==clean||result.operation!==operation||(operation==='inspect'?!Array.isArray(result.windows):result.verified!==true))throw Error('Windows did not verify the requested window operation.');
  return result;
}
module.exports={splitApps,validateSplitApps,appPin,focusOrLaunchApp,manageWindow};
