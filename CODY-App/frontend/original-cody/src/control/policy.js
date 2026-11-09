'use strict';
const {ACTIONS:DRAW_ACTIONS}=require('../annotations/schema');
const {ACTIONS:SCENE_ACTIONS}=require('../visuals/schema');

// No models are executed on the computer. The rules below govern OS tools only.
const DEFAULT_PERMISSIONS = Object.freeze({
  enabled: false,
  level: 'approve-safe',
  systemInfo: true,
  systemSettings: false,
  applications: true,
  audio: true,
  windows: false,
  keyboardMouse: false,
  clipboard: false,
  screenshots: false,
  filesRead: false,
  filesWrite: false,
  developerTools: false,
  uiAutomation: false,
  browserRead: false,
  browserInteract: false,
  annotations: true,
  visual3d: true
});

const ACTIONS = Object.freeze({
  'system.status': {permission: 'systemInfo', risk: 'low', description:'Get CPU, memory and OS summary'},
  'system.radio.set': {permission:'systemSettings',risk:'low',description:'Turn Bluetooth or Wi-Fi on or off and verify Windows radio state'},
  'system.radio.status': {permission:'systemInfo',risk:'low',description:'Read Bluetooth or Wi-Fi radio state'},
  'system.power.set': {permission:'systemSettings',risk:'low',description:'Set Best power efficiency, Balanced or Best performance for the current power supply'},
  'system.power.status': {permission:'systemInfo',risk:'low',description:'Read the configured Windows power mode for the current power supply'},
  'system.brightness.set': {permission:'systemSettings',risk:'low',description:'Set Windows-managed display brightness from 0 to 100 percent'},
  'system.brightness.status': {permission:'systemInfo',risk:'low',description:'Read brightness of Windows-managed displays'},
  'system.settings.open': {permission:'applications',risk:'low',description:'Open an approved Windows Settings page; Energy saver must be changed using its Windows control'},
  'app.open': {permission:'applications',risk:'low',description:'Open an approved Windows application'},
  'app.split': {permission:'applications',requires:['windows'],risk:'low',description:'Open two approved applications and arrange their windows side by side'},
  'app.list': {permission:'applications',risk:'low',description:'List open applications'},
  'app.close': {permission:'applications',risk:'always',description:'Gracefully close an approved application window'},
  'audio.set': {permission:'audio',risk:'low',description:'Set Windows master volume (0–100)'},
  'audio.mute': {permission:'audio',risk:'low',description:'Mute or unmute Windows audio'},
  'discord.voice': {permission:'audio',requires:['uiAutomation'],risk:'low',directOnly:true,description:'Change your own Discord mute or deafen state'},
  'discord.share': {permission:'screenshots',requires:['uiAutomation'],risk:'low',directOnly:true,description:'Share the requested screen or window in your current Discord call'},
  'spotify.control': {permission:'audio',risk:'low',description:'Control Spotify desktop playback'},
  'media.control': {permission:'audio',risk:'low',description:'Control the media player displayed in the Island'},
  'plezy.play': {permission:'audio',risk:'low',description:'Search for an exact title in the installed Plezy app and start playback'},
  'window.list': {permission:'windows',risk:'low',description:'List open visible windows'},
  'window.pin': {permission:'windows',requires:['applications'],risk:'low',description:'Pin or unpin an approved app window above other apps'},
  'window.focus': {permission:'windows',risk:'confirm',description:'Focus a specific existing window'},
  'window.minimize': {permission:'windows',risk:'confirm',description:'Minimize a specific visible window'},
  'window.maximize': {permission:'windows',risk:'confirm',description:'Maximize a specific visible window'},
  'process.list': {permission:'windows',risk:'low',description:'List running processes'},
  'keyboard.hotkey': {permission:'keyboardMouse',risk:'always',description:'Send an approved keyboard shortcut to active window'},
  'keyboard.type': {permission:'keyboardMouse',risk:'always',description:'Type text into the currently focused application'},
  'text.proofread': {permission:'keyboardMouse',requires:['uiAutomation'],risk:'low',description:'Correct spelling in the selected text or current editable field using HeyClicky, preserving wording'},
  'mouse.move': {permission:'keyboardMouse',risk:'confirm',description:'Move the Windows mouse cursor'},
  'mouse.click': {permission:'keyboardMouse',risk:'always',description:'Click in the active Windows desktop'},
  'clipboard.read': {permission:'clipboard',risk:'confirm',description:'Read the clipboard locally'},
  'clipboard.write': {permission:'clipboard',risk:'confirm',description:'Replace the clipboard text'},
  'screen.capture': {permission:'screenshots',risk:'confirm',description:'Capture a screen image; AI visual requests attach it to ChatGPT after permission checks'},
  'screen.list': {permission:'systemInfo',risk:'low',description:'List actual displays and their DIP geometry'},
  'files.list': {permission:'filesRead',risk:'low',description:'List files inside the approved working folder'},
  'files.read': {permission:'filesRead',risk:'confirm',description:'Read a file inside the approved working folder'},
  'files.write': {permission:'filesWrite',risk:'confirm',description:'Write a file inside the approved working folder'},
  'file.list': {permission:'filesRead',risk:'low',description:'List approved folder'},
  'file.search': {permission:'filesRead',risk:'low',description:'Search approved folder'},
  'file.read': {permission:'filesRead',risk:'confirm',description:'Read file content for AI'},
  'file.create': {permission:'filesWrite',risk:'confirm',description:'Create a text file'},
  'file.write': {permission:'filesWrite',risk:'confirm',description:'Replace file with backup'},
  'file.replace': {permission:'filesWrite',risk:'confirm',description:'Replace one matching section'},
  'file.patch': {permission:'filesWrite',risk:'confirm',description:'Patch one matching section'},
  'file.backup': {permission:'filesWrite',risk:'confirm',description:'Back up a file'},
  'file.restore': {permission:'filesWrite',risk:'always',description:'Restore a backup'},
  'file.diff': {permission:'filesRead',risk:'low',description:'Compare proposed text'},
  'file.copy': {permission:'filesWrite',risk:'confirm',description:'Copy a file'},
  'file.move': {permission:'filesWrite',risk:'confirm',description:'Move a file'},
  'file.rename': {permission:'filesWrite',risk:'confirm',description:'Rename a file'},
  'file.delete': {permission:'filesWrite',risk:'always',description:'Delete a file with recoverable backup'},
  'folder.create': {permission:'filesWrite',risk:'confirm',description:'Create a folder'},
  'archive.create': {permission:'filesWrite',risk:'confirm',description:'Create a ZIP from an approved folder'},
  'archive.extract': {permission:'filesWrite',risk:'always',description:'Extract a ZIP into a new approved folder'},
  'desktop.inspect': {permission:'uiAutomation',risk:'confirm',description:'Inspect named Windows UI controls'},
  'desktop.click': {permission:'uiAutomation',risk:'always',description:'Invoke a named accessible button'},
  'terminal.run': {permission:'developerTools',risk:'always',description:'Run an approved development command'},
  'code.check': {permission:'developerTools',risk:'always',description:'Check JavaScript syntax'},
  'code.test': {permission:'developerTools',risk:'always',description:'Run project tests'},
  'code.build': {permission:'developerTools',risk:'always',description:'Build approved project'},
  'browser.pageInfo': {permission:'browserRead',risk:'confirm',description:'Read active Firefox page title and URL for ChatGPT'},
  'browser.getDom': {permission:'browserRead',risk:'confirm',description:'Read page content and form elements for ChatGPT'},
  'browser.readText': {permission:'browserRead',risk:'confirm',description:'Read rendered webpage text from a bounded DOM selector'},
  'browser.readComments': {permission:'browserRead',risk:'confirm',description:'Read displayed YouTube comments and their visible like counts'},
  'browser.listTabs': {permission:'browserRead',risk:'confirm',description:'List C.O.D.Y-owned Firefox tabs'},
  'browser.wait': {permission:'browserRead',risk:'confirm',description:'Wait for a page element'},
  'browser.navigate': {permission:'browserInteract',risk:'confirm',description:'Navigate a C.O.D.Y Firefox tab to an HTTP(S) URL'},
  'browser.newTab': {permission:'browserInteract',risk:'confirm',description:'Open a new C.O.D.Y Firefox tab'},
  'browser.switchTab': {permission:'browserInteract',risk:'confirm',description:'Switch between C.O.D.Y-owned tabs'},
  'browser.closeTab': {permission:'browserInteract',risk:'confirm',description:'Close the C.O.D.Y browser tab'},
  'browser.click': {permission:'browserInteract',risk:'confirm',description:'Click a Firefox webpage element (may submit a form)'},
  'browser.type': {permission:'browserInteract',risk:'confirm',description:'Type text into a Firefox webpage'},
  'browser.keypress': {permission:'browserInteract',risk:'confirm',description:'Press a key in Firefox'},
  'browser.select': {permission:'browserInteract',risk:'confirm',description:'Select an option in a Firefox form'},
  'browser.scroll': {permission:'browserInteract',risk:'low',description:'Scroll an open Firefox page'},
  'browser.hover': {permission:'browserInteract',risk:'low',description:'Hover over a Firefox element'},
  ...Object.fromEntries(DRAW_ACTIONS.map(action=>[action,{permission:'annotations',risk:'low',description:'Click-through desktop annotation: '+action.slice(5)}])),
  ...Object.fromEntries(SCENE_ACTIONS.map(action=>[action,{permission:'visual3d',risk:'low',description:'Desktop 3D visual: '+action}]))
});

const CONTROL_LEVELS = Object.freeze(['off','ask', 'approve-safe', 'standard', 'full','advanced','custom']);
const LEVEL_LABELS = Object.freeze({off:'Off',ask:'Ask for approval','approve-safe':'Approve for me',standard:'Approve for me',full:'Full access',advanced:'Full access',custom:'Custom'});
const PERMISSION_KEYS=Object.freeze(Object.keys(DEFAULT_PERMISSIONS).filter(key=>typeof DEFAULT_PERMISSIONS[key]==='boolean'&&key!=='enabled'));
function normalizePermissions(current, change){
  const old = {...DEFAULT_PERMISSIONS};
  if(current && typeof current==='object')for(const k of Object.keys(old))if(typeof old[k]==='boolean'&&typeof current[k]==='boolean')old[k]=current[k];
  const custom=Object.fromEntries(PERMISSION_KEYS.filter(key=>typeof current?.customPermissions?.[key]==='boolean').map(key=>[key,current.customPermissions[key]]));
  if(current?.level==='custom')for(const key of PERMISSION_KEYS)custom[key]=old[key];
  if(Object.keys(custom).length)old.customPermissions=custom;
  const requested=change?.level??current?.level;
  old.level=requested==='advanced'?'full':requested==='standard'?'approve-safe':CONTROL_LEVELS.includes(requested)?requested:'approve-safe';
  if(change?.level==='custom'&&old.customPermissions)Object.assign(old,old.customPermissions);
  // Selecting a profile is a complete preset, rather than a collection of unchecked boxes.
  if(change&&Object.hasOwn(change,'level')&&CONTROL_LEVELS.includes(change.level)&&old.level!=='off'&&old.level!=='custom'){
    old.enabled=true;for(const key of PERMISSION_KEYS)old[key]=true;
  }
  if(change && typeof change==='object')for(const k of Object.keys(old))if(typeof old[k]==='boolean'&&typeof change[k]==='boolean')old[k]=change[k];
  if(old.level==='full')for(const key of PERMISSION_KEYS)old[key]=true;
  if(old.level==='off')old.enabled=false;
  if(old.level==='custom')old.customPermissions=Object.fromEntries(PERMISSION_KEYS.map(key=>[key,old[key]]));
  return old;
}
// Approve for me allows routine browser actions and challenges consequential ones.
// This classifier is a conservative guardrail, NOT proof that any particular
// web control is harmless. Page content and the model cannot override it.
const SENSITIVE_BROWSER_TERMS=/\b(?:purchase|buy now|checkout|pay(?:ment)?|place order|confirm order|subscribe(?: now)?|transfer|send money|bank|delete|remove account|disable security|reset password|change password|publish|post (?:now|publicly)|send (?:message|email)|submit application|confirm booking|complete booking|sign contract|log out all)\b/i;
const SENSITIVE_BROWSER_SELECTORS=/(?:type\s*=\s*["']?submit|data-(?:testid|action)[\w-]*\s*=\s*["']?(?:send|delete|purchase|checkout|submit|pay)|\bcheckout\b|\bpurchase\b|\bdanger\b|\bdelete\b)/i;
function sensitiveBrowserAction(action,args={},context={}){
  if(!action.startsWith('browser.'))return false;
  const target=[args.text,args.selector,args.value].filter(x=>typeof x==='string').join(' ');
  const human=String(context.humanTask||'');
  if(SENSITIVE_BROWSER_TERMS.test(target)||SENSITIVE_BROWSER_SELECTORS.test(target)||/^(?:submit|send|post|confirm|pay|purchase|checkout|delete|remove|unsubscribe|save changes)$/i.test(target.trim()))return true;
  // A request with consequential external effects must be confirmed when a
  // browser action might submit, select, click, or press Enter.
  if(SENSITIVE_BROWSER_TERMS.test(human)&&['browser.click','browser.type','browser.keypress','browser.select'].includes(action))return true;
  // Unknown Enter without a search-related request may submit a form.
  if(action==='browser.keypress'&&/^(enter|return)$/i.test(String(args.key||''))&&!/\b(?:search|find|look up|play|pause|watch|video|youtube)\b/i.test(human))return true;
  if(action==='browser.type'&&args.pressEnter===true&&!/\b(?:search|find|look up|youtube)\b/i.test(human))return true;
  return false;
}
function needsApproval(action,perms,origin='gui',context={}){
  const policy=ACTIONS[action];if(!policy)throw Error('Unsupported action');
  const level=CONTROL_LEVELS.includes(perms?.level)?perms.level:'approve-safe';
  if(['full','advanced','custom'].includes(level))return false;
  if(level==='ask')return true;
  if(action==='screen.capture'&&origin==='ai-chat')return true;
  if(policy.risk==='always'||sensitiveBrowserAction(action,context.args,context))return true;
  return policy.permission==='filesWrite'&&!['file.backup','folder.create'].includes(action);
}
function availableActions(perms){return Object.entries(ACTIONS).filter(([,entry])=>!entry.directOnly).map(([name,entry])=>({name,...entry,enabled:!!perms.enabled&&!!perms[entry.permission]&&(entry.requires||[]).every(permission=>!!perms[permission])}));}
function permissionError(action,permissions){
  if(!ACTIONS[action])return 'Unsupported action';
  if(!permissions.enabled || permissions.level==='off')return 'Computer control is disabled. Enable it in C.O.D.Y settings first.';
  if(!permissions[ACTIONS[action].permission])return `Permission '${ACTIONS[action].permission}' is disabled`;
  for(const permission of ACTIONS[action].requires||[])if(!permissions[permission])return `Permission '${permission}' is disabled`;
  return null;
}
module.exports={DEFAULT_PERMISSIONS,PERMISSION_KEYS,ACTIONS,CONTROL_LEVELS,LEVEL_LABELS,normalizePermissions,availableActions,permissionError,needsApproval,sensitiveBrowserAction};
