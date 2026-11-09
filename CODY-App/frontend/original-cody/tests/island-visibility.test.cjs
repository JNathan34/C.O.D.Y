'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../src/island',file),'utf8');
const source=read('renderer/ui.js');
const reveal=source.slice(source.indexOf('  function showIsland('),source.indexOf('  function stopMicrophone('));
function fixture(initial='hidden'){
 const concealed=[];
 let complete;
 const animation={transitionProperty:'--unfold-width',playState:'running',finished:new Promise(resolve=>complete=resolve)};
 const empty={getAnimations:()=>[]};
 const context=vm.createContext({body:{dataset:{reveal:initial}},revealTransition:0,concealRequest:undefined,
  island:empty,islandContent:empty,shape:{getAnimations:()=>[animation]},api:{concealComplete:request=>concealed.push(request)}});
 vm.runInContext(reveal,context);
 return {show:context.showIsland,state:()=>context.body.dataset.reveal,concealed,finish:async()=>{
  animation.playState='finished';complete();await new Promise(setImmediate);
 }};
}
test('repeated visibility notifications do not strand the reveal animation',async()=>{
 const f=fixture();f.show(true);f.show(true);f.show(true);await f.finish();assert.equal(f.state(),'visible');assert.deepEqual(f.concealed,[]);
});
test('conceal waits for the transition and acknowledges the latest request once',async()=>{
 const f=fixture('visible');f.show(false,1);f.show(false,2);
 assert.equal(f.state(),'leaving');assert.deepEqual(f.concealed,[]);
 await f.finish();assert.equal(f.state(),'hidden');assert.deepEqual(f.concealed,[2]);
});
test('reversing a conceal cancels its stale completion',async()=>{
 const f=fixture('visible');f.show(false,1);f.show(true);f.show(true);await f.finish();assert.equal(f.state(),'visible');assert.deepEqual(f.concealed,[]);
});
test('reversing a reveal still completes the requested conceal',async()=>{
 const f=fixture();f.show(true);f.show(false,1);f.show(false,1);await f.finish();assert.equal(f.state(),'hidden');assert.deepEqual(f.concealed,[1]);
});
test('Ctrl+Alt+H holds the panel until conceal completes and ignores a stale acknowledgment',()=>{
 const main=read('main.js');
 const messages=[];
 let visible=true, mouseIgnored=false;
 const context=vm.createContext({
  concealFallback:null,concealRequest:0,visibilityShortcutHeld:false,hiddenByShortcut:false,isQuitting:false,
  suspended:false,expanded:true,forcedVisible:false,hotkeyHeld:false,hideTimer:null,
  shouldShow:()=>!context.hiddenByShortcut,captureUIBusy:()=>false,positionWindow(){},mount(){},
  setExpanded:value=>{context.expanded=value;},emit:(...args)=>messages.push(args),
  setTimeout:callback=>callback,clearTimeout(){},
  islandWindow:{isVisible:()=>visible,isDestroyed:()=>false,isMinimized:()=>false,showInactive:()=>visible=true,
   hide:()=>visible=false,setIgnoreMouseEvents:value=>mouseIgnored=value},
  mouseIgnored:false
 });
 vm.runInContext(main.slice(main.indexOf('function hideWindowNow('),main.indexOf('function recoverVisibility(')),context);
 vm.runInContext(main.slice(main.indexOf('function handleHotkey('),main.indexOf('module.exports=')),context);
 const toggle=()=>{context.handleHotkey('toggle-visibility');context.handleHotkey('visibility-up');};
 toggle();
 assert.deepEqual(messages.at(-1),['island:visibility',false,1]);
 assert.equal(mouseIgnored,true);assert.equal(visible,true);assert.equal(context.expanded,true);
 toggle();toggle();
 assert.deepEqual(messages.at(-1),['island:visibility',false,2]);
 context.hideWindowNow(1);
 assert.equal(visible,true);
 context.hideWindowNow(2);
 assert.equal(visible,false);assert.equal(context.expanded,false);
});
