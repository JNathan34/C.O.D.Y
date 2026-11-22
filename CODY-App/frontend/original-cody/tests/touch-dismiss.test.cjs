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
 child.stdout.emit('data','ft\nPOINTER 900 400 left\nPIN_RELEASE\n');
 assert.deepEqual(events,[{type:'pointer',x:-120,y:30,button:'left',physicalPixels:true},{type:'pointer',x:900,y:400,button:'left',physicalPixels:true},'pin-up']);
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

test('outside presses from Windows or the transparent host collapse expanded panels',()=>{
 const source=read('island/main.js');
 const poll=source.slice(source.indexOf('function pollCursor('),source.indexOf('function onModifierEvent('));
 function tap({chatExpanded=false,chatPinned=false,guiScale=100,x=936,y=745,pickerOpen=false,fileDialogs=0,capture=false,host=false,type='mouseDown'}={}){
  let collapsed=false;
  const bounds={x:-1200,y:44,width:940,height:750};
  const context={chatExpanded,pickerOpen,fileDialogs,islandWindow:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>bounds,getContentBounds:()=>bounds,setIgnoreMouseEvents(){}},settings:{islandSize:'medium',visibility:'always',guiScale},SIZES:{medium:{width:216,height:32}},SETTINGS_WIDTH:900,SETTINGS_HEIGHT:716,TASKS_WIDTH:520,TASKS_HEIGHT:420,CHAT_WIDTH:520,CHAT_HEIGHT:352,currentPanelView:'chat',taskDetailExpanded:false,expanded:true,mouseIgnored:null,mascotSleeping:false,wakeClickUntil:0,shouldRecoverPointer:()=>false,shouldShow:()=>true,captureUIBusy:()=>capture,setExpanded:(value,{automatic=false}={})=>{if(automatic&&chatPinned)return;context.expanded=value;collapsed=!value;},emit(){},performance:{now:()=>100},lastPointerTime:0,lastPointer:null,hoverVisible:false};
  Object.assign(context,{mediaPreviewKind:null,mediaPreviewHovered:false});
  vm.runInNewContext(poll,context);
  if(host){
   let prevented=false;
   context.onIslandMouseEvent({preventDefault(){prevented=true;}},{type,x,y,button:'left'});
   assert.equal(prevented,collapsed);
  }else context.pollCursor({x:bounds.x+x,y:bounds.y+y,button:'left'});
  return collapsed;
 }
 for(const host of [false,true]){
  assert.equal(tap({host}),true);assert.equal(tap({host,chatExpanded:true}),true);
  assert.equal(tap({host,chatPinned:true}),false);
  assert.equal(tap({host,x:470,y:200}),false);assert.equal(tap({host,chatExpanded:true,x:470,y:600}),false);
  assert.equal(tap({host,x:750,y:200}),true);assert.equal(tap({host,guiScale:125,x:750,y:200}),false);
  assert.equal(tap({host,pickerOpen:true}),false);assert.equal(tap({host,capture:true}),false);assert.equal(tap({host,fileDialogs:1}),false);
 }
 assert.equal(tap({host:true,type:'mouseMove'}),false);
});

test('first native tap opens an awake click-through island without a renderer click',()=>{
 const source=read('island/main.js');const commands=[];
 const context={chatExpanded:false,pickerOpen:false,fileDialogs:0,islandWindow:{isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:0,y:0,width:940,height:750}),setIgnoreMouseEvents(){}},settings:{islandSize:'medium',visibility:'always',guiScale:100},SIZES:{medium:{width:216,height:32}},SETTINGS_WIDTH:900,SETTINGS_HEIGHT:716,TASKS_WIDTH:520,TASKS_HEIGHT:420,CHAT_WIDTH:520,CHAT_HEIGHT:352,currentPanelView:'chat',taskDetailExpanded:false,expanded:false,mouseIgnored:true,mascotSleeping:false,wakeClickUntil:0,shouldRecoverPointer:require('../src/island/pointer-open').shouldRecoverPointer,shouldShow:()=>true,captureUIBusy:()=>false,setExpanded:value=>{context.expanded=value;},emit:(...args)=>commands.push(args),performance:{now:()=>100},lastPointerTime:0,lastPointer:null,hoverVisible:false};
 Object.assign(context,{mediaPreviewKind:null,mediaPreviewHovered:false,MEDIA_PREVIEW_SIZE:{width:448,height:200,gutter:44},
  PLEX_PREVIEW_SIZE:{width:520,height:200,gutter:44}});
 vm.runInNewContext(source.slice(source.indexOf('function pollCursor('),source.indexOf('function onModifierEvent(')),context);
 context.pollCursor({x:470,y:16,button:'left'});
 assert.equal(context.expanded,true);assert.equal(context.mouseIgnored,false);
 assert.deepEqual(JSON.parse(JSON.stringify(commands.find(([name])=>name==='island:command'))),['island:command',{type:'pointer-open',x:470,y:16}]);
 context.expanded=false;commands.length=0;
 context.pollCursor({x:400,y:38,button:'left'});
 assert.equal(context.expanded,false);
 context.expanded=false;context.mouseIgnored=true;context.mediaPreviewKind='media';commands.length=0;
 context.pollCursor({x:485,y:175,button:'left'});
 assert.equal(context.expanded,false);assert.equal(context.mediaPreviewHovered,true);
 assert.deepEqual(JSON.parse(JSON.stringify(commands.filter(([name])=>name==='island:command'))),
  [['island:command',{type:'media-preview-pointer',x:485,y:175}]]);
 commands.length=0;
 context.pollCursor({x:485,y:175,button:'left'});
 assert.equal(commands.some(([name])=>name==='island:command'),false);
 context.pollCursor({x:255,y:90,button:'left'});
 assert.equal(context.mediaPreviewHovered,false);assert.equal(context.mouseIgnored,true);
 assert.deepEqual(commands.find(([name])=>name==='island:command'),['island:command','dismiss-media-preview']);
 context.mediaPreviewKind='plex';commands.length=0;
 context.pollCursor({x:675,y:30,button:'left'});
 assert.equal(context.expanded,false);assert.equal(context.mediaPreviewHovered,true);
 assert.deepEqual(JSON.parse(JSON.stringify(commands.find(([name])=>name==='island:command'))),
  ['island:command',{type:'media-preview-pointer',x:675,y:30}]);
});

test('the click following native tap opening does not collapse the panel again',()=>{
 const source=read('island/renderer/ui.js');let click,command,now=100;
 let settingsTab,target;
 const context={island:{addEventListener:(name,fn)=>{click=fn;},getBoundingClientRect:()=>({left:210,width:520,top:0})},api:{onCommand:fn=>{command=fn;}},document:{elementFromPoint:()=>target},openSettings:({tab})=>{settingsTab=tab;context.panelOpen=true;},performance:{now:()=>now},pointerOpenUntil:0,panelOpen:false,settings:{guiScale:100},setPanelOpen:value=>{context.panelOpen=value;},togglePanel:value=>{context.panelOpen=value;}};
 vm.runInNewContext(source.slice(source.indexOf("island.addEventListener('click',"),source.indexOf("island.addEventListener('mouseenter',")),context);
 vm.runInNewContext(source.slice(source.indexOf('api.onCommand(action=>'),source.indexOf('api.onState(next=>')),context);
 command({type:'pointer-open',x:470,y:16});
 click({target:{closest:()=>null},clientX:470,clientY:16});
 assert.equal(context.panelOpen,true);
 now=2000;click({target:{closest:()=>null},clientX:470,clientY:16});
 assert.equal(context.panelOpen,false);
 context.settings.guiScale=125;
 context.panelOpen=true;
 click({target:{closest:()=>null},clientX:425,clientY:48});
 assert.equal(context.panelOpen,false);
 target={closest:selector=>selector==='#island-info[data-update="true"]'?target:null};
 command({type:'pointer-open',x:405,y:15});
 assert.equal(settingsTab,'updates');
 click({target:{closest:()=>null},clientX:470,clientY:16});
 assert.equal(context.panelOpen,true);
});
