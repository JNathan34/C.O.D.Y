'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
function setup(){
  const engine=new EventEmitter(),calls=[],events=[],handlers=new Map(),webContents={mainFrame:{}},shown=[];
  engine.request=async(command,args)=>{calls.push({command,args});return command==='approval-state'?[{id:'one',reason:'Control request',command:'Open Calculator'}]:{answered:true};};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store:{},sendUI:(...args)=>events.push(args),getState:()=>({}),getWindow:()=>({webContents}),showApprovals:()=>shown.push(true)});
  return {engine,calls,events,shown,invoke:(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args),handlers,webContents};
}
test('native consent snapshots surface the Island and empty/closed snapshots clear it',()=>{
  const {engine,events,shown}=setup();engine.emit('computer-approvals',[{id:'one'}]);assert.equal(shown.length,1);assert.deepEqual(events.at(-1),['computer-approvals',[{id:'one'}]]);
  engine.emit('computer-approvals',[]);assert.equal(shown.length,1);engine.emit('offline');assert.deepEqual(events.at(-1),['computer-approvals',[]]);
});
test('allow and deny are passed to the exact native request without implicit approval',async()=>{
  const {invoke,calls}=setup();const state=await invoke('computer-approval-state');assert.equal(state[0].id,'one');assert.equal(calls.some(call=>call.command==='approval-decision'),false);
  await invoke('computer-approval-decision','one','decline');await invoke('computer-approval-decision','two','accept');
  assert.deepEqual(calls.slice(1),[{command:'approval-decision',args:{approvalId:'one',decision:'decline'}},{command:'approval-decision',args:{approvalId:'two',decision:'accept'}}]);
});
test('untrusted frames and invalid approval values cannot answer a request',async()=>{
  const {invoke,calls,handlers,webContents}=setup();
  assert.throws(()=>handlers.get('computer-approval-decision')({sender:webContents,senderFrame:{}},'one','accept'),/Untrusted/);
  await assert.rejects(invoke('computer-approval-decision','one','always'),/Invalid/);assert.equal(calls.length,0);
});
