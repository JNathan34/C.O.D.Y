'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
app.setPath('userData',path.resolve(__dirname,'../reports/model-viewport-profile'));
const engine=new NativeEngine(),results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));let fixture=false;
const state=()=>engine.request('model-zoom-state');
async function until(predicate){let value;for(let i=0;i<100;i++){value=await state();if(value.error)throw Error(value.error);if(predicate(value))return value;await wait(100);}throw Error('Viewport verification timed out: '+JSON.stringify(value));}
app.whenReady().then(async()=>{
 try{
  await engine.refresh();await engine.request('model-zoom-demo',{streaming:true});fixture=true;
  await until(s=>s.figures.length===1&&s.figures[0].viewport);await wait(1800);
  let value=await state();let figure=value.figures[0];
  assert.ok(figure.viewport.Width>0&&figure.viewport.Height>0,JSON.stringify(figure));results.push({check:'model composition and input are constrained to the rendered window content',viewport:figure.viewport});
  assert.equal(figure.layout.clipped,true);assert.ok(figure.layout.clip.width>0);
  const close=figure.layout.close;assert.ok(close,JSON.stringify(figure));
  assert.ok(Math.abs(close.x+close.width-(figure.viewport.Right+1))<1,JSON.stringify({close,viewport:figure.viewport}));
  assert.ok(Math.abs(close.y+close.height-figure.viewport.Y)<1,JSON.stringify({close,viewport:figure.viewport}));
  results.push('close button sits at the right edge of the visible title bar');
  const baseline=figure.cameraDistance;
  await engine.request('model-zoom-test',{handle:figure.handle,delta:1200});await engine.request('model-zoom-test',{handle:figure.handle,delta:1200});await engine.request('model-zoom-test',{handle:figure.handle,delta:1200});
  value=await until(s=>s.figures[0]?.initialized&&!s.figures[0]?.animating);figure=value.figures[0];
  assert.ok(Math.abs(figure.cameraDistance-baseline*.1)<.002,JSON.stringify(figure));results.push('native camera reaches 10x magnification');
  assert.deepEqual(figure.viewport,results[0].viewport);results.push('zoom keeps the content boundary fixed');
  const controls=await engine.request('drawing-controls-state');assert.ok(controls.closeButtons>0,JSON.stringify(controls));assert.equal(controls.error,null);results.push('title-bar close control remains available');
  const start={x:Math.round(figure.bounds.x+figure.bounds.width/2),y:Math.round(figure.bounds.y+figure.bounds.height/2)};
  assert.equal((await engine.request('model-drag-test',{action:'down',...start,ctrl:true})).accepted,true);
  await engine.request('model-drag-test',{action:'move',x:start.x+90,y:start.y+60,ctrl:true});
  await engine.request('model-drag-test',{action:'up',x:start.x+90,y:start.y+60,ctrl:true});
  value=await until(s=>s.figures[0]?.viewport?.X>figure.viewport.X+10);figure=value.figures[0];
  assert.equal(figure.layout.clipped,true);assert.ok(Math.abs(figure.layout.close.x+figure.layout.close.width-figure.viewport.Right-1)<1);
  results.push('moving the window moves its clipping boundary and close button together');
  await engine.request('drawing-controls-test-close');await until(s=>s.figures.length===0);results.push('close removes the window and model');
 }catch(error){results.push({error:error.stack});process.exitCode=1;}
 finally{
  if(fixture)await engine.request('model-zoom-demo-clear').catch(()=>{});
  fs.writeFileSync(path.resolve(__dirname,'../reports/model-viewport.json'),JSON.stringify({passed:!process.exitCode,results},null,2));
  engine.close();await wait(600);app.exit(process.exitCode||0);
 }
});
