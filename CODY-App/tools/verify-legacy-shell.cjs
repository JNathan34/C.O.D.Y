'use strict';
// Isolated profile: no user accounts, task deletion or pointer movement.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const profile=path.resolve(__dirname,'../reports/legacy-shell-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const engine=new NativeEngine();
app.whenReady().then(async()=>{
 try{
  await engine.refresh();
  const before=await engine.request('tasks-state');assert.ok(Array.isArray(before.tasks));
  for(let i=0;i<4;i++){
   const state=await engine.request('legacy-shell-test');
   assert.deepEqual(state,{allowed:false,visible:false,pointerActive:false});
   await new Promise(resolve=>setTimeout(resolve,300));
  }
  const after=await engine.request('tasks-state');assert.deepEqual(after.tasks.map(task=>task.id),before.tasks.map(task=>task.id));
  console.log('PASS: native task dock remains hidden and its hover listener stays stopped after repeated eligible-state refreshes and direct reopen attempts.');
 }catch(error){console.error(error);app.exitCode=1;}
 finally{engine.close();await new Promise(resolve=>setTimeout(resolve,600));app.exit(app.exitCode||0);}
});
