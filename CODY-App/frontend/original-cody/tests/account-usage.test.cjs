'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {codexUsage,readCodexUsage}=require('../src/account-usage');
const {CodexClient}=require('../src/codex-client');
const {installNativeIpc}=require('../src/native-ipc');
test('Codex uses the codex bucket and actual window durations, percentages and reset timestamps',()=>{
 const result=codexUsage({rateLimitsByLimitId:{codex:{planType:'plus',primary:{usedPercent:60,windowDurationMins:10080,resetsAt:1800000000},secondary:{usedPercent:25,windowDurationMins:300,resetsAt:1799999999}},other:{primary:{usedPercent:99}}}});
 assert.equal(result.plan,'plus');assert.deepEqual(result.windows.map(w=>[w.label,w.usedPercent,w.remainingPercent]),[['5-hour limit',25,75],['Weekly limit',60,40]]);assert.equal(result.windows[0].resetsAt,new Date(1799999999000).toISOString());
});
test('Codex accepts weekly-only accounts and never invents missing usage',()=>{
 assert.equal(codexUsage({rateLimits:{primary:{usedPercent:3,windowDurationMins:10080},secondary:null}}).windows[0].label,'Weekly limit');
 assert.equal(codexUsage({}).available,false);assert.deepEqual(codexUsage({rateLimits:{primary:{}}}).windows,[]);
});
test('signed-out and API-key-only accounts never request ChatGPT limits',async()=>{
 for(const account of [null,{type:'apiKey'}]){
  let reads=0;const result=await readCodexUsage({start:async()=>{},account:async()=>({account}),rateLimits:async()=>{reads++;}});
  assert.equal(result.available,false);assert.equal(reads,0);
 }
});
test('account-only Codex connections reject work and authentication mutations',async()=>{
 const client=new CodexClient({accountOnly:true});
 for(const method of ['thread/start','turn/start','account/login/start','account/logout'])await assert.rejects(client.request(method),/only reads account usage/);
});
function ipcFixture(){
 const handlers=new Map(),engine=new EventEmitter(),webContents={mainFrame:{}},calls=[];let busy=false;
 engine.status={state:'Idle'};engine.request=async command=>{calls.push(command);return {started:true};};
 const binding=installNativeIpc({ipcMain:{removeHandler(){},handle:(key,fn)=>handlers.set(key,fn)},engine,store:{data:{chats:[],settings:{}}},getWindow:()=>({webContents}),sendUI(){},externalBusy:()=>busy,codexUsage:async()=>({available:true,windows:[]})});
 return {calls,binding,busy:value=>busy=value,invoke:(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args),handlers};
}
test('Claude Code account controls route only sign-in/out and block active work',async()=>{
 const f=ipcFixture();await f.invoke('claude-account','signIn');await f.invoke('claude-account','signOut');assert.deepEqual(f.calls,['signIn','signOut']);
 await assert.rejects(f.invoke('claude-account','resetAllData'),/Invalid/);f.busy(true);await assert.rejects(f.invoke('claude-account','signOut'),/Finish/);assert.equal(f.calls.length,2);
 assert.throws(()=>f.handlers.get('claude-account')({sender:{},senderFrame:{}},'signOut'),/Untrusted/);
});
