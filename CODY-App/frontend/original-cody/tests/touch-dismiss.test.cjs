'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const read=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');

test('queued touchscreen presses survive split stdout chunks and rapid taps',()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr=new EventEmitter();child.kill=()=>{};
 const context={require:name=>name==='node:child_process'?{spawn:()=>child}:require(name),__dirname:__dirname,module:{exports:{}},console};
 vm.runInNewContext(read('voice/hotkey.js'),context);
 const events=[];context.module.exports.startPushToTalk(event=>events.push(JSON.parse(JSON.stringify(event))));
 child.stdout.emit('data','POINTER -120 30 le');
 child.stdout.emit('data','ft\nPOINTER 900 400 left\n');
 assert.deepEqual(events,[{type:'pointer',x:-120,y:30,button:'left',physicalPixels:true},{type:'pointer',x:900,y:400,button:'left',physicalPixels:true}]);
});

test('native touch coordinates are converted before checking inside/outside the island',()=>{
 const source=read('island/main.js');let point;
 const context={screen:{screenToDipPoint:({x,y})=>({x:x/2,y:y/2})},pollCursor:value=>point=value,module:{exports:{}}};
 vm.runInNewContext(source.slice(source.indexOf('function handleHotkey('),source.indexOf('module.exports=')),context);
 context.handleHotkey({type:'pointer',x:1200,y:800,button:'left',physicalPixels:true});
 assert.equal(point.x,600);assert.equal(point.y,400);assert.equal(point.button,'left');
 context.handleHotkey({type:'pointer',x:300,y:200,button:'left'});
 assert.equal(point.x,300);assert.equal(point.y,200);
});

test('outside taps collapse compact and expanded chat; inside taps and open pickers stay open',()=>{
 const source=read('island/main.js');
 const poll=source.slice(source.indexOf('function pollCursor('),source.indexOf('function onModifierEvent('));
 function tap({chatExpanded=false,x=950,y=500,pickerOpen=false,fileDialogs=0,capture=false}={}){
  let collapsed=false;
  const context={chatExpanded,pickerOpen,fileDialogs,islandWindow:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:0,y:0,width:940,height:750}),setIgnoreMouseEvents(){}},settings:{islandSize:'medium',visibility:'always'},SIZES:{medium:{width:216,height:32}},SETTINGS_WIDTH:900,SETTINGS_HEIGHT:716,TASKS_WIDTH:520,TASKS_HEIGHT:420,CHAT_WIDTH:520,CHAT_HEIGHT:352,currentPanelView:'chat',taskDetailExpanded:false,expanded:true,mouseIgnored:null,mascotSleeping:false,wakeClickUntil:0,shouldRecoverPointer:()=>false,shouldShow:()=>true,captureUIBusy:()=>capture,setExpanded:()=>collapsed=true,emit(){},performance:{now:()=>100},lastPointerTime:0,lastPointer:null,hoverVisible:false};
  vm.runInNewContext(poll,context);context.pollCursor({x,y,button:'left'});return collapsed;
 }
 assert.equal(tap(),true);assert.equal(tap({chatExpanded:true}),true);
 assert.equal(tap({x:470,y:200}),false);assert.equal(tap({chatExpanded:true,x:470,y:600}),false);
 assert.equal(tap({pickerOpen:true}),false);assert.equal(tap({capture:true}),false);assert.equal(tap({fileDialogs:1}),false);
});

test('first native tap opens an awake click-through island without a renderer click',()=>{
 const source=read('island/main.js');const commands=[];
 const context={chatExpanded:false,pickerOpen:false,fileDialogs:0,islandWindow:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:0,y:0,width:940,height:750}),setIgnoreMouseEvents(){}},settings:{islandSize:'medium',visibility:'always'},SIZES:{medium:{width:216,height:32}},SETTINGS_WIDTH:900,SETTINGS_HEIGHT:716,TASKS_WIDTH:520,TASKS_HEIGHT:420,CHAT_WIDTH:520,CHAT_HEIGHT:352,currentPanelView:'chat',taskDetailExpanded:false,expanded:false,fpsVisible:false,mouseIgnored:true,mascotSleeping:false,wakeClickUntil:0,shouldRecoverPointer:require('../src/island/pointer-open').shouldRecoverPointer,shouldShow:()=>true,captureUIBusy:()=>false,setExpanded:value=>{context.expanded=value;},emit:(...args)=>commands.push(args),performance:{now:()=>100},lastPointerTime:0,lastPointer:null,hoverVisible:false};
 vm.runInNewContext(source.slice(source.indexOf('function pollCursor('),source.indexOf('function onModifierEvent(')),context);
 context.pollCursor({x:470,y:16,button:'left'});
 assert.equal(context.expanded,true);assert.equal(context.mouseIgnored,false);
 assert.deepEqual(commands.find(([name])=>name==='island:command'),['island:command','pointer-open']);
 context.expanded=false;
 context.fpsVisible=true;
 context.FPS_SLOT_WIDTH=62;
 context.pollCursor({x:356,y:16,button:'left'});
 assert.equal(context.expanded,true);
});

test('the click following native tap opening does not collapse the panel again',()=>{
 const source=read('island/renderer/ui.js');let click,command,now=100;
 const context={island:{addEventListener:(name,fn)=>{click=fn;},getBoundingClientRect:()=>({left:210,width:520,top:0})},api:{onCommand:fn=>{command=fn;}},performance:{now:()=>now},pointerOpenUntil:0,panelOpen:false,setPanelOpen:value=>{context.panelOpen=value;},togglePanel:value=>{context.panelOpen=value;}};
 vm.runInNewContext(source.slice(source.indexOf("island.addEventListener('click',"),source.indexOf("island.addEventListener('mouseenter',")),context);
 vm.runInNewContext(source.slice(source.indexOf('api.onCommand(action=>'),source.indexOf('api.onState(next=>')),context);
 command('pointer-open');
 click({target:{closest:()=>null},clientX:470,clientY:16});
 assert.equal(context.panelOpen,true);
 now=2000;click({target:{closest:()=>null},clientX:470,clientY:16});
 assert.equal(context.panelOpen,false);
});
