'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {UpdateService,registerUpdateIpc,RELEASES_URL}=require('../src/updates');
function fixture(options={}){
  const client=new EventEmitter();let checks=0,downloads=0;const installs=[];
  client.checkForUpdates=async()=>{checks++;client.emit('update-available',{version:'0.16.0'});};
  client.downloadUpdate=async()=>{downloads++;client.emit('download-progress',{percent:50});client.emit('update-downloaded',{version:'0.16.0'});};
  client.quitAndInstall=(...args)=>installs.push(args);
  const service=new UpdateService({version:'0.15.0',packaged:true,platform:'win32',createUpdater:()=>client,...options});
  return {service,client,installs,calls:()=>({checks,downloads,installs:installs.length})};
}
test('one explicit update action downloads, silently installs and relaunches',async()=>{
  const {service,client,calls,installs}=fixture();await service.check();
  assert.equal(service.snapshot().status,'available');assert.equal(service.snapshot().availableVersion,'0.16.0');
  assert.equal(client.autoDownload,false);assert.equal(client.autoInstallOnAppQuit,false);assert.equal(client.allowDowngrade,false);assert.equal(client.allowPrerelease,false);
  assert.equal(client.disableDifferentialDownload,false);
  assert.deepEqual(calls(),{checks:1,downloads:0,installs:0});
  const result=await service.apply();assert.equal(result.status,'installing');assert.equal(result.progress,100);
  assert.deepEqual(calls(),{checks:1,downloads:1,installs:1});assert.deepEqual(installs,[[true,true]]);
});
test('development and non-Windows builds cannot replace the working copy',async()=>{
  for(const options of [{packaged:false},{platform:'linux'}]){
    const {service,calls}=fixture(options);service.start();await service.check();
    await assert.rejects(service.apply(),/Check for/);
    assert.deepEqual(calls(),{checks:0,downloads:0,installs:0});assert.equal(service.startTimer,undefined);service.close();
  }
});
test('active recording or work blocks restart while preserving downloaded update',async()=>{
  let busy=false;
  const {service,client,calls}=fixture({installBlocked:()=>busy});
  client.on('update-downloaded',()=>{busy=true;});
  await service.check();const waiting=await service.apply();
  assert.match(waiting.error,/Finish the current task/);assert.equal(waiting.status,'ready');assert.equal(calls().installs,0);
  const blocked=await service.apply();assert.equal(blocked.status,'ready');assert.equal(calls().installs,0);
  busy=false;assert.equal((await service.apply()).status,'installing');assert.equal(calls().downloads,1);
});
test('checks and repeated update actions do not overlap a download or start the installer twice',async()=>{
  const {service,client,calls}=fixture();let finish;
  client.checkForUpdates=()=>new Promise(resolve=>{finish=resolve;});
  const pending=service.check();assert.equal(service.snapshot().status,'checking');await service.check();
  client.emit('update-available',{version:'0.16.0'});finish();await pending;
  let complete;client.downloadUpdate=()=>new Promise(resolve=>{complete=resolve;});const update=service.apply();
  await service.check();assert.equal((await service.apply()).status,'downloading');
  client.emit('update-downloaded',{version:'0.16.0'});assert.equal((await service.apply()).status,'downloading');
  complete();await update;await service.check();await service.apply();
  assert.equal(service.snapshot().status,'installing');assert.equal(calls().installs,1);
});
test('network errors and missing releases remain retryable',async()=>{
  const {service,client}=fixture();client.checkForUpdates=async()=>{throw Object.assign(Error('not found'),{code:'ERR_UPDATER_NO_PUBLISHED_VERSIONS'});};
  await service.check();assert.equal(service.snapshot().status,'error');assert.match(service.snapshot().error,/No update package/);
  client.checkForUpdates=async()=>{client.emit('update-not-available',{});};await service.check();assert.equal(service.snapshot().status,'current');assert.equal(service.snapshot().error,null);
  client.emit('error',Error('offline'));assert.equal(service.snapshot().status,'error');assert.equal(service.snapshot().error,'offline');
});
test('failed download does not become installable',async()=>{
  const {service,client,calls}=fixture();await service.check();client.downloadUpdate=async()=>{throw Error('checksum mismatch');};
  const error=await service.apply();assert.equal(error.status,'error');assert.equal(error.error,'checksum mismatch');assert.equal(calls().installs,0);
});
test('an installer launch error leaves the verified download ready to retry',async()=>{
  const {service,client,calls}=fixture();const install=client.quitAndInstall;
  client.quitAndInstall=()=>{client.emit('error',Error('Installer did not start'));};
  await service.check();const waiting=await service.apply();
  assert.equal(waiting.status,'ready');assert.equal(waiting.error,'Installer did not start');
  client.quitAndInstall=install;
  assert.equal((await service.apply()).status,'installing');assert.equal(calls().downloads,1);
});
test('automatic check preference persists and stops timers',()=>{
  let saved;const {service}=fixture({saveEnabled:value=>{saved=value;}});service.start();assert.ok(service.startTimer);assert.ok(service.checkTimer);
  service.configure(false);assert.equal(saved,false);assert.equal(service.snapshot().enabled,false);assert.ok(service.startTimer._destroyed);assert.ok(service.checkTimer._destroyed);
  assert.throws(()=>service.configure('yes'),/Invalid/);service.close();
});
test('updater IPC accepts only the main local UI frame and a fixed releases URL',async()=>{
  const {service}=fixture(),handlers=new Map(),opened=[];const webContents={mainFrame:{}};
  registerUpdateIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},updates:service,getWindow:()=>({webContents}),shell:{openExternal:url=>opened.push(url)}});
  for(const handler of handlers.values())assert.throws(()=>handler({sender:{},senderFrame:{}}),/Untrusted/);
  assert.throws(()=>handlers.get('updates-check')({sender:webContents,senderFrame:{}}),/Untrusted/);
  const event={sender:webContents,senderFrame:webContents.mainFrame};await handlers.get('updates-check')(event);
  assert.equal(handlers.get('updates-state')(event).status,'available');handlers.get('updates-releases')(event,'https://untrusted.example');assert.deepEqual(opened,[RELEASES_URL]);
});
