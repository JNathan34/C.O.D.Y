'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,session,nativeTheme,Tray,nativeImage,clipboard,desktopCapturer,Notification} = require('electron');
const path = require('node:path');
const branding=require('./branding');
const {UpdateService,registerUpdateIpc}=require('./updates');
let updates;
const {TrayMenu}=require('./tray/menu');
let trayMenu;
const {AnnotationManager}=require('./annotations/manager');
const {AnnotationOverlay}=require('./annotations/overlay');
const {demoCommands}=require('./annotations/demo');
const {SceneManager}=require('./visuals/manager');
const {SceneWindow}=require('./visuals/window');
const {AssetRegistry}=require('./visuals/assets');
const {CaptureRegistry}=require('./visuals/captures');
const {VisualLedger}=require('./visuals/ledger');
const {screen,powerMonitor}=require('electron');
const {createHash,randomUUID}=require('node:crypto');
const {MemoryService}=require('./memory/service');
const {registerMemoryIpc}=require('./memory/ipc');
const {CapabilityRegistry}=require('./providers/capabilities');
const backendCapabilities=new CapabilityRegistry();
let memory,memoryError='',nativeBindings;
const {StateStore}=require('./store');
const {registerSettingsBackupIpc}=require('./settings-backup');
const {SubtitleOverlay}=require('./subtitles/overlay');
const {IslandTaskUpdates}=require('./island-task-updates');
const {validateFolder}=require('./router');
const {ComputerController}=require('./control/controller');
const {ActionAudit}=require('./control/action-audit');
const {AssistantModes}=require('./assistant-modes');
const {SelfHosted}=require('./integrations/self-hosted');
const {RgbLighting}=require('./integrations/rgb-lighting');
const {OpenRgbRuntime}=require('./integrations/openrgb-runtime');
const {IcueLightingClient}=require('./integrations/icue-lighting');
const {WhatsAppDrafts}=require('./integrations/whatsapp-drafts');
const {WhatsAppWeb}=require('./integrations/whatsapp-web');
const {OverseerrRequests,registerOverseerrRequestIpc}=require('./integrations/overseerr-requests');
const {PlexSignIn}=require('./integrations/plex-sign-in');
const {parseDirectAction}=require('./control/parser');
const {FirefoxBridge}=require('./control/firefox-bridge');
const {testFirefoxTools}=require('./control/firefox-smoke');
const {safeStorage}=require('electron');
const {LocalSpeech}=require('./voice/local-speech');
const island=require('./island/main');
const {NativeEngine}=require('./native-engine');
const {nativeLink,linksFromArgs}=require('./native-links');
const {installNativeIpc}=require('./native-ipc');
const {IslandUtilities}=require('./island-utilities');
const {StickyNotes}=require('./sticky-notes/manager');
let stickyNotes;
const {RockPaperScissors}=require('./rock-paper-scissors');
const {ScreenCapture}=require('./screen-capture');
const {MonitorAccess}=require('./monitor-access');
const {IslandMonitors}=require('./island-monitors');
const {BrightnessMonitor}=require('./brightness-monitor');
const {Attachments}=require('./attachments');
let attachments;
const {ControlOverlay}=require('./control-overlay');
const {KeywordWakeListener}=require('./voice/keyword-wake-listener');
let controlOverlay,wakeListener;
const nativeEngine=new NativeEngine();
const monitorAccess=new MonitorAccess({screen,engine:nativeEngine});
let actionAudit,assistantModes,selfHosted,plexSignIn,overseerrRequestFlow;
let rgbLighting,whatsappDrafts,whatsappWeb,rgbQuitPending=false,rgbQuitReady=false;
async function openPreferredWebLink(rawUrl){
  const url=new URL(rawUrl);
  if(!['http:','https:'].includes(url.protocol))throw Error('Expected an HTTP or HTTPS link.');
  await nativeEngine.request('browser-preference-open',{url:url.href});
}
nativeEngine.on('screen-capture-ui',value=>island.setCaptureUIActive(value?.active===true));
nativeEngine.on('offline',()=>island.setCaptureUIActive(false));
const {startPushToTalk}=require('./voice/hotkey');
const {DesktopTimer}=require('./timer');
const {TimerAlarm}=require('./alarm');
const {SpotifyMedia}=require('./spotify');
const {Weather}=require('./weather');
const weather=new Weather({fetcher:(url,options)=>require('electron').net.fetch(url,options)});
const timerAlarm=new TimerAlarm();let spotify,quickCard=null,quickCardExpiry=null;
function refreshIslandCards(reveal=false){const media=spotify?.snapshot();island.setGameActive(Boolean(rps?.snapshot().active));island.setRecordingActive(Boolean(screenCapture?.active));island.setTimerVisible(Boolean(taskUpdates.current)||Boolean(monitors?.snapshot().active)||Boolean(desktopTimer?.snapshot())||Boolean(media?.available&&media.title)||Boolean(quickCard&&quickCard.expiresAt>Date.now()),reveal);}
function clearQuickCard(){clearTimeout(quickCardExpiry);quickCard=null;sendUI("island-card",null);refreshIslandCards();}
function expireQuickCard(){
  if(['media-result','rgb-controls'].includes(quickCard?.kind)&&island.isMediaPreviewHovered()){
    showQuickCard(quickCard,10000);
    return;
  }
  clearQuickCard();
}
function showQuickCard(card,duration=10000){quickCard={...card,expiresAt:Date.now()+duration};sendUI('island-card',quickCard);refreshIslandCards(['discord','plex','overseerr','rgb'].includes(card.source));clearTimeout(quickCardExpiry);quickCardExpiry=setTimeout(expireQuickCard,duration);quickCardExpiry.unref();}
function openRgbPanel({scan=true}={}){
  rgbLighting.requirePlugin();
  island.showCompact();
  showQuickCard({kind:'rgb-controls',source:'rgb',messageId:randomUUID()},120000);
  if(scan&&!rgbLighting.client&&!rgbLighting.busy)void rgbLighting.discover().catch(error=>sendUI('diagnostic',error.message));
  return rgbLighting.status();
}
let nativeTasks={connected:false,tasks:[],activeCount:0};
let desktopTimer,rps,screenCapture,monitors,captureQuitPending=false,captureQuitReady=false;
let annotations,scene,captures,visualLedger;
const integrationProfile=process.env.CODY_PROFILE_DIR?path.resolve(process.env.CODY_PROFILE_DIR):path.join(app.getPath('appData'),'CODY-Integrated');
const localMemoryOnly=()=>require('node:fs').existsSync(path.join(integrationProfile,'native-state','local-memory-only'));
require('node:fs').mkdirSync(integrationProfile,{recursive:true});
app.setPath('userData',integrationProfile);
app.setName(branding.name);
let stopPushToTalk=()=>{};
// Let Chromium synchronize accelerated rendering with the display.
// Windows ARM64 GPU drivers can stall or crash on transparent window expansion.
// Keep the software fallback there, with an explicit opt-in for compatible drivers.
if(process.env.CODY_DISABLE_GPU==='1'||process.platform==='win32'&&process.arch==='arm64'&&process.env.CODY_ENABLE_GPU!=='1'){
  app.disableHardwareAcceleration();
  // Software WebGL remains limited to audited local Three.js content.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
// The Island must remain responsive while a fullscreen application has focus.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let speech,firefoxBridge,win,store,tray,controller,quitting=false;
const pendingApprovals=new Map();
const sendUI=(event,payload)=>{
  if(event==='native-turn-status'){
    if(payload.finished)taskUpdates.finish(payload.id,payload);
    else taskUpdates.progress(payload.id,payload.text,payload.detail||'Open chat',payload.phase);
    return;
  }
  if(event==='tasks-changed')taskUpdates.updateTasks(payload);
  if(event==='computer-approvals')taskUpdates.approval('native',payload||[]);
  if(event==='approval')taskUpdates.approval('local:'+payload.id,[payload]);
  if(event==='approval-resolved')taskUpdates.approval('local:'+payload,[]);
  if(win&&!win.isDestroyed())win.webContents.send(event,payload);
  if(event==='message-added'&&payload.message?.role==='assistant'){
    const {id,mediaLookup}=payload.message;
    const source=mediaLookup?.sessions?.length?'plex':mediaLookup?.result||mediaLookup?.choices?.length?'overseerr':null;
    if(source)showQuickCard({kind:'media-result',source,chatId:payload.chatId,messageId:id,mediaLookup},30000);
  }
};
const taskUpdates=new IslandTaskUpdates(card=>{sendUI('island-task-status',card);refreshIslandCards(Boolean(card));});
function createWindow(){
  win=island.mount();
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback,details)=>{
    callback(wc===win?.webContents&&permission==='media'&&wc.getURL().startsWith('file://')&&(details.mediaTypes||[]).includes('audio')&&!(details.mediaTypes||[]).includes('video'));
  });
  win.on('closed',()=>{win=null;speech?.cancel();annotations?.clearImmediate('assistant window closed');scene?.clearImmediate('assistant window closed');});
  win.on('close',event=>{
    if(!quitting&&store.data.settings.runInBackground){event.preventDefault();sendUI('voice-hotkey','cancel');island.showCompact();}
    else if(!quitting){quitting=true;app.quit();}
  });
  if(app.isPackaged&&process.argv.includes('--updated'))island.show();
  else if(store.data.settings.startMinimized||process.argv.includes('--background'))island.showCompact();
  win.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:\/\//i.test(url))void openPreferredWebLink(url).catch(error=>{
      if(win&&!win.isDestroyed())void dialog.showMessageBox(win,{type:'warning',message:'Could not open the link',detail:error.message});
    });
    return {action:'deny'};
  });
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://'))event.preventDefault();});
}
function getState(){return {...store.publicState(),tasks:nativeTasks,rps:rps?.snapshot(),monitors:monitors?.snapshot(),capture:screenCapture?.snapshot(),timer:desktopTimer?.snapshot(),quickCard,taskStatus:taskUpdates.current,spotify:spotify?.snapshot(),controlCapabilities:controller?.catalog(),firefoxConnection:firefoxBridge?.status(),connected:nativeEngine.connected,busy:Boolean(nativeBindings?.isBusy())};}
function registerIpc(){
  registerSettingsBackupIpc({ipcMain,dialog,getWindow:()=>win,island,store,engine:nativeEngine,onAppSettingsChanged:()=>{
    updateTrayMenu();
    sendUI('settings-changed',store.data.settings);
  }});
  const fromCody=e=>{if(!win||e.sender!==win.webContents)throw Error('Computer controls are only accessible from the C.O.D.Y interface')};
  const fromAnnotationUI=e=>{fromCody(e);if(e.senderFrame!==win.webContents.mainFrame)throw Error('Annotations require the trusted main C.O.D.Y frame');};
  ipcMain.handle('rgb-lighting-state',e=>{fromAnnotationUI(e);return rgbLighting.status();});
  ipcMain.handle('rgb-lighting-configure',async(e,enabled)=>{
    fromAnnotationUI(e);
    if(rgbLighting.releasing||rgbLighting.closed)throw Error('Wait for RGB Lighting to finish turning off.');
    store.setRgbLightingEnabled(enabled);
    if(!enabled&&quickCard?.kind==='rgb-controls')clearQuickCard();
    return rgbLighting.setPluginEnabled(enabled);
  });
  ipcMain.handle('rgb-lighting-discover',e=>{fromAnnotationUI(e);return rgbLighting.discover();});
  ipcMain.handle('rgb-lighting-enable',(e,value)=>{fromAnnotationUI(e);return rgbLighting.enable(value===true);});
  ipcMain.handle('rgb-lighting-color',(e,color,brightness)=>{fromAnnotationUI(e);return rgbLighting.setColor(color,brightness);});
  ipcMain.handle('rgb-lighting-open',e=>{fromAnnotationUI(e);return openRgbPanel();});
  ipcMain.handle('rgb-lighting-dismiss',(e,id)=>{fromAnnotationUI(e);if(quickCard?.kind==='rgb-controls'&&quickCard.messageId===id)clearQuickCard();});
  ipcMain.handle('whatsapp-open-app',e=>{fromAnnotationUI(e);return whatsappDrafts.openApp();});
  ipcMain.handle('whatsapp-web-state',(e,check)=>{fromAnnotationUI(e);return whatsappWeb.status({check:check===true});});
  ipcMain.handle('whatsapp-web-link',e=>{fromAnnotationUI(e);return whatsappWeb.link();});
  ipcMain.handle('whatsapp-web-enable',async(e,enabled)=>{
    fromAnnotationUI(e);
    if(enabled===true&&!(await whatsappWeb.status()).ready)throw Error('Link WhatsApp Web first.');
    store.setWhatsAppHandsFree(enabled);
    if(!enabled)whatsappWeb.cancel();
    return whatsappWeb.status();
  });
  ipcMain.handle('whatsapp-draft-preview',(e,id)=>{fromAnnotationUI(e);return whatsappDrafts.preview(id);});
  ipcMain.handle('whatsapp-draft-open',(e,id)=>{fromAnnotationUI(e);return whatsappDrafts.openDraft(id);});
  ipcMain.handle('monitor-access-state',e=>{fromAnnotationUI(e);return monitorAccess.refresh();});
  ipcMain.handle('monitor-access-configure',async(e,settings)=>{
    fromAnnotationUI(e);
    if(screenCapture?.active||nativeBindings?.isBusy())throw Error('Finish or stop the current request or screen recording before changing monitor access.');
    const result=await monitorAccess.configure(settings);
    captures.clear();annotations.clearImmediate('monitor access changed');scene.clearImmediate('monitor access changed');
    island.positionDisplay();
    await stickyNotes?.reconcile();
    sendUI('monitor-access-changed',result);
    return result;
  });
  registerMemoryIpc({ipcMain,dialog,window:()=>win,authorise:fromAnnotationUI,memory,error:memoryError,withFileDialog:island.withFileDialog});
  ipcMain.handle('annotations-settings',e=>{fromAnnotationUI(e);return annotations.status();});
  ipcMain.handle('annotations-configure',(e,patch)=>{fromAnnotationUI(e);const result=annotations.configure(patch);store.settings({annotations:result.settings});sendUI('settings-changed',store.data.settings);return result;});
  ipcMain.handle('annotations-clear',e=>{fromAnnotationUI(e);annotations.clearImmediate('cleared by user');return {cleared:true};});
  // Explicit trusted demo buttons render fixed local visuals, without AI or computer automation.
  ipcMain.handle('annotations-demo',async e=>{fromAnnotationUI(e);const display=monitorAccess.requireDisplay(undefined,await monitorAccess.refresh());return annotations.execute('draw.batch',{commands:demoCommands(display.bounds).filter(command=>annotations.settings.spotlight||command.action!=='draw.spotlight')},{origin:'gui'});});
  ipcMain.handle('annotations-speech',(e,event)=>{
    fromAnnotationUI(e);const data=typeof event==='string'?{phase:event}:event;
    if(!data||Object.keys(data).some(key=>!['phase','scopeId','segmentId','currentTime'].includes(key))||!['playing','paused','resumed','progress','finished','cancelled'].includes(data.phase)||data.scopeId!==undefined&&(typeof data.scopeId!=='string'||data.scopeId.length>100)||data.currentTime!==undefined&&(!Number.isFinite(data.currentTime)||data.currentTime<0))throw Error('Invalid speech playback event');
    if(data.phase!=='progress'){annotations.speech(data.phase,data.scopeId);scene.speech(data.phase,data.scopeId);}return {accepted:true};
  });
  ipcMain.handle('visuals-state',e=>{fromAnnotationUI(e);return {settings:scene.settings,...scene.status()};});
  ipcMain.handle('visuals-configure',(e,patch)=>{fromAnnotationUI(e);const result=scene.configure(patch);store.settings({visuals:scene.settings});sendUI('settings-changed',store.data.settings);return {settings:scene.settings,...result};});
  ipcMain.handle('visuals-demo',async e=>{fromAnnotationUI(e);const id='computer-'+Date.now();return scene.execute('model.generate',{id,preset:'computer'},{origin:'gui'});});
  ipcMain.handle('visuals-clear',e=>{fromAnnotationUI(e);scene.clearImmediate('cleared by user');return {cleared:true};});
  ipcMain.handle('visuals-clear-all',async e=>{fromAnnotationUI(e);visualLedger.begin('gui');annotations.clearImmediate('emergency visual clear');scene.clearImmediate('emergency visual clear');captures.clear();return {cleared:true};});
  ipcMain.handle('firefox-status',e=>{fromCody(e);return firefoxBridge?.status()||{connected:false,error:'Bridge not initialized'};});
  ipcMain.handle('firefox-smoke-test',async e=>{fromCody(e);if(!firefoxBridge?.status().connected)throw Error('Firefox is not ready; check the add-on connection first.');return testFirefoxTools(controller);});
  ipcMain.handle('computer-catalog',e=>{fromCody(e);return controller.catalog()});
  ipcMain.handle('computer-audit',e=>{fromCody(e);return actionAudit?.recent()||[];});
  ipcMain.handle('self-hosted-status',e=>{fromAnnotationUI(e);return selfHosted.status();});
  registerOverseerrRequestIpc({ipcMain,authorise:fromAnnotationUI,requests:overseerrRequestFlow,openPage:openPreferredWebLink});
  ipcMain.handle('self-hosted-connect',(e,id,credentials)=>{fromAnnotationUI(e);if(id==='plex')throw Error('Use Sign in with Plex to connect your account.');return selfHosted.connect(id,credentials);});
  ipcMain.handle('self-hosted-disconnect',(e,id)=>{fromAnnotationUI(e);if(id==='plex')plexSignIn.cancel();return selfHosted.disconnect(id);});
  ipcMain.handle('plex-sign-in-start',e=>{fromAnnotationUI(e);return plexSignIn.start();});
  ipcMain.handle('plex-sign-in-state',e=>{fromAnnotationUI(e);return plexSignIn.snapshot();});
  ipcMain.handle('plex-sign-in-cancel',e=>{fromAnnotationUI(e);return plexSignIn.cancel();});
  ipcMain.handle('plex-sign-in-select',(e,id,address)=>{fromAnnotationUI(e);if(typeof id!=='string'||!id||id.length>300)throw Error('Choose a Plex server.');return plexSignIn.select(id,address);});
  ipcMain.handle('self-hosted-read',(e,id,method,query)=>{
    fromAnnotationUI(e);
    if(id==='plex'&&method==='sessions')return selfHosted.plexSessions();
    if(id==='plex'&&method==='recent')return selfHosted.plexRecent();
    if(id==='plex'&&method==='test')return selfHosted.plexTest();
    if(id==='overseerr'&&method==='test')return selfHosted.overseerrTest();
    if(id==='overseerr'&&method==='requests')return selfHosted.overseerrRequests();
    if(id==='overseerr'&&method==='search')return selfHosted.overseerrSearch(query);
    throw Error('Unknown self-hosted read request.');
  });
  ipcMain.handle('assistant-modes-list',e=>{fromAnnotationUI(e);return assistantModes.list();});
  ipcMain.handle('assistant-modes-activate',(e,id)=>{fromAnnotationUI(e);const result=assistantModes.activate(id);sendUI('settings-changed',store.data.settings);return result;});
  ipcMain.handle('assistant-modes-save',(e,name,options)=>{fromAnnotationUI(e);return assistantModes.save(name,options);});
  ipcMain.handle('assistant-modes-delete',(e,id)=>{fromAnnotationUI(e);return assistantModes.remove(id);});
  ipcMain.handle('computer-emergency-stop',async e=>{fromCody(e);controller.configure({enabled:false});sendUI('settings-changed',store.data.settings);sendUI('activity',{text:'Emergency stop: Windows controls disabled'});updateTrayMenu();return {stopped:true}});
  ipcMain.handle('computer-permissions',e=>{fromCody(e);return controller.permissions()});
  ipcMain.handle('computer-configure',async(e,settings)=>{
    fromCody(e);
    if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Invalid permissions');
    if(Object.hasOwn(settings,'level')&&!['off','ask','approve-safe','standard','advanced','full'].includes(settings.level))throw Error('Invalid control level');
    const result=controller.configure(settings);
    sendUI('settings-changed',store.data.settings);updateTrayMenu();return {cancelled:false,permissions:result};
  });
  ipcMain.handle('computer-execute',async(e,{action,args}={})=>{fromCody(e);const result=await controller.execute(action,args,{origin:'gui'});sendUI('activity',{text:`Computer control: ${action}${result.cancelled?' (cancelled)':''}`});return result});
  const fromVoiceUI=e=>{if(!win||e.sender!==win.webContents)throw Error('Voice commands require the C.O.D.Y window');};
  ipcMain.handle('voice-voices',(e,engine)=>{fromVoiceUI(e);return speech.voices(engine);});
  ipcMain.handle('voice-install',(e,engine)=>{fromVoiceUI(e);return speech.install(engine);});
  ipcMain.handle('voice-cancel',e=>{fromVoiceUI(e);speech.cancel();return true;});
  ipcMain.handle('voice-status',e=>{fromVoiceUI(e);return speech.status();});
  ipcMain.handle('voice-configure',(e,settings)=>{fromVoiceUI(e);return speech.configure(settings);});
  ipcMain.handle('voice-transcribe',async(e,audio)=>{fromVoiceUI(e);return speech.transcribe(audio);});
  ipcMain.handle('voice-synthesize',async(e,{text}={})=>{fromVoiceUI(e);return speech.synthesize({text});});
  ipcMain.handle('state',()=>getState());
  ipcMain.handle('timer-dismiss',e=>{fromVoiceUI(e);if(desktopTimer.snapshot()?.status==='finished')desktopTimer.execute({action:'cancel'});return desktopTimer.snapshot();});
  ipcMain.handle('window-action',(_,action)=>{if(action==='minimize')island.showCompact();else if(action==='maximize'){win.isMaximized()?win.unmaximize():win.maximize();}else if(action==='close')win.close();else if(action==='quit'){quitting=true;app.quit();}});
  ipcMain.handle('save-settings',(_,settings)=>{if(!settings||typeof settings!=='object')throw Error('Invalid settings');if(settings.workingFolder&&!validateFolder(settings.workingFolder))throw Error('Invalid working folder');const saved=store.settings(settings);if(settings.annotations)annotations.configure(saved.annotations);if(settings.visuals)scene.configure(saved.visuals);updateTrayMenu();sendUI('settings-changed',saved);return saved;});
  ipcMain.handle('browse-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory'],title:'Choose the folder the agent can edit'});if(r.canceled)return null;store.settings({workingFolder:r.filePaths[0]});sendUI('settings-changed',store.data.settings);return r.filePaths[0];});
  ipcMain.handle('approval-decision',(event,id,decision)=>{
    fromCody(event);const req=pendingApprovals.get(id);if(!req)throw Error('Approval request has expired');if(!['accept','decline'].includes(decision))throw Error('Invalid decision');req.resolve(decision==='accept');pendingApprovals.delete(id);sendUI('approval-resolved',id);return true;
  });

}
function showMain(){if(!win||win.isDestroyed())createWindow();island.show();}
function quitCompletely(){quitting=true;app.quit();}
function updateTrayMenu(){trayMenu?.refresh();}
function createTray(){
  const image=nativeImage.createFromPath(branding.trayIcon);
  tray=new Tray(image.isEmpty()?nativeImage.createEmpty():image);
  tray.setToolTip(branding.name);
  trayMenu=new TrayMenu({BrowserWindow,ipcMain,screen,
    getState:()=>({controls:controller?.permissions().enabled===true,background:store.data.settings.runInBackground!==false}),
    onAction:action=>{
      if(action==='open')showMain();
      else if(action==='quit')quitCompletely();
      else if(action==='controls'){controller.configure({enabled:!controller.permissions().enabled});sendUI('settings-changed',store.data.settings);}
      else if(action==='background'){store.settings({runInBackground:store.data.settings.runInBackground===false});sendUI('settings-changed',store.data.settings);}
    }
  });
  tray.on('click',()=>trayMenu.toggle(tray.getBounds()));
  tray.on('right-click',()=>trayMenu.toggle(tray.getBounds()));
  tray.on('double-click',()=>{trayMenu.hide();showMain();});
}
const singleInstance=app.requestSingleInstanceLock();
const pendingNativeLinks=linksFromArgs(process.argv);
let nativeLinksReady=false;
async function deliverNativeLinks(){if(!nativeLinksReady)return;while(pendingNativeLinks.length){const url=pendingNativeLinks.shift();try{const link=new URL(url);if(link.hostname==='settings'){showMain();sendUI('browser-setup-open',{});continue;}await nativeEngine.request('deep-link',{url});sendUI('auth-changed',{});}catch{sendUI('diagnostic','C.O.D.Y. could not finish sign-in. Try signing in again.');}}}
app.on('open-url',(event,url)=>{event.preventDefault();const link=nativeLink(url);if(link){pendingNativeLinks.push(link);void deliverNativeLinks();}});
if(!singleInstance)app.quit();
else app.whenReady().then(async()=>{
  nativeTheme.themeSource='dark';app.setAppUserModelId(branding.appId);
  // Retired integrations kept their own browser session and temporary uploads.
  for(const directory of ['Partitions/cody-chatgpt-web','codex-home','vision-uploads']){
    const retired=path.resolve(integrationProfile,directory);
    if(!retired.startsWith(integrationProfile+path.sep))throw Error('Invalid retired integration path.');
    void require('node:fs').promises.rm(retired,{recursive:true,force:true})
      .catch(error=>sendUI('diagnostic','Could not clear retired assistant data: '+error.message));
  }
  store=new StateStore(app.getPath('userData'));
  await require('./control/word-answer-images').pruneAnswerImages(
    path.join(app.getPath('userData'),'native-state','answer-visuals'),store.data.chats)
    .catch(error=>console.warn('Could not prune saved answer images:',error.message));
  selfHosted=new SelfHosted({file:path.join(app.getPath('userData'),'self-hosted-connections.dat'),cipher:safeStorage,fetcher:(url,options)=>require('electron').net.fetch(url,options)});
  whatsappWeb=new WhatsAppWeb({BrowserWindow,session,icon:branding.icon,enabled:()=>store.data.settings.whatsappHandsFree===true});
  whatsappDrafts=new WhatsAppDrafts({open:url=>shell.openExternal(url),browser:whatsappWeb});
  const openRgbRuntime=new OpenRgbRuntime({directory:app.isPackaged?path.join(process.resourcesPath,'openrgb'):
    path.resolve(__dirname,'../../../run/openrgb/OpenRGB Windows 64-bit'),profile:path.join(app.getPath('userData'),'openrgb')});
  rgbLighting=new RgbLighting({pluginEnabled:store.data.settings.rgbLightingEnabled!==false,
    openClient:async()=>{
      openRgbRuntime.stopChild();
      const icue=await IcueLightingClient.connect(nativeEngine);
      return icue??openRgbRuntime.connect();
    },
    stopRuntime:closing=>closing?openRgbRuntime.close():openRgbRuntime.stopChild(),
    onChange:status=>sendUI('rgb-lighting-changed',status)});
  island.onStateChanged(state=>rgbLighting.setPhase(state));
  overseerrRequestFlow=new OverseerrRequests({service:selfHosted});
  plexSignIn=new PlexSignIn({service:selfHosted,version:app.getVersion(),openBrowser:openPreferredWebLink,
    onServersReady:()=>{if(!quitting&&win&&!win.isDestroyed())island.showSettings({tab:'integrations',plugin:'plex'});},
    fetcher:(url,options)=>require('electron').net.fetch(url,options)});
  app.once('will-quit',()=>plexSignIn.close());
  assistantModes=new AssistantModes({file:path.join(app.getPath('userData'),'assistant-modes.json'),island,store,
    onChange:()=>sendUI('settings-changed',store.data.settings)});
  updates=new UpdateService({version:app.getVersion(),packaged:app.isPackaged,
    createUpdater:()=>require('electron-updater').autoUpdater,
    enabled:store.data.settings.checkForUpdates!==false,
    saveEnabled:value=>{store.data.settings.checkForUpdates=value;store.save();},
    installBlocked:()=>Boolean(nativeBindings?.isBusy()||screenCapture?.active||nativeTasks.activeCount||['Listening','Processing','Responding'].includes(nativeEngine.status?.state))});
  registerUpdateIpc({ipcMain,updates,getWindow:()=>win,shell:{openExternal:openPreferredWebLink}});
  updates.on('change',state=>sendUI('updates-state',state));updates.start();
  if(store.data.settings.assistantProvider!=='heyclicky')store.settings({assistantProvider:'heyclicky'});
  // Every app launch starts a clean conversation; saved history stays available.
  store.newChat();
  desktopTimer=new DesktopTimer({file:path.join(app.getPath('userData'),'island-timer.json')});
  desktopTimer.on('change',timer=>{if(timer?.status!=='finished')timerAlarm.stop();refreshIslandCards();sendUI('timer-changed',timer);});
  desktopTimer.on('error',error=>sendUI('diagnostic','Timer: '+error.message));
  desktopTimer.on('finished',timer=>{
    timerAlarm.start();
    if(Notification.isSupported())new Notification({title:'C.O.D.Y — Timer finished',body:'Your timer is up.',icon:branding.icon,silent:true}).show();
    if(store.chat(timer.chatId)){const message=store.addMessage(timer.chatId,'assistant','Your timer is up.','local');sendUI('message-added',{chatId:timer.chatId,message});}
  });
  captures=new CaptureRegistry({screen});
  const visualScreen={
    getAllDisplays:()=>{const main=monitorAccess.primary()?.id;return monitorAccess.all().sort((a,b)=>Number(b.id===main)-Number(a.id===main));},
    getPrimaryDisplay:()=>monitorAccess.primary()||screen.getPrimaryDisplay(),
    screenToDipRect:(window,rect)=>screen.screenToDipRect(window,rect)
  };
  annotations=new AnnotationManager({overlay:new AnnotationOverlay({BrowserWindow,ipcMain,screen}),screen:visualScreen,captures,settings:store.data.settings.annotations,refreshTarget:(reference,cache)=>controller.refreshAnnotationTarget(reference,cache)});
  scene=new SceneManager({adapter:new SceneWindow({BrowserWindow,ipcMain}),screen:visualScreen,assets:new AssetRegistry(),settings:store.data.settings.visuals});
  island.setDisplayProvider(()=>monitorAccess.primary());
  const refreshMonitors=()=>monitorAccess.refresh().then(state=>{
    island.positionDisplay();void stickyNotes?.reconcile().catch(error=>sendUI('diagnostic',error.message));sendUI('monitor-access-changed',state);
  }).catch(()=>{});
  void refreshMonitors();
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>{
    captures.clear();
    if(monitorAccess.restricted){annotations.clearImmediate('monitor changed');scene.clearImmediate('monitor changed');}
    void refreshMonitors();
    void screenCapture?.recordingDisplayChanged();
  });
  visualLedger=new VisualLedger();
  scene.on('diagnostic',message=>sendUI('diagnostic','3D visuals: '+message));
  annotations.on('diagnostic',message=>sendUI('diagnostic','Annotations: '+message));
  let clearingNativeDrawing=false;
  island.onClearDrawings(()=>{
    annotations.clearImmediate('cleared with Ctrl+Alt+X');
    scene.clearImmediate('cleared with Ctrl+Alt+X');
    captures.clear();
    visualLedger.begin('gui');
    if(!nativeEngine.connected||clearingNativeDrawing)return;
    clearingNativeDrawing=true;
    void nativeEngine.request('clear').catch(error=>sendUI('diagnostic','Clear drawings: '+error.message))
      .finally(()=>{clearingNativeDrawing=false;});
  });
  const resetVisuals=reason=>{annotations.clearImmediate(reason);scene.clearImmediate(reason);captures.clear();visualLedger.begin('gui');};
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>resetVisuals('display configuration changed'));
  for(const event of ['suspend','resume','lock-screen'])powerMonitor.on(event,()=>resetVisuals('system power or lock state changed'));
  speech={cancel(){}}; // Speech is owned by the native HeyClicky session.
  spotify=new SpotifyMedia();spotify.on('change',state=>{sendUI('spotify-changed',state);refreshIslandCards();});spotify.start();
  // Stable per-profile identity. A browser extension can reclaim the existing
  // C.O.D.Y tab group after restart instead of accumulating a fresh agent.
  const firefoxSessionId='cody-'+createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0,12);
  firefoxBridge=new FirefoxBridge({sessionId:firefoxSessionId});
  firefoxBridge.on('status',status=>{sendUI('firefox-status',status);sendUI('activity',{text:status.connected?'Firefox extension connected':'Firefox extension offline'+(status.error?': '+status.error:'')});});
  try{firefoxBridge.start()}catch(e){sendUI('diagnostic','Firefox bridge: '+e.message);}
  actionAudit=new ActionAudit(path.join(app.getPath('userData'),'control-audit.jsonl'));
  controller=new ComputerController({
    readPermissions:()=>store.data.settings.computerControl,
    canUseLocalTools:()=>assistantModes.isLocalControlAllowed(),
    writePermissions:settings=>{store.settings({computerControl:settings});if(nativeEngine.connected&&(store.data.settings.nativePermissions?.enabled!==settings.enabled||store.data.settings.nativePermissions?.level!==settings.level))void nativeEngine.request("permissions-configure",{enabled:settings.enabled,level:settings.level}).catch(error=>sendUI("diagnostic",error.message));},
    getWorkingFolder:()=>store.data.settings.workingFolder,
    clipboard,desktopCapturer,browserBridge:firefoxBridge,spotify,annotations,scene,captures,visualLedger,monitorAccess,
    logAction:event=>{backendCapabilities.observe(event);actionAudit.append(event);},
    confirm:async({action,summary})=>{
      const id='local-'+require('node:crypto').randomUUID();
      return new Promise(resolve=>{pendingApprovals.set(id,{id,resolve});sendUI('approval',{id,reason:`Allow C.O.D.Y to perform ${action}?`,command:summary});island.show();});
    }
  });
  try{memory=new MemoryService({directory:path.join(app.getPath('userData'),'memory'),cipher:safeStorage});}catch(error){memoryError=error.message;}
  registerIpc();
  controller.plezy={play:title=>nativeEngine.request('plezy-play',{title})};
  controller.proofread=async target=>{if(!target)target=(await nativeEngine.request('text-capture',{clientPid:process.pid})).target;if(!target)throw Error('Click the text box, then hold your voice shortcut and say “spell check this”. The box must expose editable text.');return nativeEngine.request('proofread',{target});};
  controller.browserPreference=()=>nativeEngine.request('browser-preference-state');
  controller.windowControlBusy=async()=>nativeEngine.connected&&(await nativeEngine.request('drive-state')).active;
  controller.nativeAudio={set:level=>nativeEngine.request("audio-set",{level}),mute:muted=>nativeEngine.request("audio-mute",{muted})};
  controller.nativeKeyboard=(text,words)=>nativeEngine.request('keyboard-entry',{text,words});
  rps=new RockPaperScissors();rps.on("change",state=>{sendUI("rps-state",state);refreshIslandCards();});
  screenCapture=new ScreenCapture({BrowserWindow,ipcMain,desktopCapturer,screen,clipboard,nativeImage,shell,pictures:path.join(app.getPath('pictures'),'C.O.D.Y'),videos:path.join(app.getPath('videos'),'C.O.D.Y'),annotations,monitorAccess});
  controller.captureDisplay=id=>screenCapture.frameSource(id);
  let lastSavedCapture=null;screenCapture.on('change',state=>{sendUI('capture-state',state);refreshIslandCards();if(state.status==='starting')island.collapse();if(state.status==='saved'&&state.savedPath!==lastSavedCapture){lastSavedCapture=state.savedPath;showQuickCard({kind:'utility',text:'Recording saved',detail:'Click to open',icon:'camera',captureKind:'recording'});}if(state.status==='error')showQuickCard({kind:'utility',text:'Recording error',detail:state.error,icon:'circle-alert'});});
  monitors=new IslandMonitors({settingsFile:path.join(app.getPath('userData'),'island-monitors.json'),weather,readDesktopFrames:()=>nativeEngine.request('desktop-frames'),fetcher:(url,options)=>require('electron').net.fetch(url,options)});
  let lastMonitorActive=false;monitors.on('change',state=>{sendUI('monitor-state',state);refreshIslandCards();if(state.active&&!lastMonitorActive)island.showCompact({automatic:true});lastMonitorActive=state.active;});
  stickyNotes=new StickyNotes({BrowserWindow,ipcMain,file:path.join(app.getPath('userData'),'sticky-notes.json'),
    displays:()=>monitorAccess.all(),primary:()=>monitorAccess.primary(),
    neutralWindow:async(window,enabled)=>{
      if(enabled){
        const islandWindow=win&&!win.isDestroyed()?win.getNativeWindowHandle().readBigUInt64LE().toString():'';
        await nativeEngine.request('text-client',{clientPid:process.pid,islandWindow});
      }
      return nativeEngine.request('drawing-neutral-window',{window,enabled});
    },
    diagnostic:message=>sendUI('diagnostic',message)});
  const islandUtilities=new IslandUtilities({stickyNotes:{create:async args=>{await monitorAccess.refresh();return stickyNotes.create(args);}},
    drawingScope:args=>nativeEngine.request('drawing-scope',args),selfHosted,overseerrRequests:overseerrRequestFlow,whatsappDrafts,rgbLighting,openRgbPanel,textContext:async()=>{
    const result=await nativeEngine.request('text-capture',{clientPid:process.pid});
    return {editable:typeof result?.target==='string'&&result.target.length>0,protected:result?.isPassword===true||result?.sensitive===true};
  },modes:assistantModes,tasks:{open:()=>{island.show();sendUI("tasks-open");}},monitors,capture:screenCapture,rps,weather,timer:desktopTimer,spotify,controller,appSettings:{show:island.showSettings,update:island.updatePreferences},showCompact:()=>{island.showCompact({automatic:true});if(win?.isVisible())win.moveTop();},showCard:showQuickCard,clearCard:clearQuickCard,refreshMedia:refreshIslandCards,audioState:()=>nativeEngine.request("audio-state")});
  attachments=new Attachments({store,onChange:state=>sendUI('attachments-state',state),encodeImage:bytes=>{
    const image=nativeImage.createFromBuffer(bytes);
    if(image.isEmpty())return null;
    const {width,height}=image.getSize();
    const resized=Math.max(width,height)<=2400?image:image.resize(width>=height?{width:2400}:{height:2400});
    return resized.toPNG();
  },thumbnail:async file=>{const image=await nativeImage.createThumbnailFromPath(file,{width:64,height:64});return image.isEmpty()?null:image.toDataURL();},
  largeThumbnail:async file=>{
    let image=await nativeImage.createThumbnailFromPath(file,{width:900,height:700}).catch(()=>null);
    if(!image||image.isEmpty()){
      image=nativeImage.createFromPath(file);
      if(image.isEmpty())return null;
      const {width,height}=image.getSize();
      const scale=Math.min(1,900/width,700/height);
      if(scale<1)image=image.resize({width:Math.max(1,Math.round(width*scale))});
    }
    const png=image.toDataURL();
    return png.length<=400000?png:'data:image/jpeg;base64,'+image.toJPEG(86).toString('base64');
  },excerpt:async file=>{
    const {context}=await nativeEngine.request('attachments-text',{files:[file],preview:true});
    return JSON.parse(context)[0]?.Text||null;
  }});
  void attachments.prunePastes();
  nativeBindings=installNativeIpc({
    prepareWordImages:images=>require('./control/word-answer-images').prepareAnswerImages(images,{
      directory:path.join(app.getPath('userData'),'native-state','answer-visuals'),nativeImage}),
    localMemoryOnly,saveLocalMemory:text=>{
      if(!memory)throw Error(memoryError||'Local memory is unavailable.');
      return memory.saveLocal(text);
    },
    isMicrophoneMuted:()=>island.preferences().microphoneMuted===true,ipcMain,engine:nativeEngine,store,sendUI,controller,chooseWorkingFolder:async()=>{const result=await dialog.showOpenDialog(win,{properties:["openDirectory","createDirectory"],title:"Choose the background task workspace"});return result.canceled?null:result.filePaths[0];},getState,getWindow:()=>win,utilities:islandUtilities,rps,capture:screenCapture,attachments,onTasks:value=>{nativeTasks=value;refreshIslandCards();},captureTextEnabled:()=>{const permissions=controller.permissions();return permissions.enabled&&permissions.keyboardMouse&&permissions.uiAutomation;},chooseFiles:async()=>{const result=await dialog.showOpenDialog(win,{title:"Attach files to C.O.D.Y.",properties:["openFile","multiSelections"]});return result.canceled?[]:result.filePaths;},showFiles:()=>island.show(),fileDragging:value=>island.setFileDragActive(value),showApprovals:()=>island.show(),cancelLocalApprovals:()=>{for(const [id,request]of pendingApprovals){if(request.resolve){pendingApprovals.delete(id);request.resolve(false);sendUI('approval-resolved',id);}}}});
  if(!store.data.settings.nativeHeyClickyGui){store.data.settings.nativeHeyClickyGui=true;store.settings({voiceAutoSpeak:true,assistantProvider:"heyclicky"});}
  createWindow();createTray();
  const syncWeather=({weatherUnit,weatherCity})=>weather.configure({unit:weatherUnit,city:weatherCity});
  island.onPreferencesChanged(syncWeather);
  syncWeather(island.preferences());
  // Subscribe to Windows monitor brightness notifications instead of polling.
  // Unsupported external monitors fail quietly; brightness controls still work.
  const brightnessMonitor=new BrightnessMonitor();
  brightnessMonitor.on('change',level=>{
    if(['Listening','Processing','Responding'].includes(nativeEngine.status?.state))return;
    showQuickCard({kind:'brightness',text:level+'%',detail:'Brightness',icon:'sun',level},2400);
  });
  brightnessMonitor.start();
  app.once('will-quit',()=>{brightnessMonitor.stop();taskUpdates.close();});
  let nativeVoiceVolume;
  const syncVoiceVolume=({voiceVolume:volume})=>{
    if(volume===nativeVoiceVolume)return;
    nativeVoiceVolume=volume;
    void nativeEngine.request('voice-volume',{volume}).catch(error=>{
      if(nativeVoiceVolume===volume)nativeVoiceVolume=undefined;
      sendUI('diagnostic','Voice volume: '+error.message);
    });
  };
  island.onPreferencesChanged(syncVoiceVolume);
  syncVoiceVolume(island.preferences());
  const subtitles=new SubtitleOverlay({BrowserWindow,screen,onError:error=>sendUI('diagnostic','Subtitles: '+error.message)});
  const syncSubtitles=({speechSubtitles:enabled})=>{
    if(enabled===subtitles.enabled)return;
    subtitles.setEnabled(enabled);
    void nativeEngine.request('speech-subtitles-configure',{enabled}).catch(error=>sendUI('diagnostic','Subtitles: '+error.message));
  };
  nativeEngine.on('speech-subtitle',line=>subtitles.show(line));
  nativeEngine.on('speech-subtitle-end',()=>subtitles.finishSpeech());
  for(const event of ['speech-subtitle-clear','offline'])nativeEngine.on(event,()=>subtitles.clear());
  for(const event of ['lock-screen','suspend'])powerMonitor.on(event,()=>subtitles.setSuspended(true));
  for(const event of ['unlock-screen','resume'])powerMonitor.on(event,()=>subtitles.setSuspended(false));
  island.onPreferencesChanged(syncSubtitles);
  syncSubtitles(island.preferences());
  app.once('will-quit',()=>subtitles.close());
  controlOverlay=new ControlOverlay({BrowserWindow,screen,engine:nativeEngine,getAccent:()=>island.preferences().accentColor,getCursorColor:()=>island.preferences().cursorColor,getCursorOptions:()=>island.preferences(),getIslandWindow:()=>island.window(),getDockPoint:()=>{const bounds=island.window()?.getBounds();return bounds?{x:bounds.x+bounds.width/2,y:bounds.y+16}:null;}});
  controlOverlay.on('diagnostic',message=>sendUI('diagnostic',message));
  controlOverlay.on('change',state=>taskUpdates.drive(state));
  // An older engine process may still accept the input mode in configure.
  const syncCursorPreferences=()=>{controlOverlay.preferencesChanged();const prefs=island.preferences();void nativeEngine.request('configure',{screenHighlight:prefs.screenHighlight,cursorColor:controlOverlay.cursorColor(),cursorSize:prefs.cursorSize,systemInput:true}).catch(error=>sendUI('diagnostic',error.message));};
  let dictationActive=false,sessionLocked=false;
  nativeEngine.on('meter',value=>{dictationActive=value.dictationActive===true;});
  wakeListener=new KeywordWakeListener({launch:phrases=>{const layout=require('./native-layout').nativeLayout({packaged:app.isPackaged,resourcesPath:process.resourcesPath,userData:app.getPath('userData')});return {command:layout.executable,args:['--cody-wake','--phrases',phrases.join('|')],options:{cwd:layout.directory,env:layout.environment}};},canCapture:()=>sessionLocked?'Paused while this PC is locked.':!nativeEngine.connected?'Waiting for C.O.D.Y. to connect.':dictationActive?'Paused during dictation.':nativeBindings.gameVoice?.running?'Paused during voice games.':null,canListen:()=>sessionLocked?'Paused while this PC is locked.':!nativeEngine.connected?'Waiting for C.O.D.Y. to connect.':dictationActive?'Paused during dictation.':nativeBindings.gameVoice?.running?'Paused during voice games.':['Listening','Processing','Responding'].includes(nativeEngine.status.state)||nativeBindings.isBusy()?'Paused while C.O.D.Y. is busy.':null,
    beginVoice:options=>nativeBindings.beginVoice(options),forwardAudio:pcm=>nativeBindings.forwardWakeAudio(pcm),endVoice:()=>nativeBindings.endWakeVoice(),cancelVoice:()=>nativeBindings.cancelWakeVoice(),onWake:()=>nativeEngine.request('wake-cue')});
  nativeEngine.on('meter',value=>wakeListener.meter(value));nativeEngine.on('transcript',value=>wakeListener.heard(value.text));nativeEngine.on('phase',value=>wakeListener.phase(value.state));
  wakeListener.on('change',value=>{island.setWakeListening(['armed','hearing'].includes(value.mode));sendUI('wake-word-state',value);});wakeListener.on('diagnostic',message=>sendUI('diagnostic','Hands-free: '+message));
  ipcMain.handle('wake-word-status',event=>{if(event.sender!==win?.webContents||event.senderFrame!==event.sender.mainFrame)throw Error('Untrusted interface');return wakeListener.snapshot();});
  powerMonitor.on('lock-screen',()=>{sessionLocked=true;wakeListener.update();});powerMonitor.on('suspend',()=>{sessionLocked=true;wakeListener.update();});powerMonitor.on('unlock-screen',()=>{sessionLocked=false;wakeListener.update();});powerMonitor.on('resume',()=>{sessionLocked=false;wakeListener.update();});
  let lastMicrophoneMuted=island.preferences().microphoneMuted===true,microphoneSync=Promise.resolve();
  wakeListener.setMuted(lastMicrophoneMuted);
  island.onPreferencesChanged(prefs=>{
    const muted=prefs.microphoneMuted===true;
    if(muted!==lastMicrophoneMuted){
      lastMicrophoneMuted=muted;wakeListener.setMuted(muted);
      if(muted)void nativeBindings.muteVoice().catch(error=>sendUI('diagnostic',error.message));
      microphoneSync=microphoneSync.then(()=>nativeEngine.request('microphone-mute',{muted})).catch(error=>sendUI('diagnostic','Microphone mute: '+error.message));
    }
    wakeListener.configure(prefs);
  });wakeListener.configure(island.preferences());
  island.onPreferencesChanged(syncCursorPreferences);syncCursorPreferences();void nativeEngine.request("permissions-configure",{enabled:controller.permissions().enabled,level:controller.permissions().level}).then(value=>{store.setNativePermissions(value);sendUI("settings-changed",store.data.settings);}).catch(error=>sendUI("diagnostic",error.message));
  if(process.argv.includes("--verify-pinned-result-cards"))void require("../../../tools/verify-pinned-result-cards.cjs")({win,island,store,monitors,weather,engine:nativeEngine,bindings:nativeBindings});
  if(process.argv.includes("--verify-monitors"))void require("../../../tools/verify-monitors.cjs")({win,island,store,monitors,engine:nativeEngine});
  if(process.argv.includes("--verify-hide-monitor"))void require("../../../tools/verify-hide-monitor.cjs")({win,store,monitors,engine:nativeEngine});
  if(process.argv.includes("--verify-monitor-groups"))void require("../../../tools/verify-monitor-groups.cjs")({win,island,store,monitors});
  if(process.argv.includes("--verify-chat-layout"))void require("../../../tools/verify-chat-layout.cjs")({win,island});
  if(process.argv.includes("--verify-island-approvals"))void require("../../../tools/verify-island-approvals.cjs")({win,island,controller,engine:nativeEngine,pendingApprovals});
  if(process.argv.includes("--verify-overlay-order"))void require("../../../tools/verify-overlay-order.cjs")({win,island,overlay:controlOverlay,engine:nativeEngine,screen});
  if(process.argv.includes("--verify-control-overlay"))void require("../../../tools/verify-control-overlay.cjs")({win,overlay:controlOverlay,engine:nativeEngine,screen});
  if(process.argv.includes("--verify-app-split"))void require("../../../tools/verify-app-split.cjs")({win,store,controller,engine:nativeEngine});
  if(process.argv.includes("--verify-proofread"))void require("../../../tools/verify-proofread.cjs")({win,engine:nativeEngine,controller});
  if(process.argv.includes("--verify-background-tasks"))void require("../../../tools/verify-background-tasks.cjs")({win,engine:nativeEngine,store,island});
  if(process.argv.includes("--verify-island-visibility"))void require("../../../tools/verify-island-visibility.cjs")({win,island});
  if(process.argv.includes("--verify-browser-setup"))void require("../../../tools/verify-browser-setup.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-task-cards"))void require("../../../tools/verify-task-cards.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-settings-cursor"))void require("../../../tools/verify-settings-cursor.cjs")({win,island,engine:nativeEngine,store,overlay:controlOverlay,screen});
  if(process.argv.includes("--preview-history-style"))void require("../../../tools/preview-history-style.cjs")({win,island,store});
  if(process.argv.includes("--verify-identity"))void require("../../../tools/verify-identity.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-wake-listening"))void require("../../../tools/verify-keyword-wake-listening.cjs")({win,island,engine:nativeEngine,wakeListener});
  if(process.argv.includes("--verify-compact-task-cards"))void require("../../../tools/verify-compact-task-cards.cjs")({win,island});
  if(process.argv.includes("--verify-full-palette"))void require("../../../tools/verify-full-palette.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-dictation-shortcuts"))void require("../../../tools/verify-dictation-shortcuts.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-input-modes"))void require("../../../tools/verify-input-modes.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-mascot-appearance"))void require("../../../tools/verify-mascot-appearance.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-visual-capture"))void require("../../../tools/verify-visual-capture.cjs")({win,island,annotations,scene,capture:screenCapture,engine:nativeEngine});
  if(process.argv.includes("--verify-cursor-options"))void require("../../../tools/verify-cursor-options.cjs")({win,island,overlay:controlOverlay,engine:nativeEngine,screen});
  if(process.argv.includes("--verify-floating-cursor"))void require("../../../tools/verify-floating-cursor.cjs")({win,island,overlay:controlOverlay,engine:nativeEngine,screen});
  if(process.argv.includes("--verify-cursor-refresh"))void require("../../../tools/verify-cursor-refresh.cjs")({win,overlay:controlOverlay,screen});
  if(process.argv.includes("--verify-native-permissions"))void require("../../../tools/verify-native-permissions.cjs")({win,island,engine:nativeEngine,controller,store});
  if(process.argv.includes("--verify-model-zoom"))void require("../../../tools/verify-model-zoom.cjs")({win,engine:nativeEngine});
  if(process.argv.includes("--verify-plugins"))void require("../../../tools/verify-plugins.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-agents"))void require("../../../tools/verify-agents.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-screenshot-menu"))void require("../../../tools/verify-screenshot-menu.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-voice-layout"))void require("../../../tools/verify-voice-layout.cjs")({win,island});
  if(process.argv.includes("--verify-task-redesign"))void require("../../../tools/verify-task-redesign.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-independent-input"))void require("../../../tools/verify-independent-input.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-task-and-input"))void(async()=>{await require("../../../tools/verify-independent-input.cjs")({win,island,engine:nativeEngine});await require("../../../tools/verify-task-redesign.cjs")({win,island,engine:nativeEngine});})();
  if(process.argv.includes("--verify-retention-plugin-flight"))void require("../../../tools/verify-retention-plugin-flight.cjs")({win,island,engine:nativeEngine,controlOverlay});
  if(process.argv.includes("--verify-task-appearance"))void require("../../../tools/verify-task-appearance.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-input-routing"))setTimeout(()=>void nativeEngine.request("input-routing-checks",{clickSearch:process.argv.includes("--verify-whatsapp-click")}).then(value=>require("node:fs").writeFileSync(path.resolve(__dirname,"../../../reports/input-routing-checks.json"),JSON.stringify(value,null,2))).catch(console.error),3000);
  if(process.argv.includes("--diagnose-input"))setTimeout(()=>void nativeEngine.request("input-target-diagnostics").then(value=>require("node:fs").writeFileSync(path.resolve(__dirname,"../../../reports/input-target-diagnostics.json"),JSON.stringify(value,null,2))),3000);
  if(process.argv.includes("--verify-quiet-control"))setTimeout(()=>void require("../../../tools/verify-quiet-control.cjs")(nativeEngine),2000);
  if(process.argv.includes("--verify-control-polish"))void(async()=>{await require("../../../tools/verify-control-polish.cjs")({win,island,engine:nativeEngine});await require("../../../tools/verify-independent-input.cjs")({win,island,engine:nativeEngine});})();
  if(process.argv.includes("--verify-settings-refinement"))void require("../../../tools/verify-settings-refinement.cjs")({win,island,engine:nativeEngine,controller,store});
  if(process.argv.includes("--verify-settings-layout"))void require("../../../tools/verify-settings-layout.cjs")({win,island});
  if(process.argv.includes("--verify-voice-tiles"))void require("../../../tools/verify-voice-tiles.cjs")({win,island,engine:nativeEngine});
  if(process.argv.includes("--verify-listening-style"))void require("../../../tools/verify-listening-style.cjs")({win,overlay:controlOverlay,engine:nativeEngine,screen});
  if(process.argv.includes("--verify-standalone"))void require('./standalone-smoke')({app,win,engine:nativeEngine});
  if(process.argv.includes("--verify-attachments")||process.argv.includes("--verify-attachments-ui"))void require("../../../tools/verify-attachments.cjs")({win,island,store,attachments,engine:nativeEngine});
  if(process.argv.includes("--verify-media-controls"))void require("../../../tools/verify-media-controls.cjs")({win,island,store,spotify,monitors,controller});
  if(process.argv.includes("--verify-rps-compact"))void require("../../../tools/verify-rps-compact.cjs")({win,island,engine:nativeEngine,rps});
  if(process.argv.includes("--verify-screen-capture"))void require("../../../tools/verify-screen-capture.cjs")({win,island,store,capture:screenCapture,monitors});
  if(process.argv.includes("--verify-recording-quit"))void require("../../../tools/verify-recording-quit.cjs")({win,capture:screenCapture,app});
  if(process.argv.includes("--verify-rps-voice")||process.argv.includes("--verify-rps"))void require("../../../tools/verify-rps-compact.cjs")({win,island,engine:nativeEngine,rps});
  if(process.argv.includes("--verify-app-weather"))void require("../../../tools/verify-app-weather.cjs")({win,island,store,engine:nativeEngine});
  if(process.argv.includes("--verify-performance"))void require("../../../tools/verify-performance.cjs")({win,island,store,engine:nativeEngine});
  if(process.argv.includes("--verify-island-utilities"))void require("../../../tools/verify-island-utilities.cjs")({win,island,store,engine:nativeEngine,desktopTimer});
  if(process.argv.includes("--verify-native-ui")||process.argv.includes("--verify-native-mic"))void require("../../../tools/verify-original-gui.cjs")({win,island,store,engine:nativeEngine});
  nativeEngine.on('connected',()=>{
    void (async()=>{
      await nativeEngine.request('microphone-mute',{muted:island.preferences().microphoneMuted===true});
      const status=await nativeEngine.refresh();
      const islandWindow=win&&!win.isDestroyed()?win.getNativeWindowHandle().readBigUInt64LE().toString():'';
      await nativeEngine.request('text-client',{clientPid:process.pid,islandWindow});
      await monitorAccess.refresh();
      await stickyNotes?.syncNeutral();
      await stickyNotes?.restore();
      controlOverlay.update(await nativeEngine.request('drive-state'));
      nativeLinksReady=true;
      void deliverNativeLinks();
      sendUI('status',{connected:true,detail:status.signedIn?'HeyClicky connected':'HeyClicky sign-in required'});
    })().catch(error=>sendUI('diagnostic',error.message));
  });
  nativeEngine.on('offline',()=>{nativeLinksReady=false;sendUI('status',{connected:false,detail:'HeyClicky disconnected'});});
  void nativeEngine.start().then(()=>{
    if(rgbLighting.pluginEnabled&&!rgbLighting.closed&&!rgbLighting.client)return rgbLighting.discover();
  }).catch(error=>sendUI('diagnostic',error.message));
  try{desktopTimer.restore();refreshIslandCards();}catch(error){sendUI('diagnostic','Could not restore timer: '+error.message);}
  stopPushToTalk=startPushToTalk(value=>island.handleHotkey(value));
  app.on('activate',showMain);
});
app.on('second-instance',(_event,args)=>{pendingNativeLinks.push(...linksFromArgs(args));void deliverNativeLinks();if(singleInstance&&!args.includes('--background'))showMain();});
app.on('before-quit',event=>{if(screenCapture?.active&&!captureQuitReady){event.preventDefault();if(!captureQuitPending){captureQuitPending=true;void screenCapture.execute('stop').catch(error=>console.error(error)).finally(()=>{captureQuitReady=true;app.quit();});}return;}
  if(rgbLighting&&!rgbQuitReady){
    event.preventDefault();
    if(!rgbQuitPending){rgbQuitPending=true;void rgbLighting.close().catch(error=>console.error(error)).finally(()=>{rgbQuitReady=true;app.quit();});}
    return;
  }
  stickyNotes?.close();whatsappWeb?.close();updates?.close();trayMenu?.close();wakeListener?.close();controlOverlay?.close();nativeEngine.close();monitors?.close();quitting=true;memory?.close();annotations?.close();scene?.close();captures?.clear();clearTimeout(quickCardExpiry);timerAlarm.stop();spotify?.close();desktopTimer?.close();stopPushToTalk();island.stop();speech?.cancel();for(const request of pendingApprovals.values()){try{request.resolve(false);}catch{}}void firefoxBridge?.close();});
app.on('window-all-closed',()=>{if(quitting&&process.platform!=='darwin')app.quit();});
