'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const profile=path.resolve(__dirname,'../reports/persistent-models-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const engine=new NativeEngine(),results=[];let fixture=false;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>engine.request('drawing-controls-state');
async function until(predicate){let value;for(let index=0;index<100;index++){value=await state();if(value.error)throw Error(value.error);if(predicate(value))return value;await wait(100);}throw Error('Persistent model check timed out: '+JSON.stringify(value));}
app.whenReady().then(async()=>{
 try{
  await engine.refresh();await engine.request('model-zoom-demo',{streaming:true});fixture=true;
  await until(value=>value.streaming&&value.models>0&&value.closeButtons>0);
  await engine.request('drawing-controls-test-screen-change',{reason:'app switch'});await wait(250);assert.ok((await state()).models>0);
  results.push('switching apps during generation preserves the model');
  await engine.request('drawing-controls-test-finish');await until(value=>!value.streaming&&value.models>0);
  for(let repeat=0;repeat<2;repeat++)for(const reason of ['click','app switch','space change','scroll']){
   await engine.request('drawing-controls-test-screen-change',{reason});await wait(250);const value=await state();assert.ok(value.showing&&value.models>0,'Model disappeared after '+reason);
  }
  results.push('finished model survives repeated clicks, app switches, space changes and scrolling');
  await engine.request('drawing-controls-test-close');await until(value=>value.models===0);await wait(750);assert.equal((await state()).models,0);results.push('X removes the model and it stays removed');
  await engine.request('model-zoom-demo-clear');fixture=false;
  await engine.request('model-zoom-demo');fixture=true;await until(value=>value.models>0);
  await engine.request('model-zoom-demo-clear');fixture=false;await until(value=>!value.showing&&value.models===0);results.push('Clear removes the model');
  console.log(JSON.stringify({passed:true,results}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{if(fixture)await engine.request('model-zoom-demo-clear').catch(()=>{});fs.writeFileSync(path.resolve(__dirname,'../reports/persistent-models.json'),JSON.stringify({passed:!app.exitCode,results},null,2));engine.close();await wait(600);app.exit(app.exitCode||0);}
});
