'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {AnnotationOverlay}=require('../src/annotations/overlay'),{SceneWindow}=require('../src/visuals/window');
function windowStub(){return {visible:true,protection:[],isVisible(){return this.visible;},isDestroyed(){return false;},hide(){this.visible=false;},showInactive(){this.visible=true;},moveTop(){},setContentProtection(value){this.protection.push(value);}};}
for(const include of [false,true]){
 test(`annotations remain recordable after an AI screenshot (include=${include})`,async()=>{
  const overlay=new AnnotationOverlay({ipcMain:new EventEmitter()}),window=windowStub();overlay.windows.set('1',{window});overlay.lastScene=[{id:'shape'}];
  await overlay.withoutAnnotations(async()=>assert.equal(window.visible,include),{includeAnnotations:include});
  assert.equal(window.visible,true);assert.ok(window.protection.every(value=>value===false));
 });
 test(`3D remains recordable after an AI screenshot (include=${include})`,async()=>{
  const scene=new SceneWindow({ipcMain:new EventEmitter()}),window=windowStub();scene.window=window;
  await scene.withoutVisuals(async()=>assert.equal(window.visible,include),include);
  assert.equal(window.visible,true);assert.ok(window.protection.every(value=>value===false));
 });
}
