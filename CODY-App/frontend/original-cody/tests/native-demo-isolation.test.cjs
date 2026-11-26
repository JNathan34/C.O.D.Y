'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('native integration cannot replace local demo buttons with billable AI requests',()=>{const {EventEmitter}=require('node:events'),{installNativeIpc}=require('../src/native-ipc'),handlers=new Set(),engine=new EventEmitter();installNativeIpc({ipcMain:{removeHandler(){},handle:name=>handlers.add(name)},engine,store:{data:{chats:[],settings:{}}},sendUI(){},getState:()=>({}),getWindow:()=>null});assert.equal(handlers.has('annotations-demo'),false);assert.equal(handlers.has('visuals-demo'),false);});
