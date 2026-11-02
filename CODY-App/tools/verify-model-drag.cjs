'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const profile=path.resolve(__dirname,'../reports/model-drag-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const engine=new NativeEngine(),results=[];let fixture=false;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const zoom=()=>engine.request('model-zoom-state');
async function until(predicate){let state;for(let n=0;n<100;n++){state=await zoom();if(state.error)throw Error(state.error);const drag=await engine.request('model-drag-state');if(drag.error)throw Error(drag.error);if(predicate(state))return state;await wait(100);}throw Error('Drag check timed out: '+JSON.stringify(state));}
const centre=figure=>({x:Math.round(figure.bounds.x+figure.bounds.width/2),y:Math.round(figure.bounds.y+figure.bounds.height/2)});
const mouse=(action,point,ctrl=true)=>engine.request('model-drag-test',{action,...point,ctrl});
app.whenReady().then(async()=>{
 try{
  await engine.refresh();await engine.request('model-zoom-demo');fixture=true;
  await until(value=>value.figures.length===1);await wait(1800);
  let state=await zoom(),figure=state.figures[0],start=centre(figure),baseline=figure.cameraDistance;
  assert.equal((await mouse('down',start,false)).accepted,false);assert.equal((await mouse('down',{x:0,y:0})).accepted,false);results.push('plain dragging and clicks outside a model are not intercepted');
  assert.equal((await mouse('down',start)).accepted,true);assert.equal((await mouse('move',{x:start.x+180,y:start.y+90})).accepted,true);await wait(150);assert.equal((await mouse('up',{x:start.x+180,y:start.y+90},false)).accepted,true);
  state=await until(value=>value.figures[0]?.translation.x>20&&value.figures[0]?.translation.y>10);figure=state.figures[0];assert.equal(figure.rotating,false);assert.ok(Math.abs(figure.cameraDistance-baseline)<0.001,JSON.stringify({baseline,camera:figure.cameraDistance}));results.push({check:'Ctrl-drag moves a transparent model without rotating or zooming it',translation:figure.translation});
  const moved=figure.translation;await wait(700);figure=(await zoom()).figures[0];assert.ok(Math.abs(figure.translation.x-moved.x)<0.01);assert.equal((await mouse('move',{x:0,y:0})).accepted,false);results.push('placement stays after release and moves without a drag are ignored');
  const point=centre(figure);assert.equal((await engine.request('model-zoom-point-test',{...point,delta:120})).accepted,true);await until(value=>value.figures[0]?.initialized&&!value.figures[0]?.animating);figure=(await zoom()).figures[0];assert.ok(figure.cameraDistance<baseline);assert.ok(Math.abs(figure.translation.x-moved.x)<0.01);results.push('scroll zoom works at the moved model and retains placement');
  assert.equal((await mouse('down',centre(figure))).accepted,true);await mouse('move',{x:-50000,y:-50000});await mouse('up',{x:-50000,y:-50000});state=await until(value=>value.figures[0]?.translation.x<0&&value.figures[0]?.bounds.x+value.figures[0]?.bounds.width>0&&value.figures[0]?.bounds.y+value.figures[0]?.bounds.height>0);results.push('dragging beyond the screen keeps a recoverable part visible');
  await engine.request('model-zoom-demo-clear');fixture=false;await until(value=>value.figures.length===0);
  await engine.request('model-zoom-demo',{streaming:true});fixture=true;state=await until(value=>value.figures.length===1);figure=state.figures[0];start=centre(figure);
  assert.equal((await mouse('down',start)).accepted,true);await mouse('move',{x:start.x+80,y:start.y+60});await mouse('up',{x:start.x+80,y:start.y+60});await until(value=>value.figures[0]?.translation.x>10);results.push('Ctrl-drag also moves models with a background during generation');
  await engine.request('drawing-controls-test-finish');await engine.request('drawing-controls-test-close');await until(value=>value.figures.length===0);results.push('X still closes a moved model with a background');
  await engine.request('model-zoom-demo-clear');fixture=false;await engine.request('model-zoom-demo');fixture=true;await until(value=>value.figures.length===1);figure=(await zoom()).figures[0];
  await mouse('down',centre(figure));await engine.request('model-zoom-demo-clear');fixture=false;await mouse('move',{x:400,y:400});await mouse('up',{x:400,y:400});await until(value=>value.figures.length===0);results.push('clearing during a drag does not restore the model');
  console.log(JSON.stringify({passed:true,results}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{if(fixture)await engine.request('model-zoom-demo-clear').catch(()=>{});fs.writeFileSync(path.resolve(__dirname,'../reports/model-drag.json'),JSON.stringify({passed:!app.exitCode,results},null,2));engine.close();await wait(600);app.exit(app.exitCode||0);}
});
