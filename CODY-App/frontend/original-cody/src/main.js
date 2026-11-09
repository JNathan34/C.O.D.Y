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
const {createHash}=require('node:crypto');
const {CodexClient}=require('./codex-client');
const {readCodexUsage}=require('./account-usage');
let usageClient;
const {HeyClickyAdapter}=require('./providers/heyclicky');
const {CodexAgent}=require('./providers/codex');
const {MemoryService}=require('./memory/service');
const {registerMemoryIpc}=require('./memory/ipc');
const {CapabilityRegistry}=require('./providers/capabilities');
const backendCapabilities=new CapabilityRegistry();
let heyclicky,codexAgent,memory,memoryError='';
const {CodexVisualPlanner,visualOnly}=require('./visuals/codex-planner');
let visualPlanner;
const {StateStore}=require('./store');
const {registerSettingsBackupIpc}=require('./settings-backup');
const {ChatGPTBrowser}=require('./chatgpt-browser');
const {formatWebPrompt}=require('./cody-persona');
const {inspectQuota,quotaMessage}=require('./quota');
const {routeRequest,isExpensive,localAnswer,localCard,validateFolder}=require('./router');
const {ComputerController}=require('./control/controller');
const {parseDirectAction}=require('./control/parser');
const {FirefoxBridge}=require('./control/firefox-bridge');
const {buildWebActionPrompt,parseActionReply,stripTrailingActionDraft}=require('./control/web-actions');
const {allowedFor,stripToolDraft,executeToolLoop}=require('./control/tool-loop');
const {capabilityStatus}=require('./control/readiness');
const {prepareFirefoxTask}=require('./control/firefox-startup');
const {resolveTask}=require('./control/task-continuation');
const {testFirefoxTools}=require('./control/firefox-smoke');
const {safeStorage}=require('electron');
const {LocalSpeech}=require('./voice/local-speech');
const island=require('./island/main');
const {NativeEngine}=require('./native-engine');
const {nativeLink,linksFromArgs}=require('./native-links');
const {installNativeIpc}=require('./native-ipc');
const {selection:agentSelection,providerPatch,exactCodexModel}=require('./agent-provider');
const {setPersonalCodexEnabled}=require('./usage-policy');
let sendProviderMessage,cancelProviderTurn;
const {IslandUtilities}=require('./island-utilities');
const {RockPaperScissors}=require('./rock-paper-scissors');
const {ScreenCapture}=require('./screen-capture');
const {IslandMonitors}=require('./island-monitors');
const {Attachments}=require('./attachments');
let attachments;
const {ControlOverlay}=require('./control-overlay');
const {KeywordWakeListener}=require('./voice/keyword-wake-listener');
let controlOverlay,wakeListener;
const nativeEngine=new NativeEngine();
nativeEngine.on('screen-capture-ui',value=>island.setCaptureUIActive(value?.active===true));
nativeEngine.on('offline',()=>island.setCaptureUIActive(false));
const {startPushToTalk}=require('./voice/hotkey');
const {DesktopTimer}=require('./timer');
const {TimerAlarm}=require('./alarm');
const {SpotifyMedia}=require('./spotify');
const {Weather}=require('./weather');
const weather=new Weather({fetcher:(url,options)=>require('electron').net.fetch(url,options)});
const timerAlarm=new TimerAlarm();let spotify,quickCard=null,quickCardExpiry=null;
function refreshIslandCards(){const media=spotify?.snapshot();island.setGameActive(Boolean(rps?.snapshot().active));island.setRecordingActive(Boolean(screenCapture?.active));island.setTimerVisible(Boolean(nativeTasks.activeCount)||Boolean(monitors?.snapshot().active)||Boolean(desktopTimer?.snapshot())||Boolean(media?.available&&media.title)||Boolean(quickCard&&quickCard.expiresAt>Date.now()));}
function clearQuickCard(){clearTimeout(quickCardExpiry);quickCard=null;sendUI("island-card",null);refreshIslandCards();}
function showQuickCard(card){quickCard={...card,expiresAt:Date.now()+10000};sendUI('island-card',quickCard);refreshIslandCards();clearTimeout(quickCardExpiry);quickCardExpiry=setTimeout(()=>{quickCard=null;sendUI('island-card',null);refreshIslandCards();},10000);quickCardExpiry.unref();}
let nativeTasks={connected:false,tasks:[],activeCount:0};
let desktopTimer,rps,screenCapture,monitors,captureQuitPending=false,captureQuitReady=false;
let annotations,scene,captures,visualLedger;
const integrationProfile=process.env.CODY_PROFILE_DIR?path.resolve(process.env.CODY_PROFILE_DIR):path.join(app.getPath('appData'),'CODY-Integrated');
const localMemoryOnly=()=>require('node:fs').existsSync(path.join(integrationProfile,'native-state','local-memory-only'));
require('node:fs').mkdirSync(integrationProfile,{recursive:true});
app.setPath('userData',integrationProfile);
app.setName(branding.name);
let stopPushToTalk=()=>{};
// Optional fallback for machines with unstable Electron GPU drivers.
// Set CODY_DISABLE_GPU=1 before launching; normal users retain acceleration.
// On Windows prefer software graphics because Chromium's GPU process can
// repeatedly access-violate on some ARM64/Snapdragon driver configurations.
// Set CODY_ENABLE_GPU=1 explicitly to restore hardware acceleration.
if((process.platform==='win32' && process.env.CODY_ENABLE_GPU!=='1') || process.env.CODY_DISABLE_GPU==='1'){
  app.disableHardwareAcceleration();
  // Audited local Three.js content only. Remote ChatGPT/auth windows disable
  // WebGL, so this software fallback does not expose their content to it.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
let speech,firefoxBridge,win,store,codex,webBrowser,tray,controller,quitting=false,activeTurn=null,activeAgentMessage=null,starting=false;
const pendingApprovals=new Map();
const sendUI=(event,payload)=>{if(win&&!win.isDestroyed())win.webContents.send(event,payload);};
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
  if(store.data.settings.startMinimized||process.argv.includes('--background'))island.showCompact();
  win.webContents.setWindowOpenHandler(({url})=>{try{const link=new URL(url);if(['https:','http:'].includes(link.protocol))void shell.openExternal(link.href).catch(()=>{});}catch{}return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://'))event.preventDefault();});
}
function getState(){return {...store.publicState(),tasks:nativeTasks,rps:rps?.snapshot(),monitors:monitors?.snapshot(),capture:screenCapture?.snapshot(),timer:desktopTimer?.snapshot(),quickCard,spotify:spotify?.snapshot(),controlCapabilities:controller?.catalog(),firefoxConnection:firefoxBridge?.status(),connected:Boolean(codex?.ready),busy:Boolean(activeTurn||starting),webConnected:Boolean(webBrowser?.lastState?.signedIn)};}
function initCodex(){
  if(codex)return codex;codex=new CodexClient();
  codex.on('online',()=>sendUI('status',{connected:true,detail:'Codex connected'}));
  codex.on('offline',reason=>{sendUI('status',{connected:false,detail:reason});if(activeTurn?.engine==='agent')finishTurn('Codex stopped before the task completed');});
  codex.on('diagnostic',detail=>sendUI('diagnostic',detail));
  codex.on('approval',req=>{
    const allowed=['item/commandExecution/requestApproval','item/fileChange/requestApproval'];
    if(!allowed.includes(req.method)){try{codex.respond(req.id,'decline');}catch{}return;}
    pendingApprovals.set(req.id,req);
    sendUI('approval',{id:req.id,method:req.method,reason:req.params.reason||'The agent is requesting additional permission.',command:req.params.command||'',cwd:req.params.cwd||'',network:req.params.networkApprovalContext||null});
    // Never silently approve while hidden in tray. Surface the existing approval UI.
    showMain();
  });
  codex.on('event',msg=>{
    const p=msg.params||{};if(msg.method==='account/updated'||msg.method==='account/login/completed'){if(visualPlanner&&!visualPlanner.active){visualPlanner.close();visualPlanner=null;}sendUI('auth-changed',p);return;}
    if(msg.method==='thread/tokenUsage/updated'){const usage=p.tokenUsage||p;const id=activeTurn?.chatId;if(id){store.setUsage(id,usage);sendUI('usage',usage);}return;}
    if(!activeTurn||activeTurn.engine!=='agent')return;
    if(p.threadId&&p.threadId!==activeTurn.threadId)return;
    if(msg.method==='item/agentMessage/delta'){
      const delta=p.delta||'';if(typeof delta==='string'&&delta){store.appendMessage(activeTurn.chatId,activeTurn.messageId,delta);sendUI('message-delta',{chatId:activeTurn.chatId,messageId:activeTurn.messageId,delta});activeAgentMessage=true;}
    }else if(msg.method==='item/completed'&&p.item?.type==='agentMessage'){
      const final=p.item.text||'';if(final){const chat=store.chat(activeTurn.chatId);const existing=chat?.messages.find(m=>m.id===activeTurn.messageId);if(!existing?.text||!activeAgentMessage){store.updateMessage(activeTurn.chatId,activeTurn.messageId,final);sendUI('message-replace',{chatId:activeTurn.chatId,messageId:activeTurn.messageId,text:final});}}
    }else if(msg.method==='item/started'&&p.item){
      const item=p.item; if(item.type==='commandExecution')sendUI('activity',{text:'Running: '+String(item.command||'command').slice(0,170)});else if(item.type==='fileChange')sendUI('activity',{text:'Reviewing file changes…'});
    }else if(msg.method==='turn/completed'){
      const status=p.turn?.status||'unknown';finishTurn(status==='completed'?'':(p.turn?.error?.message||`Task ${status}`));
    }else if(msg.method==='error')sendUI('activity',{text:'Error: '+String(p.error?.message||'Unknown Codex error')});
  });
  return codex;
}
function initWebBrowser(){
  if(webBrowser)return webBrowser;
  webBrowser=new ChatGPTBrowser({BrowserWindow,session,parent:()=>win,screenshotDirectory:path.join(app.getPath('userData'),'vision-uploads')});
  webBrowser.on('status',status=>sendUI('web-status',{connected:status.signedIn===true,needsSignIn:status.authRequired===true,stage:status.stage,detail:status.detail}));
  return webBrowser;
}
function completedActionSummary(action,args,result){
  if(result?.cancelled)return 'Computer action cancelled by the user.';
  switch(action){
    case 'app.open':return `Opened ${args.app}.`;
    case 'audio.set':return `Set volume to ${args.level}%.`;
    case 'audio.mute':return args.muted?'Muted the computer.':'Unmuted the computer.';
    case 'spotify.control':return ({play:'Resuming Spotify.',pause:'Pausing Spotify.',next:'Skipping to the next song.',previous:'Playing the previous song.',toggle:'Toggling Spotify playback.'})[args.command];
    case 'system.status':return `Computer status: ${JSON.stringify(result.result).slice(0,1200)}`;
    case 'window.list':return `Found ${Array.isArray(result.result)?result.result.length:0} open windows. Details were not sent to ChatGPT.`;
    case 'window.focus':return 'Focused the approved window.';
    case 'keyboard.type':return 'Typed the approved text into the current window.';
    case 'keyboard.hotkey':return 'Sent the approved keyboard shortcut.';
    case 'mouse.move':return 'Moved the mouse to the approved position.';
    case 'mouse.click':return 'Performed the approved mouse click.';
    case 'files.list':return `Listed ${Array.isArray(result.result)?result.result.length:0} items locally (not shared with ChatGPT).`;
    case 'files.read':return 'Read the file locally; its contents were not sent to ChatGPT.';
    case 'files.write':return 'Saved the approved file.';
    case 'screen.capture':return 'Captured the screen locally; no image was uploaded.';
    case 'clipboard.read':return 'Read the clipboard locally; its contents were not sent to ChatGPT.';
    case 'clipboard.write':return 'Updated the clipboard.';
    default:return 'Computer action completed.';
  }
}
function finishTurn(error=''){
  if(!activeTurn)return;
  captures?.clear();
  if(error){annotations?.clearImmediate('task failed');scene?.cancelAnimations();visualLedger?.begin('gui');}else annotations?.finishScope(activeTurn.messageId);
  if(error){const chat=store.chat(activeTurn.chatId);const msg=chat?.messages.find(m=>m.id===activeTurn.messageId);if(msg){const message=(msg.text?msg.text+'\n\n⚠ '+error:'Could not finish: '+error);store.updateMessage(activeTurn.chatId,activeTurn.messageId,message);sendUI('message-replace',{chatId:activeTurn.chatId,messageId:activeTurn.messageId,text:message});}sendUI('activity',{text:error});}
  if(['web','codex-bridge'].includes(activeTurn.engine))store.save(); // flush any batched streaming changes
  const spoken=!error&&activeTurn.speak?store.chat(activeTurn.chatId)?.messages.find(m=>m.id===activeTurn.messageId)?.text:null;
  activeTurn=null;activeAgentMessage=false;sendUI('busy',{busy:false});
  if(spoken)void nativeEngine.request('speak',{text:spoken}).catch(error=>sendUI('diagnostic',error.message));
}
function registerIpc(){
  registerSettingsBackupIpc({ipcMain,dialog,getWindow:()=>win,island,store,engine:nativeEngine,onAppSettingsChanged:()=>{
    updateTrayMenu();
    sendUI('settings-changed',store.data.settings);
  }});
  ipcMain.handle('backend-status',e=>{fromAnnotationUI(e);return {heyclicky:heyclicky.status(),capabilities:backendCapabilities.snapshot(),defaultProvider:store.data.settings.assistantProvider||'heyclicky',autoAvailable:false,voiceProvider:'C.O.D.Y. native Windows / Edge; HeyClicky speech unavailable',toolsProvider:'C.O.D.Y. permission-controlled Windows and visual tools'};});
  ipcMain.handle('backend-refresh',e=>{fromAnnotationUI(e);return heyclicky.refresh();});
  const fromCody=e=>{if(!win||e.sender!==win.webContents)throw Error('Computer controls are only accessible from the C.O.D.Y interface')};
  const fromAnnotationUI=e=>{fromCody(e);if(e.senderFrame!==win.webContents.mainFrame)throw Error('Annotations require the trusted main C.O.D.Y frame');};
  registerMemoryIpc({ipcMain,dialog,window:()=>win,authorise:fromAnnotationUI,memory,error:memoryError,codex:codexAgent,withFileDialog:island.withFileDialog,onAccessChange:()=>{if(activeTurn?.engine==='codex-bridge')activeTurn.abortController.abort();for(const chat of store.data.chats)delete chat.codexBridgeThreadId;store.save();}});
  ipcMain.handle('annotations-settings',e=>{fromAnnotationUI(e);return annotations.status();});
  ipcMain.handle('annotations-configure',(e,patch)=>{fromAnnotationUI(e);const result=annotations.configure(patch);store.settings({annotations:result.settings});sendUI('settings-changed',store.data.settings);return result;});
  ipcMain.handle('annotations-clear',e=>{fromAnnotationUI(e);annotations.clearImmediate('cleared by user');return {cleared:true};});
  // Explicit trusted demo buttons render fixed local visuals, without AI or computer automation.
  ipcMain.handle('annotations-demo',async e=>{fromAnnotationUI(e);return annotations.execute('draw.batch',{commands:demoCommands(screen.getPrimaryDisplay().bounds).filter(command=>annotations.settings.spotlight||command.action!=='draw.spotlight')},{origin:'gui'});});
  ipcMain.handle('annotations-speech',(e,event)=>{
    fromAnnotationUI(e);const data=typeof event==='string'?{phase:event}:event;
    if(!data||Object.keys(data).some(key=>!['phase','scopeId','segmentId','currentTime'].includes(key))||!['playing','paused','resumed','progress','finished','cancelled'].includes(data.phase)||data.scopeId!==undefined&&(typeof data.scopeId!=='string'||data.scopeId.length>100)||data.currentTime!==undefined&&(!Number.isFinite(data.currentTime)||data.currentTime<0))throw Error('Invalid speech playback event');
    if(data.phase!=='progress'){annotations.speech(data.phase,data.scopeId);scene.speech(data.phase,data.scopeId);}return {accepted:true};
  });
  ipcMain.handle('visuals-state',e=>{fromAnnotationUI(e);return {settings:scene.settings,...scene.status()};});
  ipcMain.handle('visuals-configure',(e,patch)=>{fromAnnotationUI(e);const result=scene.configure(patch);store.settings({visuals:scene.settings});sendUI('settings-changed',store.data.settings);return {settings:scene.settings,...result};});
  ipcMain.handle('visuals-demo',async e=>{fromAnnotationUI(e);const id='computer-'+Date.now();return scene.execute('model.generate',{id,preset:'computer'},{origin:'gui'});});
  ipcMain.handle('visuals-clear',e=>{fromAnnotationUI(e);scene.clearImmediate('cleared by user');return {cleared:true};});
  ipcMain.handle('visuals-clear-all',async e=>{fromAnnotationUI(e);activeTurn?.abortController?.abort();visualLedger.begin('gui');annotations.clearImmediate('emergency visual clear');scene.clearImmediate('emergency visual clear');captures.clear();if(activeTurn?.engine==='web')await initWebBrowser().stop();return {cleared:true};});
  ipcMain.handle('firefox-status',e=>{fromCody(e);return firefoxBridge?.status()||{connected:false,error:'Bridge not initialized'};});
  ipcMain.handle('firefox-smoke-test',async e=>{fromCody(e);if(!firefoxBridge?.status().connected)throw Error('Firefox is not ready; check the add-on connection first.');return testFirefoxTools(controller);});
  ipcMain.handle('computer-catalog',e=>{fromCody(e);return controller.catalog()});
  ipcMain.handle('computer-audit',e=>{fromCody(e);const fs=require('node:fs');try{return fs.readFileSync(path.join(app.getPath('userData'),'control-audit.jsonl'),'utf8').split('\n').filter(Boolean).slice(-80).map(line=>JSON.parse(line))}catch{return []}});
  ipcMain.handle('computer-emergency-stop',async e=>{fromCody(e);controller.configure({enabled:false});activeTurn?.abortController?.abort();if(activeTurn?.engine==='web')await webBrowser?.stop();sendUI('settings-changed',store.data.settings);sendUI('activity',{text:'Emergency stop: Windows controls disabled'});updateTrayMenu();return {stopped:true}});
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
  ipcMain.handle('new-chat',()=>{if(activeTurn)throw Error('Finish your current reply first');const c=store.newChat();sendUI('chats-changed',store.publicState());return c;});
  ipcMain.handle('select-chat',(_,id)=>{store.select(id);sendUI('chats-changed',store.publicState());return store.chat(id);});
  ipcMain.handle('delete-chat',(_,id)=>{if(activeTurn?.chatId===id)throw Error('Stop the active task first');store.deleteChat(id);sendUI('chats-changed',store.publicState());});
  ipcMain.handle('save-settings',(_,settings)=>{if(!settings||typeof settings!=='object')throw Error('Invalid settings');const allowedEfforts=['low','medium','high','xhigh'];if(settings.defaultReasoning&&!allowedEfforts.includes(settings.defaultReasoning))throw Error('Invalid effort');if(settings.webModel&&!/^(website|(6|6\.1-sol|5\.6):(low|medium|high|xhigh))$/.test(settings.webModel))throw Error('Invalid ChatGPT Web model');if(settings.workingFolder&&!validateFolder(settings.workingFolder))throw Error('Invalid working folder');const saved=store.settings(settings);if(settings.annotations)annotations.configure(saved.annotations);if(settings.visuals)scene.configure(saved.visuals);updateTrayMenu();sendUI('settings-changed',saved);return saved;});
  ipcMain.handle('browse-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory'],title:'Choose the folder the agent can edit'});if(r.canceled)return null;store.settings({workingFolder:r.filePaths[0]});sendUI('settings-changed',store.data.settings);return r.filePaths[0];});
  ipcMain.handle('connect',async()=>{await initCodex().start();const account=await codex.account();const models=await codex.models().catch(()=>[]);return {account:account.account,models};});
  ipcMain.handle('account',async()=>{await initCodex().start();const info=await codex.account();return info.account;});
  ipcMain.handle('sign-in',async()=>{await initCodex().start();const a=await codex.login();if(a?.authUrl){await shell.openExternal(a.authUrl);return {started:true};}throw Error('Codex did not provide a sign-in URL');});
  ipcMain.handle('rate-limits',async()=>{await initCodex().start();return codex.rateLimits();});
  ipcMain.handle('open-chatgpt',async()=>initWebBrowser().show());
  ipcMain.handle('web-status',async()=>initWebBrowser().status({create:true}));
  ipcMain.handle('web-sign-in',async()=>{await initWebBrowser().show();return {started:true};});
  ipcMain.handle('approval-decision',(event,id,decision)=>{
    fromCody(event);const req=pendingApprovals.get(id);if(!req)throw Error('Approval request has expired');if(!['accept','decline'].includes(decision))throw Error('Invalid decision');pendingApprovals.delete(id);if(req.resolve)req.resolve(decision==='accept');else codex.respond(id,decision);return true;
  });
  sendProviderMessage=async({chatId,text,mode,voice=false})=>{
    text=String(text||'').trim();if(!text||text.length>25000)throw Error('Enter a message under 25,000 characters');
    const route=routeRequest(text,mode==='agent'?'agent':'chatgpt');
    if(activeTurn||starting)throw Error('Another reply is in progress');const chat=store.chat(chatId);if(!chat)throw Error('Select a conversation');
    const settings=store.data.settings;
    const selected=['heyclicky','codex','chatgpt','agent'].includes(mode)?mode:(settings.assistantProvider||'heyclicky');
    const remember=/^remember (?:that )?([\s\S]+)$/i.exec(text);
    if(remember&&memory){
      memory.saveLocal(remember[1]);
      const user=store.addMessage(chatId,'user','Private memory request','local');const answer=store.addMessage(chatId,'assistant','Saved on this PC. Open Settings → Memory to view it.','local');sendUI('message-added',{chatId,message:user});sendUI('message-added',{chatId,message:answer});return {local:true};
    }
    if(selected==='heyclicky'){
      const user=store.addMessage(chatId,'user',text,'heyclicky');const answer=store.addMessage(chatId,'assistant',heyclicky.status().reason+' Select Codex in the agent selector to use your own Codex account.','heyclicky');sendUI('message-added',{chatId,message:user});sendUI('message-added',{chatId,message:answer});return {blocked:true,provider:'heyclicky'};
    }
    if(selected==='codex'){
      const user=store.addMessage(chatId,'user',text,'codex'),answer=store.addMessage(chatId,'assistant','','codex');sendUI('message-added',{chatId,message:user});sendUI('message-added',{chatId,message:answer});
      const abortController=new AbortController(),effectiveTask=resolveTask(text,chat).task;activeTurn={engine:'codex-bridge',chatId,messageId:answer.id,abortController,speak:voice||settings.voiceAutoSpeak};annotations.beginScope(answer.id);scene.beginScope(answer.id);visualLedger.begin(answer.id);captures.clear();sendUI('busy',{busy:true});
      let context;try{context=(!localMemoryOnly()&&memory?.context(text,'codex',settings.workingFolder))||{prompt:'',records:[]};}catch(error){finishTurn('Memory retrieval failed. Review the local memory store.');return {error:'Memory retrieval failed'};}if(context.records.length)sendUI('activity',{text:'Using '+context.records.length+' authorised memory references'});
      void codexAgent.run({human:effectiveTask,permissions:controller.permissions(),cwd:settings.workingFolder||undefined,model:'gpt-6.1-sol',threadId:chat.codexBridgeThreadId,memory:context.prompt,signal:abortController.signal,
        onThread:id=>{chat.codexBridgeThreadId=id;store.save();},onActivity:text=>sendUI('activity',{text}),onText:text=>{if(activeTurn?.messageId!==answer.id)return;store.updateMessage(chatId,answer.id,text,{persist:false});sendUI('message-replace',{chatId,messageId:answer.id,text});},
        execute:async(action,args,signal)=>{if(abortController.signal.aborted)throw Error('Cancelled');const verifiedCaptureId=args.captureId&&captures.isDelivered(args.captureId,answer.id)?args.captureId:undefined;const result=await controller.execute(action,args,{origin:'ai-chat',verifiedUserIntent:true,humanTask:effectiveTask,scopeId:answer.id,signal,verifiedCaptureId,deliverImage:action==='screen.capture'});if(action==='screen.capture'&&result.result?.attachmentPending){const attachment=captures.forDelivery(result.result.metadata.captureId,answer.id);return {...result,image:'data:image/png;base64,'+attachment.bytes.toString('base64'),delivered:()=>captures.markDelivered(attachment.metadata.captureId,answer.id,{accepted:true,imageCount:1})};}return result;}
      }).then(()=>{if(activeTurn?.messageId===answer.id)finishTurn();}).catch(error=>{if(activeTurn?.messageId===answer.id)finishTurn(error.message);});return {started:true,provider:'codex'};
    }
    // Strictly whitelisted Windows commands can run without a model request.
    // Unrecognised requests continue through the unchanged ChatGPT Web flow.
    if(mode!=='agent'){
      const direct=parseDirectAction(text);
      if(direct && !controller.permissions().enabled){
        return {error:'Computer controls are disabled. Right-click the C.O.D.Y tray icon and turn on Computer controls, then try again. No Codex usage is needed.'};
      }
      if(direct && controller.permissions().enabled){
        const user=store.addMessage(chatId,'user',text,'chatgpt');
        sendUI('message-added',{chatId,message:user});
        let reply;
        try{
          const result=await controller.execute(direct.action,direct.args,{origin:'chat'});
          reply=typeof result.result==='string'?result.result:JSON.stringify(result.result,null,2);
          if(result.ok&&direct.action.startsWith('system.')&&result.result?.message)reply=result.result.message;
          if(result.ok&&direct.action==='spotify.control')reply=completedActionSummary(direct.action,direct.args,result);
          if(result.ok&&direct.action==='audio.set')showQuickCard({kind:'utility',text:direct.args.level+'%',detail:'Volume',icon:'volume-2'});
          if(result.ok&&direct.action==='audio.mute')showQuickCard({kind:'utility',text:direct.args.muted?'Muted':'Unmuted',detail:'Sound',icon:direct.args.muted?'volume-x':'volume-2'});
          if(result.ok&&direct.action==='app.open')showQuickCard({kind:'utility',text:'Opened',detail:direct.args.app,icon:'external-link'});
        }catch(e){reply='Computer control: '+e.message;}
        const answer=store.addMessage(chatId,'assistant',reply,'local');
        sendUI('message-added',{chatId,message:answer});sendUI('chats-changed',store.publicState());
        return {local:true,computerControl:true};
      }
    }
    const visualCandidate=allowedFor(resolveTask(text,chat).task,controller.permissions());
    const useVisualCodex=false; // Integrated AI visuals use HeyClicky, never the personal Codex planner.
    if(route.kind==='chatgpt-web'||useVisualCodex){
      // Integrated ChatGPT website session. Browser task preparation uses the
      // existing guarded Windows controls; never falls back to Codex.
      const browser=initWebBrowser();
      // The human's current request and currently enabled permissions determine
      // which (if any) structured actions the AI may propose. A webpage or an
      // assistant reply alone can NEVER grant OS permissions.
      const scope=resolveTask(text,chat);
      const effectiveTask=scope.task;
      const actionContract=buildWebActionPrompt(effectiveTask,controller.permissions());
      const workflowAllowed=allowedFor(effectiveTask,controller.permissions());
      let diagnostic,state;
      starting=true;sendUI('busy',{busy:true});
      try{
        diagnostic=await prepareFirefoxTask(effectiveTask,{controller,bridge:firefoxBridge,
          workingFolder:settings.workingFolder,onActivity:text=>sendUI('activity',{text})});
        if(!diagnostic&&!scene.settings.enabled&&workflowAllowed.some(action=>/^(model|scene)\./.test(action))&&!/\b(?:clear|remove|close)\b/i.test(effectiveTask))diagnostic={reason:'Enable 3D models in Settings → Visuals first.'};
        if(!diagnostic&&!annotations.settings.enabled&&workflowAllowed.some(action=>action.startsWith('draw.'))&&!/\b(?:clear|remove|hide|erase)\b/i.test(effectiveTask))diagnostic={reason:'Enable screen annotations in Settings → Annotations first.'};
        if(!diagnostic&&!useVisualCodex){
          try{state=await browser.waitUntilReady({timeoutMs:17000});}catch(e){return {error:'Could not load the ChatGPT session: '+e.message};}
          if(!state.signedIn)return {needsSignIn:state.stage==='auth',error:'ChatGPT is not ready: '+state.detail};
        }
      }finally{starting=false;sendUI('busy',{busy:false});}
      if(diagnostic){
        const user=store.addMessage(chatId,'user',text,'chatgpt');sendUI('message-added',{chatId,message:user});
        const notice=store.addMessage(chatId,'assistant',diagnostic.reason,'computer');sendUI('message-added',{chatId,message:notice});
        sendUI('chats-changed',store.publicState());return {local:true,preflight:true,detail:diagnostic.reason};
      }
      const runtime=capabilityStatus(controller.permissions(),{
        workingFolder:settings.workingFolder,firefoxConnected:Boolean(firefoxBridge?.status().connected)
      });
      starting=true;sendUI('busy',{busy:true});
      const user=store.addMessage(chatId,'user',text,'chatgpt');
      const answer=store.addMessage(chatId,'assistant','','chatgpt');
      sendUI('message-added',{chatId,message:user});sendUI('message-added',{chatId,message:answer});
      sendUI('chats-changed',store.publicState());
      activeTurn={engine:'web',speak:voice||settings.voiceAutoSpeak,chatId,messageId:answer.id};
      annotations.beginScope(answer.id,{speechExpected:voice===true||settings.voiceAutoSpeak===true});
      scene.beginScope(answer.id);visualLedger.begin(answer.id);captures.clear();
      if(useVisualCodex){
        const abortController=new AbortController();activeTurn.abortController=abortController;
        visualPlanner ||= new CodexVisualPlanner({home:path.join(app.getPath('userData'),'codex-home')});
        void visualPlanner.run({human:effectiveTask,allowed:workflowAllowed,profile:scene.settings.planner,model:settings.model,
          snapshot:{scene:scene.status(),drawings:annotations.status()},signal:abortController.signal,
          onText:reply=>{if(activeTurn?.messageId!==answer.id)return;store.updateMessage(chatId,answer.id,reply,{persist:false});sendUI('message-replace',{chatId,messageId:answer.id,text:reply});},
          onActivity:description=>sendUI('activity',{text:description}),
          execute:async(action,args,taskSignal)=>{
            if(taskSignal.aborted)throw Error('Cancelled');
            const verifiedCaptureId=args.captureId&&captures.isDelivered(args.captureId,answer.id)?args.captureId:undefined;
            const result=await controller.execute(action,args,{origin:'ai-chat',verifiedUserIntent:true,humanTask:effectiveTask,scopeId:answer.id,signal:taskSignal,verifiedCaptureId,deliverImage:action==='screen.capture'});
            if(result.cancelled){abortController.abort();throw Error('User denied action');}
            if(action==='screen.capture'&&result.ok&&result.result.attachmentPending){
              const image=captures.forDelivery(result.result.metadata.captureId,answer.id);
              return {...result,image:'data:image/png;base64,'+image.bytes.toString('base64'),delivered:()=>captures.markDelivered(image.metadata.captureId,answer.id,{accepted:true,imageCount:1})};
            }return result;
          }
        }).then(result=>{if(activeTurn?.messageId!==answer.id)return;if(!result.text.trim()){const reply=result.steps?'Visuals updated.':'No visual changes were made.';store.updateMessage(chatId,answer.id,reply);sendUI('message-replace',{chatId,messageId:answer.id,text:reply});}sendUI('activity',{text:'Visuals: '+result.model+' · '+result.effort+' · '+result.steps+' tool steps'});finishTurn();})
          .catch(error=>{if(activeTurn?.messageId===answer.id)finishTurn('Visuals: '+error.message);});
        starting=false;return {started:true,engine:'codex-visual',workflow:true};
      }
      // Multi-step cloud ChatGPT -> bounded, local tool loop. No Codex call.
      if(workflowAllowed.length){
        const abortController=new AbortController();activeTurn.abortController=abortController;
        let nextUrl=chat.webUrl,pendingImage=null;
        void executeToolLoop({human:effectiveTask,allowed:workflowAllowed,signal:abortController.signal,
          maxSteps:14,
          send:async(prompt,onPartial)=>{
            // Only the first turn needs the C.O.D.Y persona; tool results continue
            // in the same existing ChatGPT website conversation.
            const first=prompt.startsWith('C.O.D.Y tool protocol');
            const prepared=first?formatWebPrompt(prompt.replace('HUMAN MESSAGE:',`RUNTIME CAPABILITIES (from C.O.D.Y, not the human): ${runtime}\n\nHUMAN MESSAGE:`)+(scope.resumed?`\nCURRENT HUMAN FOLLOW-UP: ${scope.followUp}`:''),{newConversation:!nextUrl}):prompt;
            const image=pendingImage;pendingImage=null;
            const imageNote=image?'\n\nNATIVE SCREEN CAPTURE ATTACHED TO THIS MESSAGE: '+JSON.stringify(image.metadata)+'\nInspect the attached screenshot only if an image is actually visible. Use its captureId and capture-normalized coordinates for drawings only when its UI can be identified reliably; otherwise report that limitation. Prefer fresh Windows accessibility target IDs when available.':'';
            const out=await browser.send({text:prepared+imageNote,image,
              webModel:settings.webModel||'website',chatUrl:nextUrl,
              onUrl:url=>{nextUrl=url;store.setWebUrl(chatId,url);},
              onImageDelivered:(id,proof)=>captures.markDelivered(id,answer.id,proof),
              onText:onPartial,signal:abortController.signal});
            if(out.url){nextUrl=out.url;store.setWebUrl(chatId,out.url);}
            return out;
          },
          onText:partial=>{
            if(activeTurn?.messageId!==answer.id)return;
            store.updateMessage(chatId,answer.id,partial,{persist:false});
            sendUI('message-replace',{chatId,messageId:answer.id,text:partial});
          },
          onActivity:description=>sendUI('activity',{text:description}),
          execute:async(action,args)=>{
            if(abortController.signal.aborted)throw Error('Cancelled');
            const verifiedCaptureId=args.captureId&&captures.isDelivered(args.captureId,answer.id)?args.captureId:undefined;
            const result=await controller.execute(action,args,{origin:'ai-chat',verifiedUserIntent:true,signal:abortController.signal,humanTask:effectiveTask,scopeId:answer.id,verifiedCaptureId,deliverImage:action==='screen.capture'});
            if(result.cancelled)throw Error('User denied action');
            if(action==='screen.capture'&&result.ok&&result.result.attachmentPending)pendingImage=captures.forDelivery(result.result.metadata.captureId,answer.id);
            sendUI('activity',{text:'Executed '+action});
            return result;
          }
        }).then(result=>{
          if(activeTurn?.messageId!==answer.id)return;
          if(result.steps===0&&result.text.trim()){
            store.updateMessage(chatId,answer.id,result.text);
            sendUI('message-replace',{chatId,messageId:answer.id,text:result.text});
          }
          if(!result.text.trim()){
            store.updateMessage(chatId,answer.id,`Completed ${result.steps} tool step(s).`);
            sendUI('message-replace',{chatId,messageId:answer.id,text:`Completed ${result.steps} tool step(s).`});
          }
          finishTurn();
        }).catch(e=>finishTurn('Computer workflow: '+e.message));
        starting=false;
        return {started:true,engine:'web',workflow:true};
      }
      // Explicitly asynchronous: IPC responds after accepting the prompt; browser sampling
      // updates the existing CODY bubble as ChatGPT streams its answer.
      void browser.send({text:formatWebPrompt(actionContract.prompt,{newConversation:!chat.webUrl,runtime:actionContract.allowed.length?runtime:''}),webModel:settings.webModel||'website',chatUrl:chat.webUrl,
        onUrl:url=>store.setWebUrl(chatId,url),
        onText:reply=>{
          if(activeTurn?.messageId!==answer.id)return;
          const visible=stripToolDraft(stripTrailingActionDraft(reply,{enabled:actionContract.allowed.length>0}));
          store.updateMessage(chatId,answer.id,visible);sendUI('message-replace',{chatId,messageId:answer.id,text:visible});
        }
      }).then(async outcome=>{
        if(activeTurn?.messageId!==answer.id)return;
        const parsed=parseActionReply(outcome.text,{allowed:actionContract.allowed,humanMessage:effectiveTask});
        // A model may remember a tool protocol from an earlier conversation turn
        // even though the current user request authorised no tool workflow.
        // Never display or execute such a stray command: it is not a grant.
        const rogueTool=/CODY_TOOL_JSON:/.test(outcome.text);
        if(rogueTool){
          const cleaned=stripToolDraft(outcome.text);
          store.updateMessage(chatId,answer.id,cleaned);sendUI('message-replace',{chatId,messageId:answer.id,text:cleaned});
          const warning=store.addMessage(chatId,'assistant','The assistant requested a computer tool outside the approved workflow. No tool was executed. Please restate the action you want in this chat.','computer');
          sendUI('message-added',{chatId,message:warning});
          finishTurn();return;
        }
        if(parsed.action){
          // Safe and explicit one-way bridge: parser -> permission policy -> user
          // approval when sensitive -> Windows implementation. Never eval text.
          store.updateMessage(chatId,answer.id,parsed.visible);
          sendUI('message-replace',{chatId,messageId:answer.id,text:parsed.visible});
          try{
            const result=await controller.execute(parsed.action.action,parsed.action.args,{origin:'ai-chat',verifiedUserIntent:true,humanTask:effectiveTask});
            const info=completedActionSummary(parsed.action.action,parsed.action.args,result);
            const msg=store.addMessage(chatId,'assistant',info,'computer');
            sendUI('message-added',{chatId,message:msg});
            sendUI('activity',{text:`C.O.D.Y computer control: ${info.slice(0,150)}`});
          }catch(e){
            const msg=store.addMessage(chatId,'assistant','Computer action not performed: '+e.message,'computer');
            sendUI('message-added',{chatId,message:msg});
          }
        }else if(parsed.error && actionContract.allowed.length && (/CODY_ACTION_JSON:|```cody-action/.test(outcome.text))){
          const msg=store.addMessage(chatId,'assistant','Computer action was not executed: '+parsed.error,'computer');
          sendUI('message-added',{chatId,message:msg});
        }else if(actionContract.allowed.length && !parsed.action){
          // A friendly-sounding claim from the model is NOT an execution receipt.
          const msg=store.addMessage(chatId,'assistant','No Windows action was requested or executed in that reply.','computer');
          sendUI('message-added',{chatId,message:msg});
        }
        finishTurn();
      }).catch(e=>finishTurn('ChatGPT Web: '+e.message));
      starting=false;
      return {started:true,engine:'web'};
    }
    if(route.kind==='codex'&&mode==='agent'){
      if(!settings.workingFolder||!validateFolder(settings.workingFolder))throw Error('Choose a working folder in Settings before enabling Agent mode.');
      const fs=require('node:fs');if(!fs.existsSync(settings.workingFolder)||!fs.statSync(settings.workingFolder).isDirectory())throw Error('Working folder is unavailable');
    }
    if(settings.confirmExpensiveTasks&&route.kind==='codex'&&(mode==='agent'||isExpensive(text))){const r=await dialog.showMessageBox(win,{type:'question',buttons:['Continue with Codex','Cancel'],defaultId:1,cancelId:1,title:'Confirm AI usage',message:'Run this Codex request?',detail:mode==='agent'?'Agent mode may execute commands or change files inside the selected working folder. Approval prompts remain enabled.':'This request may require substantial cloud AI usage.'});if(r.response!==0)return {cancelled:true};}
    // Check quota before saving or sending any cloud request. Rate-limit reads do not invoke a model.
    // If the usage endpoint is unavailable, don't falsely mark the user's account as exhausted.
    if(route.kind==='codex'){
      try{
        await initCodex().start();
        const quota=inspectQuota(await codex.rateLimits());
        sendUI('quota',quota);
        if(quota.blocked)return {blocked:true,error:quotaMessage(quota),quota};
      }catch(e){sendUI('diagnostic','Unable to check account quota: '+e.message);}
    }
    // These two exact-match utilities never call an AI model.
    const user=store.addMessage(chatId,'user',text,mode);sendUI('message-added',{chatId,message:user});
    if(route.kind==='local'){
      let reply;
      if(route.action==='timer'){reply=desktopTimer.execute(route.timer,chatId);if(['start','cancel'].includes(route.timer.action)){clearTimeout(quickCardExpiry);quickCard=null;sendUI('island-card',null);refreshIslandCards();}}
      else if(route.action==='maths'){reply=route.maths.text;showQuickCard({text:reply});}
      else if(route.action==='weather'){
        starting=true;sendUI('busy',{busy:true});
        try{const result=await weather.current(route.weather.location);reply=result.reply;showQuickCard(result.card);}
        catch(error){reply=error.name==='TimeoutError'||error.name==='AbortError'?'The weather lookup timed out. Please try again.':error.message||'Weather is unavailable. Please try again.';showQuickCard({kind:'weather',text:'Unavailable',detail:'Weather',icon:'cloud-off',tooltip:reply});}
      }
      else if(route.action==='spotify-status'){const media=spotify.snapshot();reply=media.available?`${media.playing?'Playing':'Paused'}: ${media.title||'Spotify'}${media.artist?' — '+media.artist:''}.`:'Open Spotify and play a track so I can see what is playing.';}
      else{const now=new Date();reply=localAnswer(route.action,now);showQuickCard(localCard(route.action,now));}
      const msg=store.addMessage(chatId,'assistant',reply,'local');sendUI('message-added',{chatId,message:msg});if(route.action==='weather'){starting=false;sendUI('busy',{busy:false});}sendUI('chats-changed',store.publicState());return {local:true};
    }
    starting=true;sendUI('busy',{busy:true});sendUI('chats-changed',store.publicState());
    let answer;
    try{
      await initCodex().start();const account=await codex.account();if(account?.account?.type!=='chatgpt')throw Error('Please sign in with your ChatGPT account first (Settings → Account).');
      if(!chat.threadId){const threadId=await codex.newThread({model:settings.model||undefined,cwd:mode==='agent'?settings.workingFolder:undefined});if(!threadId)throw Error('Codex did not create a thread');store.setThread(chatId,threadId);}else await codex.resume(chat.threadId);
      answer=store.addMessage(chatId,'assistant','',mode);activeTurn={engine:'agent',chatId,messageId:answer.id,threadId:chat.threadId,turnId:null};activeAgentMessage=false;sendUI('message-added',{chatId,message:answer});
      const t=await codex.turn({threadId:chat.threadId,text,mode:route.mode,effort:settings.defaultReasoning,model:settings.model||undefined,cwd:mode==='agent'?settings.workingFolder:undefined});if(activeTurn)activeTurn.turnId=t.turn?.id||null;
      return {started:true};
    }catch(e){if(activeTurn)finishTurn(e.message);else{const msg=store.addMessage(chatId,'assistant','Could not connect: '+e.message,'system');sendUI('message-added',{chatId,message:msg});sendUI('busy',{busy:false});}return {error:e.message};}
    finally{starting=false;}
  };
  ipcMain.handle('send-message',(_,value)=>sendProviderMessage(value));
  cancelProviderTurn=async()=>{annotations?.clearImmediate('task cancelled');scene?.cancelAnimations();visualLedger?.begin('gui');captures?.clear();if(activeTurn?.engine==='codex-bridge'){activeTurn.abortController.abort();return true;}if(activeTurn?.engine==='web'){activeTurn.abortController?.abort();return initWebBrowser().stop();}if(!activeTurn?.turnId)return false;await codex.interrupt(activeTurn.threadId,activeTurn.turnId);return true;};
  ipcMain.handle('stop-turn',()=>cancelProviderTurn());
}
function showMain(){if(!win||win.isDestroyed())createWindow();island.show();}
function quitCompletely(){quitting=true;void webBrowser?.quit();app.quit();}
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
else app.whenReady().then(()=>{
  nativeTheme.themeSource='dark';app.setAppUserModelId(branding.appId);
  store=new StateStore(app.getPath('userData'));
  updates=new UpdateService({version:app.getVersion(),packaged:app.isPackaged,
    createUpdater:()=>require('electron-updater').autoUpdater,
    enabled:store.data.settings.checkForUpdates!==false,
    saveEnabled:value=>{store.data.settings.checkForUpdates=value;store.save();},
    installBlocked:()=>Boolean(activeTurn||starting||screenCapture?.active||nativeTasks.activeCount||['Listening','Processing','Responding'].includes(nativeEngine.status?.state))});
  registerUpdateIpc({ipcMain,updates,getWindow:()=>win,shell});
  updates.on('change',state=>sendUI('updates-state',state));updates.start();
  store.settings(providerPatch(agentSelection(store.data.settings).provider));
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
  annotations=new AnnotationManager({overlay:new AnnotationOverlay({BrowserWindow,ipcMain,screen}),screen,captures,settings:store.data.settings.annotations,refreshTarget:(reference,cache)=>controller.refreshAnnotationTarget(reference,cache)});
  scene=new SceneManager({adapter:new SceneWindow({BrowserWindow,ipcMain}),screen,assets:new AssetRegistry(),settings:store.data.settings.visuals});
  visualLedger=new VisualLedger();
  scene.on('diagnostic',message=>sendUI('diagnostic','3D visuals: '+message));
  annotations.on('diagnostic',message=>sendUI('diagnostic','Annotations: '+message));
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
  controller=new ComputerController({
    readPermissions:()=>store.data.settings.computerControl,
    writePermissions:settings=>{store.settings({computerControl:settings});if(nativeEngine.connected&&(store.data.settings.nativePermissions?.enabled!==settings.enabled||store.data.settings.nativePermissions?.level!==settings.level))void nativeEngine.request("permissions-configure",{enabled:settings.enabled,level:settings.level}).catch(error=>sendUI("diagnostic",error.message));},
    getWorkingFolder:()=>store.data.settings.workingFolder,
    clipboard,desktopCapturer,browserBridge:firefoxBridge,spotify,annotations,scene,captures,visualLedger,
    logAction:event=>{backendCapabilities.observe(event);const fs=require('node:fs');const file=path.join(app.getPath('userData'),'control-audit.jsonl');try{fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n',{encoding:'utf8'});}catch{}},
    confirm:async({action,summary})=>{
      const id='local-'+require('node:crypto').randomUUID();
      return new Promise(resolve=>{pendingApprovals.set(id,{id,resolve});sendUI('approval',{id,reason:`Allow C.O.D.Y to perform ${action}?`,command:summary});island.show();});
    }
  });
  heyclicky=new HeyClickyAdapter();codexAgent=new CodexAgent();
  try{memory=new MemoryService({directory:path.join(app.getPath('userData'),'memory'),cipher:safeStorage});}catch(error){memoryError=error.message;}
  void heyclicky.refresh();
  registerIpc();
  controller.plezy={play:title=>nativeEngine.request('plezy-play',{title})};
  controller.proofread=async target=>{if(!target)target=(await nativeEngine.request('text-capture',{clientPid:process.pid})).target;if(!target)throw Error('Click the text box, then hold your voice shortcut and say “spell check this”. The box must expose editable text.');return nativeEngine.request('proofread',{target});};
  controller.nativeAudio={set:level=>nativeEngine.request("audio-set",{level}),mute:muted=>nativeEngine.request("audio-mute",{muted})};
  rps=new RockPaperScissors();rps.on("change",state=>{sendUI("rps-state",state);refreshIslandCards();});
  screenCapture=new ScreenCapture({BrowserWindow,ipcMain,desktopCapturer,screen,clipboard,nativeImage,shell,pictures:path.join(app.getPath('pictures'),'C.O.D.Y'),videos:path.join(app.getPath('videos'),'C.O.D.Y')});
  let lastSavedCapture=null;screenCapture.on('change',state=>{sendUI('capture-state',state);refreshIslandCards();if(state.status==='starting')island.collapse();if(state.status==='saved'&&state.savedPath!==lastSavedCapture){lastSavedCapture=state.savedPath;showQuickCard({kind:'utility',text:'Recording saved',detail:'Click to open',icon:'camera',captureKind:'recording'});}if(state.status==='error')showQuickCard({kind:'utility',text:'Recording error',detail:state.error,icon:'circle-alert'});});
  monitors=new IslandMonitors({settingsFile:path.join(app.getPath('userData'),'island-monitors.json'),weather,readDesktopFrames:()=>nativeEngine.request('desktop-frames'),fetcher:(url,options)=>require('electron').net.fetch(url,options)});
  let lastMonitorActive=false;monitors.on('change',state=>{sendUI('monitor-state',state);refreshIslandCards();if(state.active&&!lastMonitorActive)island.showCompact();lastMonitorActive=state.active;});
  const islandUtilities=new IslandUtilities({tasks:{open:()=>{island.show();sendUI("tasks-open");}},monitors,capture:screenCapture,rps,weather,timer:desktopTimer,spotify,controller,showCompact:()=>{island.showCompact();if(win?.isVisible())win.moveTop();},showCard:showQuickCard,clearCard:clearQuickCard,refreshMedia:refreshIslandCards,audioState:()=>nativeEngine.request("audio-state")});
  attachments=new Attachments({store,onChange:state=>sendUI('attachments-state',state),thumbnail:async file=>{const image=await nativeImage.createThumbnailFromPath(file,{width:64,height:64});return image.isEmpty()?null:image.toDataURL();}});
  const nativeBindings=installNativeIpc({
    localMemoryOnly,saveLocalMemory:text=>{
      if(!memory)throw Error(memoryError||'Local memory is unavailable.');
      return memory.saveLocal(text);
    },onMemoryModeChange:localOnly=>{
      if(!localOnly)return;
      for(const chat of store.data.chats)delete chat.codexBridgeThreadId;
      store.save();
    },
    isMicrophoneMuted:()=>island.preferences().microphoneMuted===true,ipcMain,engine:nativeEngine,store,sendUI,controller,submitExternal:value=>sendProviderMessage(value),cancelExternal:()=>cancelProviderTurn(),externalBusy:()=>Boolean(activeTurn||starting),codexUsage:()=>readCodexUsage(usageClient??=new CodexClient({accountOnly:true})),connectProvider:async provider=>{if(provider==='codex'){await codexAgent.client.start();const info=await codexAgent.client.account();if(info.account?.type!=='chatgpt'){const login=await codexAgent.client.login();if(login.authUrl)await shell.openExternal(login.authUrl);return {message:'Finish ChatGPT sign-in in your browser, then choose Connect again.'};}exactCodexModel(await codexAgent.client.models());return {message:'ChatGPT Codex connected · GPT 6.1 Sol · Medium'};}if(provider==='chatgpt'){await initWebBrowser().show();return {message:'Sign in to ChatGPT. GPT 6.1 Sol and Medium are verified before sending.'};}return {message:'Claude uses your existing connection.'};},chooseWorkingFolder:async()=>{const result=await dialog.showOpenDialog(win,{properties:["openDirectory","createDirectory"],title:"Choose the background task workspace"});return result.canceled?null:result.filePaths[0];},getState,getWindow:()=>win,utilities:islandUtilities,rps,capture:screenCapture,attachments,onTasks:value=>{nativeTasks=value;refreshIslandCards();},captureTextEnabled:()=>{const permissions=controller.permissions();return permissions.enabled&&permissions.keyboardMouse&&permissions.uiAutomation;},chooseFiles:async()=>{const result=await dialog.showOpenDialog(win,{title:"Attach files to C.O.D.Y.",properties:["openFile","multiSelections"]});return result.canceled?[]:result.filePaths;},showFiles:()=>island.show(),fileDragging:value=>island.setFileDragActive(value),showApprovals:()=>island.show(),cancelLocalApprovals:()=>{for(const [id,request]of pendingApprovals){if(request.resolve){pendingApprovals.delete(id);request.resolve(false);sendUI('approval-resolved',id);}}}});
  if(!store.data.settings.nativeHeyClickyGui){store.data.settings.nativeHeyClickyGui=true;store.settings({voiceAutoSpeak:true,assistantProvider:"heyclicky"});}
  setPersonalCodexEnabled(store.data.settings.assistantProvider==='codex');
  createWindow();createTray();
  controlOverlay=new ControlOverlay({BrowserWindow,screen,engine:nativeEngine,getAccent:()=>island.preferences().accentColor,getCursorColor:()=>island.preferences().cursorColor,getCursorOptions:()=>island.preferences(),getIslandWindow:()=>island.window(),getDockPoint:()=>{const bounds=island.window()?.getBounds();return bounds?{x:bounds.x+bounds.width/2,y:bounds.y+16}:null;}});
  controlOverlay.on('diagnostic',message=>sendUI('diagnostic',message));
  const syncCursorPreferences=()=>{controlOverlay.preferencesChanged();const prefs=island.preferences();void nativeEngine.request('configure',{screenHighlight:prefs.screenHighlight,cursorColor:controlOverlay.cursorColor(),cursorSize:prefs.cursorSize,systemInput:prefs.controlInputMode==='system'}).catch(error=>sendUI('diagnostic',error.message));};
  let dictationActive=false,sessionLocked=false;
  nativeEngine.on('meter',value=>{dictationActive=value.dictationActive===true;});
  wakeListener=new KeywordWakeListener({launch:phrases=>{const layout=require('./native-layout').nativeLayout({packaged:app.isPackaged,resourcesPath:process.resourcesPath,userData:app.getPath('userData')});return {command:layout.executable,args:['--cody-wake','--phrases',phrases.join('|')],options:{cwd:layout.directory,env:layout.environment}};},canCapture:()=>sessionLocked?'Paused while this PC is locked.':!nativeEngine.connected?'Waiting for C.O.D.Y. to connect.':dictationActive?'Paused during dictation.':nativeBindings.gameVoice?.running?'Paused during voice games.':null,canListen:()=>sessionLocked?'Paused while this PC is locked.':!nativeEngine.connected?'Waiting for C.O.D.Y. to connect.':dictationActive?'Paused during dictation.':nativeBindings.gameVoice?.running?'Paused during voice games.':['Listening','Processing','Responding'].includes(nativeEngine.status.state)||nativeBindings.isBusy()?'Paused while C.O.D.Y. is busy.':null,
    beginVoice:options=>nativeBindings.beginVoice(options),endVoice:()=>nativeBindings.endWakeVoice(),cancelVoice:()=>nativeBindings.cancelWakeVoice(),onWake:()=>nativeEngine.request('wake-cue')});
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
  if(process.argv.includes("--verify-local-visuals"))void require("../../../tools/verify-local-visuals.cjs")({win,island,annotations,scene,engine:nativeEngine});
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
  void nativeEngine.start().then(async()=>{await nativeEngine.request('microphone-mute',{muted:island.preferences().microphoneMuted===true});const status=await nativeEngine.refresh();await nativeEngine.request('text-client',{clientPid:process.pid});nativeLinksReady=true;void deliverNativeLinks();controlOverlay.update(await nativeEngine.request('drive-state'));return status;}).then(status=>sendUI("status",{connected:true,detail:status.signedIn?"HeyClicky connected":"HeyClicky sign-in required"})).catch(error=>sendUI("diagnostic",error.message));
  try{desktopTimer.restore();refreshIslandCards();}catch(error){sendUI('diagnostic','Could not restore timer: '+error.message);}
  stopPushToTalk=startPushToTalk(value=>island.handleHotkey(value));
  // Warm the ChatGPT browser in the background. No model calls are made here.
  // Browser window stays hidden unless sign-in or troubleshooting is requested.
  // This build always sends assistant turns to the native HeyClicky engine.
  app.on('activate',showMain);
});
app.on('second-instance',(_event,args)=>{pendingNativeLinks.push(...linksFromArgs(args));void deliverNativeLinks();if(singleInstance&&!args.includes('--background'))showMain();});
app.on('before-quit',event=>{if(screenCapture?.active&&!captureQuitReady){event.preventDefault();if(!captureQuitPending){captureQuitPending=true;void screenCapture.execute('stop').catch(error=>console.error(error)).finally(()=>{captureQuitReady=true;app.quit();});}return;}updates?.close();trayMenu?.close();wakeListener?.close();controlOverlay?.close();nativeEngine.close();monitors?.close();quitting=true;usageClient?.close();memory?.close();codexAgent?.close();annotations?.close();scene?.close();captures?.clear();clearTimeout(quickCardExpiry);timerAlarm.stop();spotify?.close();desktopTimer?.close();stopPushToTalk();island.stop();speech?.cancel();for(const request of pendingApprovals.values()){try{if(request.resolve)request.resolve(false);else codex?.respond(request.id,'decline');}catch{}}codex?.close();visualPlanner?.close();void webBrowser?.quit();void firefoxBridge?.close();});
app.on('window-all-closed',()=>{if(quitting&&process.platform!=='darwin')app.quit();});
