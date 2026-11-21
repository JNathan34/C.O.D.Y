'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {SubtitleOverlay}=require('../src/subtitles/overlay');

function fixture(){
  let caption='',visible=false;
  const screen=new EventEmitter();
  const display={workArea:{x:0,y:0,width:1920,height:1080}};
  screen.getCursorScreenPoint=()=>({x:0,y:0});
  screen.getDisplayNearestPoint=()=>display;
  screen.getDisplayMatching=()=>display;
  const overlay=new SubtitleOverlay({screen});
  overlay.window={
    isVisible:()=>visible,showInactive:()=>{visible=true;},hide:()=>{visible=false;},
    getBounds:()=>display.workArea,setBounds(){},destroy(){},webContents:{send:(_,text)=>{caption=text;}}
  };
  overlay.ready=true;
  overlay.setEnabled(true);
  return {overlay,caption:()=>caption,visible:()=>visible};
}

test('the full spoken line remains until playback ends or the next line starts',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {overlay,caption,visible}=fixture();
  const line='This is a complete caption long enough to have wrapped onto several separate caption pages under the old timer.';
  overlay.show({text:line,playing:true});
  t.mock.timers.tick(30000);
  assert.equal(caption(),line);
  assert.equal(visible(),true);
  overlay.show({text:'The next line',playing:true});
  assert.equal(caption(),'The next line');
  overlay.finishSpeech();
  assert.equal(caption(),'');
  assert.equal(visible(),false);
  overlay.close();
});

test('a reading-only caption can follow audio and keeps its reading timer',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {overlay,caption,visible}=fixture();
  overlay.show({text:'Audio still playing',playing:true});
  overlay.show({text:'Reading-time minimum',seconds:0.5});
  assert.equal(caption(),'Audio still playing');
  overlay.finishSpeech();
  assert.equal(caption(),'Reading-time minimum');
  overlay.finishSpeech();
  t.mock.timers.tick(1599);
  assert.equal(visible(),true);
  t.mock.timers.tick(1);
  assert.equal(visible(),false);
  assert.equal(caption(),'');
  overlay.close();
});
