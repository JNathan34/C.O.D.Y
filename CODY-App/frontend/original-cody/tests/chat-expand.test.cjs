'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/island/main.js'),'utf8');
const cursor=source.slice(source.indexOf('function pollCursor('),source.indexOf('function onModifierEvent('));
test('native collapse resets expanded chat hit bounds, including repeated minimise requests',()=>{
 const fn=source.slice(source.indexOf('function setExpanded('),source.indexOf('function openSettings('));
 const context=vm.createContext({expanded:true,chatExpanded:true,pickerOpen:true,forcedVisible:true,hideTimer:null,emit(){},isActive:()=>false,scheduleHide(){},updateVisibility(){},islandWindow:{focus(){}}});
 vm.runInContext(fn,context);context.setExpanded(true);assert.equal(context.chatExpanded,true);
 context.setExpanded(false);assert.equal(context.chatExpanded,false);assert.equal(context.expanded,false);assert.equal(context.pickerOpen,false);
 context.setExpanded(true);assert.equal(context.chatExpanded,false);
 context.setExpanded(false);context.chatExpanded=true;context.setExpanded(false);assert.equal(context.chatExpanded,false);
});
test('expanded chat accepts clicks in its wider and lower area; compact chat leaves that space click-through',()=>{
 function run(chatExpanded,point){let ignored,closed=false;
  const context=vm.createContext({chatExpanded,islandWindow:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:0,y:0,width:940,height:750}),setIgnoreMouseEvents:value=>ignored=value},settings:{islandSize:'medium',visibility:'always'},SIZES:{medium:{width:216,height:32}},SETTINGS_WIDTH:900,SETTINGS_HEIGHT:716,TASKS_WIDTH:520,TASKS_HEIGHT:420,CHAT_WIDTH:520,CHAT_HEIGHT:352,currentPanelView:'chat',taskDetailExpanded:false,expanded:true,pickerOpen:false,mouseIgnored:null,mascotSleeping:false,wakeClickUntil:0,shouldRecoverPointer:()=>false,shouldShow:()=>true,captureUIBusy:()=>false,setExpanded:()=>closed=true,emit(){},performance:{now:()=>100},lastPointerTime:0,lastPointer:null,hoverVisible:false});
  vm.runInContext(cursor,context);context.pollCursor({...point,button:'left'});return {ignored,closed};
 }
 for(const point of [{x:120,y:200},{x:470,y:600}]){assert.deepEqual(run(true,point),{ignored:false,closed:false});assert.deepEqual(run(false,point),{ignored:true,closed:true});}
 assert.deepEqual(run(true,{x:5,y:200}),{ignored:true,closed:true});
});
