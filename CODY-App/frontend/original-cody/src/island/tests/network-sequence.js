'use strict';
// Exercise the actual main-process state/reconnection code without launching Electron.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const main=fs.readFileSync(require('node:path').resolve(__dirname,'../src/main.js'),'utf8');
function extract(begin,end){const i=main.indexOf(begin); const j=main.indexOf(end,i);assert(i>=0&&j>i);return main.slice(i,j)}
const source=extract('function setIslandState(next) {','function setExpanded(next) {')+'\n'+extract('function reportWifi(offline) {','function checkWifi() {');
let id=0;const timers=new Map();
const log=[];
const context={
 state:'idle',wifiDisconnected:false,wifiKnown:false,pendingWifiRestore:false,wifiRestoreTimer:null,
 settings:{wifiReactions:true},hideTimer:null,expanded:false,forcedVisible:false,settingsWindow:null,
 emit:(type,value)=>{if(type==='island:state')log.push(value)},
 scheduleHide:()=>{},updateVisibility:()=>{}, isActive:()=>context.state!=='idle',
 clearTimeout:(timer)=>timers.delete(timer),
 setTimeout:(fn,time)=>{const timer=++id;timers.set(timer,{fn,time});return timer},
 console:{log:()=>{}}
};
vm.createContext(context);vm.runInContext(source,context);
const tickRestored=()=>{const pair=[...timers.entries()].find(([,entry])=>entry.time===1950);assert(pair,'Recovery timer missing');timers.delete(pair[0]);pair[1].fn()};
context.reportWifi(false);assert.equal(context.state,'idle','Initial connection must not animate restoration');
context.reportWifi(true);assert.equal(context.state,'offline');
context.reportWifi(false);assert.equal(context.state,'restored');
tickRestored();assert.equal(context.state,'idle');
context.reportWifi(true);assert.equal(context.state,'offline');
context.setIslandState('speaking');
context.reportWifi(false);assert.equal(context.state,'speaking');assert.equal(context.pendingWifiRestore,true);
context.setIslandState('idle');assert.equal(context.state,'restored');
tickRestored();assert.equal(context.state,'idle');
context.reportWifi(true);assert.equal(context.state,'offline');
context.reportWifi(false);assert.equal(context.state,'restored');
context.reportWifi(true);assert.equal(context.state,'offline');assert(![...timers.values()].some(t=>t.time===1950),'Recovery timer should be cancelled on drop');
console.log('Wi-Fi loss, restore, queued recovery, interruption, and initial online state checks passed.');
