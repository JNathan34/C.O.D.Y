'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {AnnotationManager}=require('../src/annotations/manager');
const {AnnotationOverlay}=require('../src/annotations/overlay');
const main=readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const island=readFileSync(path.join(__dirname,'../src/island/main.js'),'utf8');

test('global clear destroys CODY annotation windows on both displays and calls the native 2D clear',async()=>{
  const overlay=new AnnotationOverlay({ipcMain:new EventEmitter()});
  const destroyed=[];
  for(const id of [1,2])overlay.windows.set(id,{window:{isDestroyed:()=>false,hide(){},destroy:()=>destroyed.push(id)}});
  const annotations=new AnnotationManager({overlay});
  annotations.items.set('demo',{});
  const nativeCalls=[];
  const nativeEngine={connected:true,request:async name=>nativeCalls.push(name)};
  let listener;
  const start=main.indexOf('  let clearingNativeDrawing=false;');
  const end=main.indexOf('  const resetVisuals=',start);
  vm.runInNewContext(main.slice(start,end),{annotations,nativeEngine,island:{onClearDrawings:value=>{listener=value;}}});
  const begin=island.indexOf('function handleHotkey('),finish=island.indexOf('module.exports=',begin);
  const context=vm.createContext({clearDrawingsListener:listener});
  vm.runInContext(island.slice(begin,finish),context);
  context.handleHotkey('clear-drawings');
  context.handleHotkey('clear-drawings');
  assert.deepEqual(destroyed,[1,2]);
  assert.equal(annotations.items.size,0);
  assert.equal(overlay.windows.size,0);
  assert.deepEqual(nativeCalls,['clear-2d-drawings']);
  await new Promise(resolve=>setImmediate(resolve));
  nativeEngine.connected=false;
  assert.doesNotThrow(()=>context.handleHotkey('clear-drawings'));
  assert.deepEqual(nativeCalls,['clear-2d-drawings']);
  overlay.close();
});

test('Ctrl+Alt+X is registered as a true global hotkey, independent of focus',()=>{
  // The existing integration test exercises the complete clear command above;
  // guard its global registration and cleanup so it cannot regress to a
  // C.O.D.Y.-focused keyboard listener.
  assert.match(island,/globalShortcut\.register\('Control\+Alt\+X',\(\)=>handleHotkey\('clear-drawings'\)\)/);
  assert.match(island,/globalShortcut\.unregister\('Control\+Alt\+X'\)/);
  assert.match(island,/clearDrawingsShortcutRegistered=globalShortcut\.register/);
});
