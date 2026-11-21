'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MonitorAccess}=require('../src/monitor-access');
const {ScreenCapture}=require('../src/screen-capture');

function fixture(){
  const left={id:'left',identified:true,x:-1920,y:0,width:1920,height:1080};
  const right={id:'right',identified:true,primary:true,x:0,y:0,width:2560,height:1440};
  const screen={
    getAllDisplays:()=>[{id:7,bounds:left},{id:12,bounds:right}],
    getPrimaryDisplay:()=>({id:12,bounds:right}),
    screenToDipPoint:point=>point,
    dipToScreenRect:(_,bounds)=>bounds
  };
  const state={mainId:'left',allowedIds:['left'],displays:[right,left]};
  const access=new MonitorAccess({screen,engine:{request:async()=>state}});
  return {screen,access,state,left,right};
}

test('the selected main monitor limits screenshots and screen coordinates independently of Windows primary',async()=>{
  const {access}=fixture();
  await access.refresh();
  assert.equal(access.requireDisplay().id,7);
  assert.throws(()=>access.requireDisplay(12),/blocked/);
  assert.deepEqual(access.all().map(display=>display.id),[7]);
  assert.equal(access.allowsPhysicalPoint({x:-100,y:100}),true);
  assert.equal(access.allowsPhysicalPoint({x:0,y:100}),false);
  assert.equal(access.allowsPhysicalRect({x:-50,y:100,width:100,height:100}),false);
});

test('a missing or unidentified allowed display never falls back to a blocked display',async()=>{
  const {access,state,left,right}=fixture();
  await access.refresh();
  state.displays=[right];
  assert.equal(access.primary(),null);
  state.displays=[right,{...left,identified:false}];
  assert.throws(()=>access.requireDisplay(),/blocked/);
  state.allowedIds=null;
  state.displays=[right];
  assert.equal(access.requireDisplay().id,12);
});

test('restricted screenshot selection never falls back to the only available capture source',async()=>{
  const {access,screen}=fixture();
  const capture=new ScreenCapture({screen,monitorAccess:access,ipcMain:{handle(){},on(){}},desktopCapturer:{
    getSources:async({thumbnailSize})=>{assert.deepEqual(thumbnailSize,{width:0,height:0});return [{id:'screen:12:0',display_id:'12'}];}
  }});
  await assert.rejects(capture.source(),/unavailable/);
});
