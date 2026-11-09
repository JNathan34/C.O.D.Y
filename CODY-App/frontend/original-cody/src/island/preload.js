'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const allowedEvents=new Set(['updates-state','status','diagnostic','auth-changed','chats-changed','settings-changed','message-added','message-delta','message-replace','activity','usage','busy','approval','approval-resolved','window-state','quota','web-status','firefox-status','voice-hotkey','timer-changed','island-card','spotify-changed','native-phase','native-meter','rps-state','capture-state','monitor-state','computer-approvals','attachments-state','tasks-changed','tasks-open','browser-setup','browser-setup-open','wake-word-state']);
contextBridge.exposeInMainWorld('assistant',{
  browserSetup:{state:()=>ipcRenderer.invoke('browser-setup-state'),choose:value=>ipcRenderer.invoke('browser-setup-choice',value),folder:()=>ipcRenderer.invoke('browser-setup-folder')},
  updates:{state:()=>ipcRenderer.invoke('updates-state'),check:()=>ipcRenderer.invoke('updates-check'),download:()=>ipcRenderer.invoke('updates-download'),install:()=>ipcRenderer.invoke('updates-install'),configure:value=>ipcRenderer.invoke('updates-configure',value),releases:()=>ipcRenderer.invoke('updates-releases')},
  state:()=>ipcRenderer.invoke('state'),
  settingsBackup:{import:()=>ipcRenderer.invoke('settings-import'),export:()=>ipcRenderer.invoke('settings-export')},
  localMemory:{mode:()=>ipcRenderer.invoke('memory-mode-state'),configure:value=>ipcRenderer.invoke('memory-mode-configure',value),notes:query=>ipcRenderer.invoke('memory-local-notes',query),save:text=>ipcRenderer.invoke('memory-local-save',text),remove:id=>ipcRenderer.invoke('memory-delete-record',id)},
  tasks:{clear:id=>ipcRenderer.invoke('task-clear',id),clearFinished:()=>ipcRenderer.invoke('tasks-clear-finished'),open:value=>ipcRenderer.invoke('task-open-output',value),expand:value=>ipcRenderer.send('island:task-detail',value===true),state:()=>ipcRenderer.invoke('tasks-state'),preview:id=>ipcRenderer.invoke('task-preview',id),detail:id=>ipcRenderer.invoke('task-detail',id),action:value=>ipcRenderer.invoke('task-action',value),chat:id=>ipcRenderer.invoke('task-chat',id)},
  files:{state:()=>ipcRenderer.invoke('attachments-state'),add:files=>{const paths=Array.from(files,file=>webUtils.getPathForFile(file)).filter(Boolean);if(!paths.length)throw Error('Drop files saved on your computer.');return ipcRenderer.invoke('attachments-add',paths);},remove:id=>ipcRenderer.invoke('attachments-remove',id),pick:()=>ipcRenderer.invoke('attachments-pick'),dragging:value=>ipcRenderer.invoke('attachments-drag',Boolean(value))},
  approvals:{state:()=>ipcRenderer.invoke('computer-approval-state'),decide:(id,decision)=>ipcRenderer.invoke('computer-approval-decision',id,decision)},
  backends:{status:()=>ipcRenderer.invoke('backend-status'),refresh:()=>ipcRenderer.invoke('backend-refresh')},
  plugins:{list:()=>ipcRenderer.invoke('plugins-list'),action:value=>ipcRenderer.invoke('plugins-action',value),add:value=>ipcRenderer.invoke('plugins-add',value)},
  agents:{usage:()=>ipcRenderer.invoke('heyclicky-usage'),codexUsage:()=>ipcRenderer.invoke('codex-usage'),claudeAccount:action=>ipcRenderer.invoke('claude-account',action),provider:()=>ipcRenderer.invoke('agent-provider-state'),selectProvider:provider=>ipcRenderer.invoke('agent-provider-select',provider),connectProvider:()=>ipcRenderer.invoke('agent-provider-connect'),state:()=>ipcRenderer.invoke('agents-state'),configure:value=>ipcRenderer.invoke('agents-configure',value),folder:()=>ipcRenderer.invoke('agents-folder'),privacy:id=>ipcRenderer.invoke('agents-privacy',id)},
  memory:{status:()=>ipcRenderer.invoke('memory-status'),search:(query,sourceId)=>ipcRenderer.invoke('memory-search',query,sourceId),configure:(id,patch)=>ipcRenderer.invoke('memory-source',id,patch),removeSource:id=>ipcRenderer.invoke('memory-delete-source',id),remove:id=>ipcRenderer.invoke('memory-delete-record',id),update:(id,text)=>ipcRenderer.invoke('memory-update',id,text),save:value=>ipcRenderer.invoke('memory-save',value),import:()=>ipcRenderer.invoke('memory-import'),export:()=>ipcRenderer.invoke('memory-export'),codexList:cursor=>ipcRenderer.invoke('memory-codex-list',cursor),codexImport:id=>ipcRenderer.invoke('memory-codex-import',id)},
  rps:{state:()=>ipcRenderer.invoke('rps-state'),action:value=>ipcRenderer.invoke('rps-action',value)},
  capture:{state:()=>ipcRenderer.invoke('capture-state'),action:action=>ipcRenderer.invoke('capture-action',action),reveal:kind=>ipcRenderer.invoke('capture-reveal',kind)},
  dismissTimer:()=>ipcRenderer.invoke('timer-dismiss'),
  newChat:()=>ipcRenderer.invoke('new-chat'),
  selectChat:id=>ipcRenderer.invoke('select-chat',id),
  deleteChat:id=>ipcRenderer.invoke('delete-chat',id),
  saveSettings:s=>ipcRenderer.invoke('save-settings',s),
  browseFolder:()=>ipcRenderer.invoke('browse-folder'),
  connect:()=>ipcRenderer.invoke('connect'),
  account:()=>ipcRenderer.invoke('account'),
  signIn:()=>ipcRenderer.invoke('sign-in'),
  rateLimits:()=>ipcRenderer.invoke('rate-limits'),
  openChatGPT:()=>ipcRenderer.invoke('open-chatgpt'),
  webStatus:()=>ipcRenderer.invoke('web-status'),
  webSignIn:()=>ipcRenderer.invoke('web-sign-in'),
  sendMessage:args=>ipcRenderer.invoke('send-message',args),
  stop:()=>ipcRenderer.invoke('stop-turn'),
  wake:{status:()=>ipcRenderer.invoke('wake-word-status')},
  audioOutput:{list:()=>ipcRenderer.invoke('audio-output-devices'),select:deviceId=>ipcRenderer.invoke('audio-output-select',deviceId)},
  voice:{
    begin:()=>ipcRenderer.invoke('native-begin'),
    end:()=>ipcRenderer.invoke('native-end'),
    stopSpeech:()=>ipcRenderer.invoke('native-stop-speech'),
    preview:()=>ipcRenderer.invoke('native-preview'),
    voices:engine=>ipcRenderer.invoke('voice-voices',engine),
    install:engine=>ipcRenderer.invoke('voice-install',engine),
    cancel:()=>ipcRenderer.invoke('voice-cancel'),
    status:()=>ipcRenderer.invoke('voice-status'),
    configure:settings=>ipcRenderer.invoke('voice-configure',settings),
    transcribe:audio=>ipcRenderer.invoke('voice-transcribe',audio),
    synthesize:text=>ipcRenderer.invoke('voice-synthesize',{text})
  },
  annotations:{
    settings:()=>ipcRenderer.invoke('annotations-settings'),
    configure:patch=>ipcRenderer.invoke('annotations-configure',patch),
    clear:()=>ipcRenderer.invoke('annotations-clear'),
    demo:()=>ipcRenderer.invoke('annotations-demo'),
    speech:phase=>ipcRenderer.invoke('annotations-speech',phase)
  },
  visuals:{state:()=>ipcRenderer.invoke('visuals-state'),configure:patch=>ipcRenderer.invoke('visuals-configure',patch),demo:()=>ipcRenderer.invoke('visuals-demo'),clear:()=>ipcRenderer.invoke('visuals-clear'),clearAll:()=>ipcRenderer.invoke('visuals-clear-all')},
  control:{
    firefoxStatus:()=>ipcRenderer.invoke('firefox-status'),
    firefoxTest:()=>ipcRenderer.invoke('firefox-smoke-test'),
    catalog:()=>ipcRenderer.invoke('computer-catalog'),
    audit:()=>ipcRenderer.invoke('computer-audit'),
    emergencyStop:()=>ipcRenderer.invoke('computer-emergency-stop'),
    permissions:()=>ipcRenderer.invoke('computer-permissions'),
    configure:settings=>ipcRenderer.invoke('computer-configure',settings),
    execute:(action,args={})=>ipcRenderer.invoke('computer-execute',{action,args})
  },
  approve:(id,decision)=>ipcRenderer.invoke('approval-decision',id,decision),
  windowAction:a=>ipcRenderer.invoke('window-action',a),
  on:(event,callback)=>{if(!allowedEvents.has(event))throw Error('Unknown event');const listener=(_,value)=>callback(value);ipcRenderer.on(event,listener);return()=>ipcRenderer.removeListener(event,listener);}
});

(function(){
'use strict';
const {contextBridge,ipcRenderer}=require('electron');
function listen(channel,callback){
  const fn=(_event,value)=>callback(value);
  ipcRenderer.on(channel,fn);
  return()=>ipcRenderer.removeListener(channel,fn);
}
contextBridge.exposeInMainWorld('cody',Object.freeze({
  getSettings:()=>ipcRenderer.invoke('island:read-settings'),
  getState:()=>ipcRenderer.invoke('island:read-state'),
  getNetworkStatus:()=>ipcRenderer.invoke('island:read-network'),
  updateSettings:patch=>ipcRenderer.invoke('island:update-settings',patch),
  setState:state=>ipcRenderer.send('island:set-state',state),
  setSleeping:value=>ipcRenderer.send('island:sleeping',value===true),
  setAudioLevel:level=>ipcRenderer.send('island:audio-level',level),
  openSettings:()=>ipcRenderer.send('island:open-settings'),
  openPreview:()=>ipcRenderer.send('island:open-preview'),
  expand:open=>ipcRenderer.send('island:expand',open),
  setChatExpanded:value=>ipcRenderer.send('island:chat-expanded',value===true),
  setView:view=>ipcRenderer.send('island:view',view),
  setPickerOpen:open=>ipcRenderer.send('island:picker-open',Boolean(open)),
  show:()=>ipcRenderer.send('island:show'),
  concealComplete:()=>ipcRenderer.send('island:conceal-complete'),
  onSettings:cb=>listen('island:settings',cb),
  onGameCommand:cb=>listen('island:game-command',cb),
  onState:cb=>listen('island:state',cb),
  onAudioLevel:cb=>listen('island:audio-level',cb),
  onHotkey:cb=>listen('island:hotkey',cb),
  onCommand:cb=>listen('island:command',cb),
  onExpanded:cb=>listen('island:expanded',cb),
  onShowSettings:cb=>listen('island:show-settings',cb),
  onVisibility:cb=>listen('island:visibility',cb),
  onCursor:cb=>listen('island:cursor',cb),
  onNetwork:cb=>listen('island:network-status',cb),
  onAnimationPreview:cb=>listen('island:open-animation-preview',cb)
}));

})();
