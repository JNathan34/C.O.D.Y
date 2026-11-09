'use strict';
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {NATIVE_VOICES}=require('./native-ipc');

const FORMAT='cody-settings';
const VERSION=1;
const MAX_BYTES=64*1024;
const filters=[{name:'C.O.D.Y. settings backup',extensions:['json']}];
// Only portable preferences belong in a backup. Device IDs, account state,
// permissions, and the switches for microphone privacy stay on this PC.
const ISLAND_KEYS=[
  'launchAtLogin','visibility','islandSize','revealStyle','animationSpeed',
  'accentColor','mascotLook','cursorColor','cursorSize','controlInputMode',
  'hideFloatingCursor','screenHighlight','shakeToDetach','cursorTracking',
  'idleReactions','blinkEnabled','reactiveExpressions','funReactions',
  'sunglassesEnabled','pretendSleepEnabled','wifiReactions',
  'enableHotkey','startListeningOnHotkey','quickMessageEnabled','quickMessagePhrase',
  'wakeHeyCody','wakeOkayCody','wakeCody','voiceRate','voicePitch','voiceVolume','micSensitivity'
];
const APP_KEYS=['voiceAutoSpeak','runInBackground','startMinimized'];
const VOICE_KEYS=['voice','recognitionLanguage'];
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pick=(source,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(source,key)).map(key=>[key,source[key]]));
const hasSettings=section=>Object.keys(section).length>0;

function parseBackup(text,validateIsland){
  let backup;
  try{backup=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('This file is not valid JSON.');}
  if(!isObject(backup)||backup.format!==FORMAT)throw Error('Choose a C.O.D.Y. settings backup file.');
  if(backup.version!==VERSION)throw Error('This settings backup version is unsupported.');
  const section=(name,keys)=>{
    const value=Object.hasOwn(backup,name)?backup[name]:{};
    if(!isObject(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid '+name+' settings in the backup.');
    return value;
  };
  const island=section('island',ISLAND_KEYS),app=section('app',APP_KEYS),voice=section('voice',VOICE_KEYS);
  const validated=validateIsland(island);
  for(const [key,value] of Object.entries(island)){
    if(value!==validated[key])throw Error('Invalid setting in the backup: '+key+'.');
  }
  for(const [key,value] of Object.entries(app)){
    if(typeof value!=='boolean')throw Error('Invalid setting in the backup: '+key+'.');
  }
  if(Object.hasOwn(voice,'voice')&&!NATIVE_VOICES.includes(voice.voice))throw Error('The backup contains an unsupported voice.');
  if(Object.hasOwn(voice,'recognitionLanguage')&&!['en','multi'].includes(voice.recognitionLanguage))throw Error('The backup contains an unsupported recognition language.');
  if(![island,app,voice].some(hasSettings))throw Error('This backup contains no settings to import.');
  return {island,app,voice};
}

async function writeBackup(file,backup){
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
    await fs.writeFile(temporary,JSON.stringify(backup,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
    await fs.rename(temporary,file);
  }finally{await fs.unlink(temporary).catch(()=>{});}
}

function registerSettingsBackupIpc({ipcMain,dialog,getWindow,island,store,engine,onAppSettingsChanged}){
  let busy=false;
  const handle=(name,action)=>ipcMain.handle(name,async event=>{
    const win=getWindow();
    if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted settings backup request.');
    if(busy)throw Error('A settings backup is already in progress.');
    busy=true;
    try{return await action(win);}finally{busy=false;}
  });

  handle('settings-export',async win=>{
    const {canceled,filePath}=await dialog.showSaveDialog(win,{title:'Export C.O.D.Y. settings',defaultPath:'cody-settings-backup.json',filters});
    if(canceled)return {cancelled:true};
    const voice=pick(await engine.request('status'),VOICE_KEYS);
    if(!NATIVE_VOICES.includes(voice.voice))delete voice.voice;
    const backup={format:FORMAT,version:VERSION,island:pick(island.preferences(),ISLAND_KEYS),app:pick(store.data.settings,APP_KEYS),voice};
    await writeBackup(filePath,backup);
    return {exported:true};
  });

  handle('settings-import',async win=>{
    const {canceled,filePaths}=await dialog.showOpenDialog(win,{title:'Import C.O.D.Y. settings',properties:['openFile'],filters});
    if(canceled)return {cancelled:true};
    const file=await fs.open(filePaths[0],'r');
    let backup;
    try{
      const stat=await file.stat();
      if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('Choose a C.O.D.Y. settings backup under 64 KiB.');
      const chunks=[];
      for await(const chunk of file.createReadStream({end:MAX_BYTES,autoClose:false}))chunks.push(chunk);
      const contents=Buffer.concat(chunks);
      if(contents.length>MAX_BYTES)throw Error('Choose a C.O.D.Y. settings backup under 64 KiB.');
      backup=parseBackup(contents.toString('utf8'),island.validateSettings);
    }finally{await file.close();}

    let previousVoice,previousApp,previousIsland,appSaved=false;
    try{
      if(hasSettings(backup.voice)){
        const current=await engine.request('status');
        if(current.state!=='Idle')throw Error('Finish the current voice session before importing settings.');
        previousVoice=pick(current,Object.keys(backup.voice));
        await engine.request('configure',backup.voice);
      }
      if(hasSettings(backup.app)){
        previousApp={...store.data.settings};
        store.settings(backup.app);
        appSaved=true;
      }
      if(hasSettings(backup.island)){
        previousIsland=pick(island.preferences(),Object.keys(backup.island));
        island.updatePreferences(backup.island);
      }
    }catch(error){
      const currentIsland=island.preferences();
      const islandChanged=previousIsland&&Object.keys(previousIsland).some(key=>previousIsland[key]!==currentIsland[key]);
      const undo=[
        ...(islandChanged?[()=>island.updatePreferences(previousIsland)]:[]),
        ...(previousApp?[()=>{store.data.settings=previousApp;if(appSaved)store.save();}]:[]),
        ...(previousVoice?[()=>engine.request('configure',previousVoice)]:[])
      ];
      let rollbackFailed=false;
      for(const restore of undo){
        try{await restore();}catch(restoreError){rollbackFailed=true;console.warn('[C.O.D.Y.] Settings rollback:',restoreError);}
      }
      if(rollbackFailed)throw Error('Settings import was interrupted and some changes could not be reverted.');
      throw error;
    }
    if(previousApp)onAppSettingsChanged();
    return {imported:true};
  });
}

module.exports={registerSettingsBackupIpc};
