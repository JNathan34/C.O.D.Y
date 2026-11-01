'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installNativeIpc}=require('../src/native-ipc');
function setup(){
 const calls=[],handlers=new Map(),events=[],engine=new EventEmitter(),webContents={mainFrame:{}},state={enabled:false,level:'ask',readApps:true,extraUsage:false,workingFolder:null},data={settings:{computerControl:{enabled:false,level:'ask'}}};let fail=false;
 engine.request=async(command,args)=>{calls.push({command,args});if(fail)throw Error('Engine unavailable');if(command==='permissions-configure')Object.assign(state,args);return{...state};};
 const store={data,settings:patch=>Object.assign(data.settings,patch),setNativePermissions:value=>data.settings.nativePermissions=value},controller={permissions:()=>({...data.settings.computerControl}),configure:patch=>data.settings.computerControl={...data.settings.computerControl,...patch}};
 installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,controller,chooseWorkingFolder:async()=> 'C:\\Projects',sendUI:(...args)=>events.push(args),getState:()=>({}),getWindow:()=>({webContents})});
 return{state,data,calls,engine,handlers,webContents,fail:()=>fail=true,invoke:(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args)};
}
test('permission page reads the real backend and saves control mode to both controllers',async()=>{
 const f=setup();assert.equal((await f.invoke('computer-permissions')).native.readApps,true);await f.invoke('computer-configure',{enabled:true,level:'full'});assert.equal(f.state.enabled,true);assert.equal(f.state.level,'full');assert.equal(f.data.settings.computerControl.level,'full');assert.equal(f.state.extraUsage,false);
});
test('backend privacy and usage toggles are not mistaken for local tool categories',async()=>{
 const f=setup();await f.invoke('computer-configure',{readApps:false,extraUsage:false});assert.equal(f.state.readApps,false);assert.equal('readApps' in f.data.settings.computerControl,false);assert.equal(f.data.settings.nativePermissions.extraUsage,false);
});
test('failed native changes and invalid values cannot leave local permissions enabled',async()=>{
 const f=setup();await assert.rejects(f.invoke('computer-configure',{enabled:'yes'}),/Invalid/);assert.equal(f.calls.length,0);f.fail();await assert.rejects(f.invoke('computer-configure',{enabled:true}),/unavailable/);assert.equal(f.data.settings.computerControl.enabled,false);
});
test('emergency stop disables native and local control and stops the native drive',async()=>{
 const f=setup();await f.invoke('computer-configure',{enabled:true,level:'full'});await f.invoke('computer-emergency-stop');assert.equal(f.state.enabled,false);assert.equal(f.data.settings.computerControl.enabled,false);assert.ok(f.calls.some(c=>c.command==='drive-stop'));assert.ok(f.calls.some(c=>c.command==='cancel'));
});
test('working folder selection reaches the native background task workspace',async()=>{
 const f=setup();assert.equal(await f.invoke('browse-folder'),'C:\\Projects');assert.equal(f.state.workingFolder,'C:\\Projects');assert.equal(f.data.settings.workingFolder,'C:\\Projects');
});
test('untrusted child frames cannot change backend permissions',()=>{
 const f=setup();assert.throws(()=>f.handlers.get('computer-configure')({sender:f.webContents,senderFrame:{}},{enabled:true}),/Untrusted/);assert.equal(f.calls.length,0);
});
test('real settings store preserves native permission snapshots across other settings and reload',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{StateStore}=require('../src/store'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-permissions-'));
 try{const store=new StateStore(folder);store.setNativePermissions({enabled:true,level:'ask',readApps:true,extraUsage:false,workingFolder:null});store.settings({voiceAutoSpeak:true});assert.equal(store.data.settings.nativePermissions.readApps,true);assert.equal(new StateStore(folder).data.settings.nativePermissions.readApps,true);assert.throws(()=>store.setNativePermissions({enabled:true}),/Invalid/);store.settings({nativePermissions:{enabled:false}});assert.equal(store.data.settings.nativePermissions.enabled,true);}finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('custom mode validates and routes native permission switches without leaking them into local tools',async()=>{const f=setup();await f.invoke('computer-configure',{level:'custom',computerUse:false,backgroundTasks:true});assert.equal(f.state.level,'custom');assert.equal(f.state.computerUse,false);assert.equal(f.state.backgroundTasks,true);assert.equal('computerUse' in f.data.settings.computerControl,false);await assert.rejects(f.invoke('computer-configure',{computerUse:'yes'}),/Invalid/);});
test('custom permissions block disabled actions and survive presets and reload normalization',()=>{const {normalizePermissions,permissionError,needsApproval}=require('../src/control/policy');let p=normalizePermissions({enabled:true,level:'custom',clipboard:false,applications:true});assert.match(permissionError('clipboard.read',p),/disabled/);assert.equal(permissionError('app.open',p),null);assert.equal(needsApproval('app.open',p),false);p=normalizePermissions(p,{level:'full'});assert.equal(p.clipboard,true);p=normalizePermissions(p,{level:'custom'});assert.equal(p.clipboard,false);assert.equal(normalizePermissions(p).clipboard,false);});
