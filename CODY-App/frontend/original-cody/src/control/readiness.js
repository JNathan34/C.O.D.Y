'use strict';
const {taskCategories,allowedFor}=require('./tool-loop');
const {ACTIONS}=require('./policy');
const fs=require('node:fs');
/** No AI request should be spent asking why a local tool is missing. */
function toolReadiness(human,permissions,{workingFolder='',firefoxConnected=false}={}){
 const categories=taskCategories(human);
 if(!categories.length)return null;
 const state=permissions||{};
 if(!state.enabled||state.level==='off')return {reason:'Computer control is off. Enable it in C.O.D.Y Settings → Computer control.',categories};
 const allowed=allowedFor(human,state);
 const file=categories.includes('files')||categories.includes('development');
 const browser=categories.includes('browser');
 if(categories.includes('visual3d')&&!state.visual3d)return {reason:'3D visuals are disabled in Computer control permissions.',categories};
 if(categories.includes('annotations')&&!state.annotations)return {reason:'Screen annotations are disabled in Computer control permissions.',categories};
 if(categories.includes('annotations')&&!/^(?:clear|remove|hide|erase)\b/i.test(human.trim())&&!state.uiAutomation&&!state.screenshots)return {reason:'Enable desktop accessibility inspection or screenshot permission in Computer control so C.O.D.Y can locate annotation targets accurately.',categories};
 if(file){
   if(!state.filesRead)return {reason:'File search/read permission is disabled. Enable “Read files” in C.O.D.Y Settings → Computer control.',categories};
   if(!['full','advanced'].includes(state.level)&&(!workingFolder||!fs.existsSync(workingFolder)||!fs.statSync(workingFolder).isDirectory()))return {reason:'Choose an approved working folder in C.O.D.Y Settings first. C.O.D.Y will NOT scan your entire PC or other drives automatically.',categories};
 }
 if(browser){
   if(!state.browserRead)return {reason:'Firefox page-reading permission is disabled. Enable “Read Firefox pages” in C.O.D.Y Settings.',categories};
   const interacts=/\b(?:open|visit|navigate|browse|click|type|enter|scroll|switch|close|fill|select|go to)\b/i.test(human);
   if(interacts&&!state.browserInteract)return {reason:'Firefox interaction permission is disabled. Enable “Control Firefox pages” in C.O.D.Y Settings.',categories};
   if(!firefoxConnected)return {reason:'Firefox is not connected to C.O.D.Y. Open Firefox, load the Open Browser Control extension and check “Firefox browser extension” in C.O.D.Y Settings. The C.O.D.Y bridge listens on localhost:9334.',categories};
 }
 if(!allowed.length){
   const caps=categories.map(c=>({files:'filesRead / filesWrite',browser:'browserRead / browserInteract',ui:'applications / windows / keyboardMouse / uiAutomation',development:'developerTools'})[c]);
   return {reason:`This request needs computer tools that are currently disabled (${caps.join('; ')}). Check your individual C.O.D.Y permission switches.`,categories};
 }
 return null;
}
// Report actual permissions to the cloud model. This is a user-level prompt,
// not a privileged system role; the dispatcher independently enforces policy.
function capabilityStatus(perms,{workingFolder='',firefoxConnected=false}={}){
 if(!perms?.enabled||perms.level==='off')return 'Computer control: OFF. Never claim Windows/Firefox access.';
 const enabled=Object.entries(ACTIONS).filter(([,a])=>!a.directOnly&&Boolean(perms[a.permission])).map(([a])=>a);
 const full=['full','advanced'].includes(perms.level);
 return `Computer control level: ${full?'Full access':perms.level}; enabled actions: ${enabled.join(', ')||'none'}; file root: ${full?'Full access: absolute file paths on any local drive are allowed; relative paths use '+(workingFolder||require('node:os').homedir()):workingFolder?'user-approved folder selected':'NOT SELECTED'}; Firefox extension: ${firefoxConnected?'connected':'disconnected'}. C.O.D.Y locally validates each requested action. ${full?'Full access enables every tool category without per-action approval. Use accessRoot returned by file tools to resolve relative result paths, and backupRoot for file.restore. Windows account permissions and tool argument checks still apply.':'Files remain inside the approved folder. Potentially unsafe actions require approval.'}`;
}
module.exports={toolReadiness,capabilityStatus};
