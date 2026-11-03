'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const profile=path.resolve(__dirname,'../reports/generating-controls-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const engine=new NativeEngine(),results=[];let fixture=false;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){let state;for(let index=0;index<80;index++){state=await engine.request('drawing-controls-state');if(state.error)throw Error(state.error);if(predicate(state))return state;await wait(100);}throw Error('Generating drawing controls timed out: '+JSON.stringify(state));}
app.whenReady().then(async()=>{
 try{
  await engine.refresh();
  await engine.request('drawing-controls-test-empty');fixture=true;await wait(600);
  const empty=await engine.request('drawing-controls-state');assert.equal(empty.renderedUnits,0);assert.equal(empty.models,0);assert.equal(empty.clearVisible,false);results.push({check:'narration without a drawing never shows Clear',state:empty});
  await engine.request('drawing-controls-test-finish');await wait(300);assert.equal((await engine.request('drawing-controls-state')).clearVisible,false);
  await engine.request('model-zoom-demo-clear');fixture=false;
  await engine.request('model-zoom-demo',{streaming:true});fixture=true;
  const generating=await until(state=>state.streaming&&state.clearVisible&&state.revealed>0);
  assert.ok(generating.closeButtons>0);results.push({check:'Clear and model X visible before Finish',state:generating});
  await engine.request('drawing-controls-test-empty');await wait(600);const replaced=await engine.request('drawing-controls-state');assert.equal(replaced.clearVisible,false);results.push({check:'a new empty response hides the previous Clear button',state:replaced});
  await engine.request('model-zoom-demo-clear');fixture=false;await engine.request('model-zoom-demo',{streaming:true});fixture=true;await until(state=>state.clearVisible&&state.closeButtons>0);
  await engine.request('drawing-controls-test-close');const closed=await until(state=>state.streaming&&state.shown===0&&(state.models>0||!state.clearVisible));results.push({check:'closing a card keeps Clear only if a live model remains',state:closed});
  await engine.request('model-zoom-demo-clear');fixture=false;const cleared=await until(state=>!state.showing&&!state.clearVisible&&state.shown===0);results.push({check:'clear removes controls and model',state:cleared});
  await engine.request('drawing-controls-test-card');fixture=true;await until(state=>state.clearVisible&&state.closeButtons>0&&state.renderedUnits>0);
  await engine.request('drawing-controls-test-close');const cardClosed=await until(state=>state.shown===0&&state.renderedUnits>0&&state.clearVisible);results.push({check:'closing a card retains Clear for an independent screen annotation that remains visible',state:cardClosed});
  await engine.request('model-zoom-demo-clear');fixture=false;const lastCleared=await until(state=>!state.clearVisible&&state.renderedUnits===0&&state.models===0);results.push({check:'clearing the remaining 2D annotation hides Clear',state:lastCleared});
  console.log(JSON.stringify({passed:true,results}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{if(fixture)await engine.request('model-zoom-demo-clear').catch(()=>{});fs.writeFileSync(path.resolve(__dirname,'../reports/generating-controls.json'),JSON.stringify({passed:!app.exitCode,results},null,2));engine.close();await wait(600);app.exit(app.exitCode||0);}
});
