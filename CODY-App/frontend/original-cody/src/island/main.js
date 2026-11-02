'use strict';
const { app, BrowserWindow, ipcMain, Menu, screen, shell, session, globalShortcut, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const branding=require('../branding');
const {shouldRecoverPointer}=require('./pointer-open');
const mascotLooks=require('./renderer/mascot-looks');
const { spawn, execFile } = require('node:child_process');
const preferenceListeners=new Set();
let fileDragActive=false;
let mascotSleeping=false,wakeClickUntil=0;
let captureUIActive=false,captureUIGraceUntil=0;
let taskDetailExpanded=false;
let chatExpanded=false;
const captureUIBusy=()=>captureUIActive||Date.now()<captureUIGraceUntil;

const SIZES = Object.freeze({
  small: { width: 192, height: 30, icon: 25 },
  medium: { width: 216, height: 32, icon: 27 },
  large: { width: 244, height: 36, icon: 30 }
});
const PANEL_WIDTH = 940;
const PANEL_HEIGHT = 750;
const CHAT_WIDTH = 520;
const CHAT_HEIGHT = 352;
const TASKS_WIDTH = CHAT_WIDTH;
const TASKS_HEIGHT = 420;
const SETTINGS_WIDTH = 900;
const SETTINGS_HEIGHT = 716;
const DEFAULTS = Object.freeze({
  schemaVersion: 7,
  accentColor: '#9D9DFF',
  mascotLook: 'blue',
  cursorColor: 'accent',
  controlInputMode: 'system',
  hideFloatingCursor: false, screenHighlight: true, shakeToDetach: true,
  wakeWordEnabled: false, wakeHeyCody: true, wakeOkayCody: true, wakeCody: true,
  voiceId: '',
  voiceRate: 1, voicePitch: 1, voiceVolume: 1,
  micDeviceId: '', micSensitivity: 1,
  visibility: 'always', // always | activity | hover
  islandSize: 'medium',
  idleReactions: 'subtle', // off | subtle | playful
  cursorTracking: true,
  blinkEnabled: true,
  reactiveExpressions: true,
  funReactions: true,
  sunglassesEnabled: true,
  pretendSleepEnabled: true,
  wifiReactions: true,
  animationSpeed: 'normal', // slow | normal | fast | off
  revealStyle: 'liquid', // liquid | simple | none
  enableHotkey: true,
  hotkeyMode: 'hold', // Ctrl+Alt is strictly push-to-talk
  startListeningOnHotkey: true,
  activityHideDelay: 1600,
  launchAtLogin: false
});
let settings = { ...DEFAULTS };
let islandWindow = null;
let settingsWindow = null;
let state = 'idle';
let suspended = false;
let expanded = false;
let currentPanelView = 'chat';
let timerVisible=false;
let gameActive=false;
let recordingActive=false,wakeListeningActive=false;
let chatShortcutRegistered=false;
let forcedVisible = false;
let hoverVisible = false;
let hotkeyProcess = null;
let hotkeyBuffer = '';
let cursorTimer = null;
let visibilityTimer = null;
let hideTimer = null;
let concealFallback = null;
let hotkeyHeld = false;
let lastHover = 0;
let lastPointer = null;
let lastPointerTime = performance.now();
let isQuitting = false;
let mouseIgnored = null;
let pickerOpen = false;
let wifiDisconnected = false;
let wifiKnown = false;
let wifiCheckInProgress = false;
let wifiCheckTimer = null;
let pendingWifiRestore = false;
let wifiRestoreTimer = null;

function preferencesFile() { return path.join(app.getPath('userData'), 'island-settings.json'); }
function validateSettings(patch, old = settings) {
  const next = { ...old };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS) || key === 'schemaVersion' || typeof value !== typeof DEFAULTS[key]) continue;
    next[key] = value;
  }
  if (!['always','activity','hover'].includes(next.visibility)) next.visibility = 'always';
  if (!(next.islandSize in SIZES)) next.islandSize = 'medium';
  if (!['off','subtle','playful'].includes(next.idleReactions)) next.idleReactions = 'subtle';
  if (!['slow','normal','fast','off'].includes(next.animationSpeed)) next.animationSpeed = 'normal';
  if (!['liquid','simple','none'].includes(next.revealStyle)) next.revealStyle = 'liquid';
  next.hotkeyMode = 'hold'; // previous toggle settings must never override push-to-talk
  next.activityHideDelay = Math.max(0, Math.min(10000, next.activityHideDelay));
  if (!Object.values(mascotLooks).some(look=>look.color===next.accentColor)) next.accentColor = '#9D9DFF';
  if(!['system','independent'].includes(next.controlInputMode))next.controlInputMode='system';
  if(!Object.hasOwn(mascotLooks,next.mascotLook))next.mascotLook='blue';
  if(next.cursorColor!=='accent'&&!Object.values(mascotLooks).some(look=>look.color===next.cursorColor))next.cursorColor='accent';
  next.voiceRate = Number.isFinite(next.voiceRate)?Math.min(1.4,Math.max(.7,next.voiceRate)):1;
  next.voicePitch = Number.isFinite(next.voicePitch)?Math.min(1.2,Math.max(.8,next.voicePitch)):1;
  next.voiceVolume = Number.isFinite(next.voiceVolume)?Math.min(1,Math.max(0,next.voiceVolume)):1;
  next.micSensitivity = Number.isFinite(next.micSensitivity)?Math.min(2,Math.max(.5,next.micSensitivity)):1;
  next.voiceId = String(next.voiceId).slice(0,250);
  next.micDeviceId = String(next.micDeviceId).slice(0,250);
  next.schemaVersion = 7;
  return next;
}
function readSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(preferencesFile(),'utf8'));
    settings = validateSettings(stored, DEFAULTS);
    // v1.3 migrates previous settings without discarding users' visibility or size choices.
    if (stored.schemaVersion !== 7 || stored.hotkeyMode !== 'hold') {
      console.log('[C.O.D.Y.] Settings upgraded to v1.8.0.');
      saveSettings();
    }
  } catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(preferencesFile()), { recursive:true });
  fs.writeFileSync(preferencesFile(),JSON.stringify(settings,null,2));
}
function emit(channel, value) {
  if (islandWindow && !islandWindow.isDestroyed()) islandWindow.webContents.send(channel, value);
}
function windowBounds() {
  // Consistent primary-display attachment; cursor movement must not teleport the island.
  const bounds = screen.getPrimaryDisplay().bounds;
  // Transparent host stays the same size in BOTH modes; only the SVG/CSS morphs.
  // Repositioning a native transparent window while it animates caused flashing.
  const width = Math.min(PANEL_WIDTH,bounds.width);
  const height = Math.min(PANEL_HEIGHT,bounds.height);
  return { x: Math.round(bounds.x + (bounds.width - width) / 2), y: bounds.y, width, height };
}
function positionWindow() {
  if (islandWindow && !islandWindow.isDestroyed()) islandWindow.setBounds(windowBounds());
}
function isActive() { return state !== 'idle'; }
function shouldShow() {
  return !suspended && (fileDragActive || wakeListeningActive || recordingActive || gameActive || timerVisible || settings.visibility === 'always' || isActive() || expanded || forcedVisible || hoverVisible);
}
function hideWindowNow() {
  if (!islandWindow || islandWindow.isDestroyed() || shouldShow()) return;
  islandWindow.hide();
  islandWindow.setIgnoreMouseEvents(true,{forward:true});
  mouseIgnored = true;
  if (concealFallback) { clearTimeout(concealFallback); concealFallback = null; }
}
function updateVisibility() {
  if(captureUIBusy())return;
  if (!islandWindow || islandWindow.isDestroyed() || isQuitting) return;
  if (shouldShow()) {
    if (concealFallback) { clearTimeout(concealFallback); concealFallback = null; }
    if (islandWindow.isMinimized() || !islandWindow.isVisible()) { positionWindow(); islandWindow.showInactive(); }
    emit('island:visibility', true);
  } else if (islandWindow.isVisible()) {
    emit('island:visibility', false);
    if (!concealFallback) concealFallback = setTimeout(() => {
      concealFallback = null;
      hideWindowNow();
    }, settings.revealStyle === 'none' ? 50 : 700);
  }
}
function recoverVisibility() {
  if(isQuitting||!islandWindow||islandWindow.isDestroyed()||!shouldShow())return;
  // Windows owns the screen while selecting a snip. Do not fight its overlay.
  if(captureUIBusy())return;
  // Another topmost app can cover us even while isAlwaysOnTop() stays true.
  // Reassert stacking without activating the Island or taking keyboard focus.
  if(!islandWindow.isAlwaysOnTop())islandWindow.setAlwaysOnTop(true,'screen-saver');
  islandWindow.moveTop();
  const expected=windowBounds(),actual=islandWindow.getBounds();
  if(Object.keys(expected).some(key=>expected[key]!==actual[key]))positionWindow();
  // Never focus the overlay while the user is typing in another application.
  updateVisibility();
}
function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { forcedVisible = false; updateVisibility(); }, settings.activityHideDelay);
}
function setIslandState(next) {
  if (!['idle','listening','thinking','speaking','error','offline','restored'].includes(next)) return;
  if (next === 'idle' && wifiDisconnected && settings.wifiReactions) next = 'offline';
  else if (next === 'idle' && pendingWifiRestore && settings.wifiReactions) {
    next = 'restored';
    pendingWifiRestore = false;
  }
  if (next === 'restored' && (!settings.wifiReactions || wifiDisconnected)) next = wifiDisconnected ? 'offline' : 'idle';
  if (wifiRestoreTimer) { clearTimeout(wifiRestoreTimer); wifiRestoreTimer = null; }
  // Don't interrupt a speech/listening state: queued Wi-Fi recovery plays on idle.
  if (next === 'restored') {
    wifiRestoreTimer = setTimeout(() => { wifiRestoreTimer=null; if (state === 'restored') setIslandState('idle'); }, 1950);
  }
  if (state !== next) {
    state = next;
    emit('island:state', state);
  }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (isActive()) forcedVisible = true;
  else if (!expanded) scheduleHide();
  updateVisibility();
}
function setExpanded(next) {
  const desired=Boolean(next);
  if(!desired)pickerOpen=false;
  if(desired===expanded)return;
  expanded=desired;
  if(expanded){
    forcedVisible=true;
    if(hideTimer)clearTimeout(hideTimer);
    // Host bounds are constant; CSS alone expands the continuous shape.
    emit('island:expanded',true);
    updateVisibility();
    islandWindow?.focus();
  }else{
    emit('island:expanded',false);
    if(!isActive())scheduleHide();
    updateVisibility();
  }
}
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show(); settingsWindow.focus(); return;
  }
  settingsWindow = new BrowserWindow({
    width: 724, height: 790, minWidth: 570, minHeight: 600,
    backgroundColor: '#101014', title: 'C.O.D.Y • Developer settings', icon:branding.icon, autoHideMenuBar:true,
    webPreferences: { preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true }
  });
  void settingsWindow.loadFile(path.join(__dirname,'renderer','settings.html'));
  settingsWindow.on('closed',()=>{ settingsWindow = null; });
}
function openPreview() {
  openSettings();
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  const showStudio = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('island:open-animation-preview');
    }
  };
  if (settingsWindow.webContents.isLoadingMainFrame()) settingsWindow.webContents.once('did-finish-load', showStudio);
  else showStudio();
}
function showContextMenu() {
  Menu.buildFromTemplate([
    ...(gameActive?[{label:'Play rock paper scissors again',click:()=>emit('island:game-command','voice')},{label:'End rock paper scissors',click:()=>emit('island:game-command','close')},{type:'separator'}]:[]),
    { label:'Start listening', click:()=>emit('island:command','start') },
    { label:'Stop listening', click:()=>emit('island:command','stop') },
    { label:'Open quick panel', click:()=>setExpanded(true) },
    { label:'Settings', click:()=>{setExpanded(true);emit('island:show-settings');} },
    { label:'Developer settings', click:openSettings },
    { label:'Test all animations', click:openPreview },
    { type:'separator' },
    { label:'Quit C.O.D.Y. Island', click:()=>app.quit() }
  ]).popup({window:islandWindow});
}
function pollCursor(clickedPoint=null) {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const point = clickedPoint||screen.getCursorScreenPoint();
  const bounds = islandWindow.getBounds();
  const size=SIZES[settings.islandSize];
  const left = (bounds.width-size.width)/2;
  const nearIsland = point.x >= bounds.x + left && point.x < bounds.x + left+size.width && point.y >= bounds.y && point.y < bounds.y + size.height;
  // All visible expanded content remains interactive; outside is click-through.
  const wide=['settings','history'].includes(currentPanelView)||currentPanelView==='tasks'&&taskDetailExpanded||currentPanelView==='chat'&&chatExpanded;
  const width = Math.min(wide?SETTINGS_WIDTH:currentPanelView==='tasks'?TASKS_WIDTH:CHAT_WIDTH,bounds.width);
  const height = Math.min(wide?SETTINGS_HEIGHT:currentPanelView==='tasks'?TASKS_HEIGHT:CHAT_HEIGHT,bounds.height);
  const panelX = bounds.x+(bounds.width-width)/2;
  // Leave transparent shoulders click-through; avoid swallowing clicks on other applications.
  const onPanel = expanded && point.x>=panelX+28 && point.x<panelX+width-28 && point.y>=bounds.y+18 && point.y<bounds.y+height-10;
  const y = point.y-bounds.y;
  const centerX = bounds.x + left + size.width/2;
  const dist = Math.hypot(point.x-centerX, point.y-(bounds.y+size.height/2));
  // Match the top-attached notch silhouette instead of blocking mouse input through its transparent shoulders.
  const inset = y < 8 ? Math.max(0,y)*1.8 : y < 24 ? 14.4+(y-8)*.8 : 27.2+(y-24)*1.7;
  const silhouetteHit = nearIsland && Math.abs(point.x-centerX) < (size.width/2-inset);
  if(clickedPoint&&shouldRecoverPointer({visible:islandWindow.isVisible(),expanded,hit:silhouetteHit,sleeping:mascotSleeping,wakeUntil:wakeClickUntil,now:Date.now(),button:clickedPoint.button||'left'})){
    mascotSleeping=false;wakeClickUntil=0;setExpanded(true);emit('island:command','pointer-open');
  }
  if(clickedPoint&&expanded&&!captureUIBusy()&&!pickerOpen&&!onPanel&&!silhouetteHit)setExpanded(false);
  const ignoreMouse = !(islandWindow.isVisible() && (pickerOpen || silhouetteHit || onPanel));
  if (ignoreMouse !== mouseIgnored) {
    islandWindow.setIgnoreMouseEvents(ignoreMouse,{forward:true});
    mouseIgnored = ignoreMouse;
  }
  const now = performance.now();
  const dt = Math.max(20, now-lastPointerTime);
  const speed = lastPointer ? Math.hypot(point.x-lastPointer.x,point.y-lastPointer.y)*1000/dt : 0;
  lastPointer = point;
  lastPointerTime = now;
  if (islandWindow.isVisible()) {
    emit('island:cursor', {
      x: Math.max(-1,Math.min(1,(point.x-centerX)/240)),
      y: Math.max(-1,Math.min(1,(point.y-bounds.y-size.height/2)/160)),
      speed: Math.min(2000,speed),
      near: dist < 130,
      hovered: silhouetteHit
    });
  }
  if (settings.visibility === 'hover' && !isActive() && !expanded && !forcedVisible) {
    const display = screen.getPrimaryDisplay().bounds;
    const hoverHotspot = point.y >= display.y && point.y <= display.y+22 && Math.abs(point.x-(display.x+display.width/2)) < size.width/2+18;
    if (hoverHotspot) { lastHover = Date.now(); if (!hoverVisible) {hoverVisible=true; updateVisibility();} }
    else if (hoverVisible && Date.now()-lastHover>850) {hoverVisible=false; updateVisibility();}
  } else if (hoverVisible && settings.visibility !== 'hover') { hoverVisible=false; updateVisibility(); }
}
function onModifierEvent(event) {
  // Even if the shortcut was disabled while held, release must always stop capture.
  if (event === 'DOWN') {
    if (!settings.enableHotkey || hotkeyHeld) return;
    hotkeyHeld = true;
    forcedVisible = true;
    updateVisibility();
    if (!settings.startListeningOnHotkey) { setExpanded(!expanded); return; }
    emit('island:hotkey','down');
  } else if (event === 'UP') {
    if (!hotkeyHeld) return;
    hotkeyHeld=false;
    if (settings.startListeningOnHotkey) emit('island:hotkey','up');
    if (!isActive() && !expanded) scheduleHide();
  }
}
function createIsland() {
  islandWindow = new BrowserWindow({
    title:branding.name,icon:branding.icon,
    width:Math.min(PANEL_WIDTH,screen.getPrimaryDisplay().bounds.width),height:Math.min(PANEL_HEIGHT,screen.getPrimaryDisplay().bounds.height),
    frame:false,transparent:true,backgroundColor:'#00000000',
    resizable:false,movable:false,maximizable:false,minimizable:false,
    hasShadow:false,skipTaskbar:true,alwaysOnTop:true,autoHideMenuBar:true,show:false,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,webgl:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}
  });
  islandWindow.setAlwaysOnTop(true,'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  islandWindow.webContents.on('did-fail-load',(_event,code,reason,url)=>console.error('[C.O.D.Y.] Load error:',code,reason,url));
  islandWindow.webContents.on('render-process-gone',(_event,info)=>{
    console.error('[C.O.D.Y.] Renderer exited:',info.reason);
    if(!isQuitting)setTimeout(()=>{if(!isQuitting&&islandWindow&&!islandWindow.isDestroyed())islandWindow.webContents.reload();},1000);
  });
  void islandWindow.loadFile(path.join(__dirname,'renderer','index.html')).catch(console.error);
  islandWindow.webContents.on('did-finish-load',()=>{
    emit('island:settings',settings);emit('island:state',state);emit('island:expanded',expanded);
    updateVisibility();
    console.log('[C.O.D.Y.] v1.8.0 adaptive chat and settings loaded.');
  });
  islandWindow.on('closed',()=>{islandWindow=null;if(cursorTimer){clearInterval(cursorTimer);cursorTimer=null;}});
  islandWindow.on('blur',()=>{
    if (!expanded || gameActive || fileDragActive || captureUIBusy()) return;
    setTimeout(()=>{ if(!captureUIBusy()&&!gameActive&&!fileDragActive&&islandWindow&&!islandWindow.isDestroyed()&&!islandWindow.isFocused()) setExpanded(false); },220);
  });
  // Screen snipping and desktop transitions can hide a native overlay without
  // changing our visibility preference. Restore it without taking keyboard focus.
  islandWindow.on('hide',()=>{
    setTimeout(()=>{
      if(isQuitting||!islandWindow||islandWindow.isDestroyed()||!shouldShow())return;
      if(captureUIBusy())return;
      islandWindow.setAlwaysOnTop(true,'screen-saver');
      updateVisibility();
    },300);
  });
  islandWindow.on('minimize',()=>{setExpanded(false);setTimeout(recoverVisibility,100);});
  islandWindow.webContents.on('before-input-event',(event,input)=>{
    if(input.control&&input.alt&&!input.shift&&!input.meta&&input.code==='KeyC'){
      event.preventDefault();
      if(!chatShortcutRegistered&&input.type==='keyDown'&&!input.isAutoRepeat)handleHotkey('chat');
    }
  });
  islandWindow.webContents.on('context-menu',showContextMenu);
  positionWindow();
  if (process.argv.includes('--debug-island')) islandWindow.webContents.openDevTools({mode:'detach'});
  cursorTimer=setInterval(pollCursor,52);
}
function setupIpc() {
  const authorize=event=>{
    const sender=event.sender;
    if(![islandWindow?.webContents,settingsWindow?.webContents].includes(sender)||event.senderFrame!==sender.mainFrame)throw Error('Island commands require a trusted C.O.D.Y. window');
  };
  const handle=(name,callback)=>ipcMain.handle(name,(event,...args)=>{authorize(event);return callback(event,...args);});
  const on=(name,callback)=>ipcMain.on(name,(event,...args)=>{try{authorize(event);callback(event,...args);}catch(error){console.warn(error.message);}});

  handle('island:read-settings',()=>settings);
  handle('island:read-state',()=>state);
  handle('island:read-network',()=>({wifiKnown,offline:wifiDisconnected,platform:process.platform}));
  handle('island:update-settings',(_event,patch)=>{
    const old=settings;
    settings=validateSettings(patch);
    saveSettings();
    for(const listener of preferenceListeners){try{listener({...settings});}catch(error){console.warn(error.message);}}
    emit('island:settings',settings);
    if (settingsWindow&&!settingsWindow.isDestroyed()) settingsWindow.webContents.send('island:settings',settings);
    if (old.visibility!==settings.visibility) { hoverVisible=false; forcedVisible=false; }
    if (old.wifiReactions !== settings.wifiReactions) {
      if (!settings.wifiReactions) {pendingWifiRestore=false; if (['offline','restored'].includes(state)) setIslandState('idle');}
      if (settings.wifiReactions && wifiDisconnected && state==='idle') setIslandState('offline');
    }
    // Avoid a stuck microphone if the user disables the shortcut mid-hold.
    if (old.enableHotkey && !settings.enableHotkey && hotkeyHeld) {
      onModifierEvent('UP');
    }
    // A persisted toggle setting is intentionally ignored in this version.
    positionWindow();updateVisibility();
    if (process.platform==='win32' && app.isPackaged) app.setLoginItemSettings({openAtLogin:settings.launchAtLogin});
    return settings;
  });
  on('island:set-state',(_event,next)=>setIslandState(next));
  on('island:picker-open',(_event,value)=>{pickerOpen=expanded&&value===true;});
  on('island:audio-level',(_event,level)=>emit('island:audio-level',Math.max(0,Math.min(1,Number(level)||0))));
  on('island:open-settings',openSettings);
  on('island:open-preview',openPreview);
  on('island:sleeping',(_event,value)=>{if(mascotSleeping&&value!==true)wakeClickUntil=Date.now()+1500;mascotSleeping=value===true;});
  on('island:expand',(_event,open)=>setExpanded(open));
  on('island:chat-expanded',(_event,value)=>{chatExpanded=value===true;});
  on('island:task-detail',(_event,open)=>{taskDetailExpanded=open===true;});
  on('island:view',(_event,view)=>{if(['chat','settings','tasks','history'].includes(view))currentPanelView=view;});
  on('island:show',()=>{forcedVisible=true;updateVisibility();if(!isActive())scheduleHide();});
  on('island:conceal-complete',()=>hideWindowNow());
}
// Wi-Fi status is read from Windows' own WLAN interface data. The Electron
// net.isOnline flag alone cannot tell whether Wi-Fi disconnected while Ethernet
// stays connected, so it is deliberately not used for this reaction.
function reportWifi(offline) {
  const knownBefore = wifiKnown;
  const previous = wifiDisconnected;
  wifiDisconnected = Boolean(offline);
  wifiKnown = true;
  if (!knownBefore || previous !== wifiDisconnected) {
    console.log('[C.O.D.Y.] Wi-Fi', wifiDisconnected ? 'disconnected' : 'connected');
    if (settings.wifiReactions) {
      if (wifiDisconnected) {
        pendingWifiRestore = false;
        if (['idle','offline','restored'].includes(state)) setIslandState('offline');
      } else if (knownBefore && previous) {
        pendingWifiRestore = true;
        if (['idle','offline','restored'].includes(state)) setIslandState('idle');
      }
    }
  }
  emit('island:network-status', {wifiKnown, offline:wifiDisconnected});
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('island:network-status', {wifiKnown, offline:wifiDisconnected});
  }
}
function checkWifi() {
  if (process.platform !== 'win32' || wifiCheckInProgress || isQuitting) return;
  wifiCheckInProgress = true;
  execFile('netsh.exe', ['wlan','show','interfaces'],
    {windowsHide:true, timeout:3500, maxBuffer:128*1024},
    (error, stdout) => {
      wifiCheckInProgress = false;
      if (error) return; // Don't manufacture a Wi-Fi failure when netsh is unavailable.
      // Windows English output has one "State : connected/disconnected" per
      // wireless interface. A machine without Wi-Fi has no such lines.
      const states = [...stdout.matchAll(/^\s*State\s*:\s*([^\r\n]+)$/gmi)]
        .map(match=>match[1].trim().toLowerCase());
      if (!states.length) return;
      reportWifi(!states.some(value=>value === 'connected'));
    }
  );
}
function startWifiWatcher() {
  if (process.platform !== 'win32') return;
  setTimeout(checkWifi, 550);
  wifiCheckTimer = setInterval(checkWifi, 4000);
}

let initialized=false;
function mount(){
  if(!initialized){readSettings();setupIpc();startWifiWatcher();screen.on('display-metrics-changed',recoverVisibility);screen.on('display-added',recoverVisibility);screen.on('display-removed',recoverVisibility);powerMonitor.on('resume',recoverVisibility);powerMonitor.on('unlock-screen',recoverVisibility);visibilityTimer=setInterval(recoverVisibility,250);chatShortcutRegistered=globalShortcut.register('Control+Alt+C',()=>handleHotkey('chat'));if(!chatShortcutRegistered)console.warn('CODY: Ctrl+Alt+C is already registered by another application; using focused-window fallback.');initialized=true;}
  if(!islandWindow||islandWindow.isDestroyed())createIsland();
  return islandWindow;
}
function stop(){
  isQuitting=true;
  if(chatShortcutRegistered){globalShortcut.unregister('Control+Alt+C');chatShortcutRegistered=false;}
  for(const timer of [cursorTimer,visibilityTimer,wifiCheckTimer,wifiRestoreTimer,hideTimer,concealFallback])if(timer)clearInterval(timer);
  if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.destroy();
}
function handleHotkey(action){
  if(action?.type==='pointer'){pollCursor(action);return;}
  if(action==='chat'){
    hotkeyHeld=false;emit('island:hotkey','cancel');
    if(expanded){setExpanded(false);return;}
    suspended=false;mount();setExpanded(true);updateVisibility();
    islandWindow.show();islandWindow.focus();emit('island:command','chat');return;
  }
  if(action==='cancel'){hotkeyHeld=false;emit('island:hotkey','cancel');return;}
  if(action==='down')suspended=false;
  onModifierEvent(action==='down'?'DOWN':'UP');
}
module.exports={setWakeListening(value){wakeListeningActive=Boolean(value);if(wakeListeningActive)suspended=false;updateVisibility();},setCaptureUIActive(value){captureUIActive=Boolean(value);captureUIGraceUntil=Date.now()+600;},setFileDragActive(value){fileDragActive=Boolean(value);if(fileDragActive)suspended=false;updateVisibility();},preferences:()=>({...settings}),onPreferencesChanged:listener=>preferenceListeners.add(listener),mount,stop,handleHotkey,setIslandState,collapse(){setExpanded(false);},showCompact(){suspended=false;mount();setExpanded(false);updateVisibility();},setRecordingActive(value){const next=Boolean(value);if(next&&!recordingActive)suspended=false;recordingActive=next;updateVisibility();},setGameActive(value){const next=Boolean(value);if(next&&!gameActive)suspended=false;gameActive=next;updateVisibility();},setTimerVisible(value){timerVisible=Boolean(value);updateVisibility();},hide(){suspended=true;setExpanded(false);updateVisibility();},show(){suspended=false;mount();setExpanded(true);islandWindow.show();islandWindow.focus();},window:()=>islandWindow};
