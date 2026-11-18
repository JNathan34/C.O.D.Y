'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {focusOrLaunchApp}=require('../src/control/app-layout');
const {IslandUtilities}=require('../src/island-utilities');
test('focus-or-launch requires positive foreground verification',async()=>{
 const ok={app:'spotify',pid:123,focused:true,reused:true,launched:false};let calls=0;
 const runner=async script=>{calls++;assert.match(script,/-Mode focus/);return JSON.stringify(ok)};
 assert.deepEqual(await focusOrLaunchApp('spotify',{runner}),ok);assert.equal(calls,1);
 for(const invalid of [{...ok,focused:false},{...ok,pid:0},{...ok,app:'firefox'},'Started Spotify'])
  await assert.rejects(focusOrLaunchApp('spotify',{runner:async()=>typeof invalid==='string'?invalid:JSON.stringify(invalid)}),/confirm|report|verify/);
});
test('reject unsupported applications before launching any process',async()=>{
 let called=false;
 await assert.rejects(focusOrLaunchApp('custom-injected-command',{runner:()=>{called=true}}),/supported/);
 assert.equal(called,false);
});
test('Island truthfully reports reused apps without claiming a new launch',async()=>{
 const shown=[],util=new IslandUtilities({controller:{execute:async()=>({ok:true,result:{app:'spotify',focused:true,reused:true}})},showCard:x=>shown.push(x)});
 const result=await util.run('open Spotify');
 assert.match(result.reply,/existing Spotify window/);assert.equal(shown[0].text,'Focused');
});
