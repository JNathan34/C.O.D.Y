'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {UpdateService,registerUpdateIpc,RELEASES_URL}=require('../src/updates');
function fixture(options={}){
  const client=new EventEmitter();let checks=0,downloads=0,installs=0;
  client.checkForUpdates=async()=>{checks++;client.emit('update-available',{version:'0.16.0'});};
  client.downloadUpdate=async()=>{downloads++;client.emit('download-progress',{percent:50});client.emit('update-downloaded',{version:'0.16.0'});};
  client.quitAndInstall=()=>{installs++;};
  const service=new UpdateService({version:'0.15.0',packaged:true,platform:'win32',createUpdater:()=>client,...options});
  return {service,client,calls:()=>({checks,downloads,installs})};
}
test('GitHub update requires an explicit download and install',async()=>{
  const {service,client,calls}=fixture();await service.check();
  assert.equal(service.snapshot().status,'available');assert.equal(service.snapshot().availableVersion,'0.16.0');
  assert.equal(client.autoDownload,false);assert.equal(client.autoInstallOnAppQuit,false);assert.equal(client.allowDowngrade,false);assert.equal(client.allowPrerelease,false);
  assert.deepEqual(calls(),{checks:1,downloads:0,installs:0});
  await service.download();assert.equal(service.snapshot().status,'ready');assert.equal(service.snapshot().progress,100);
  service.install();assert.deepEqual(calls(),{checks:1,downloads:1,installs:1});assert.equal(service.snapshot().status,'installing');
});
test('development and non-Windows builds cannot replace the working copy',async()=>{
  for(const options of [{packaged:false},{platform:'linux'}]){
    const {service,calls}=fixture(options);service.start();await service.check();
    await assert.rejects(service.download(),/Check for/);assert.throws(()=>service.install(),/Download/);
    assert.deepEqual(calls(),{checks:0,downloads:0,installs:0});assert.equal(service.startTimer,undefined);service.close();
  }
});
test('active recording or work blocks restart while preserving downloaded update',async()=>{
  const {service,calls}=fixture({installBlocked:()=>true});await service.check();await service.download();
  assert.throws(()=>service.install(),/Finish the current task/);assert.equal(service.snapshot().status,'ready');assert.equal(calls().installs,0);
});
test('checks and downloads do not overlap or replace a ready update',async()=>{
  const {service,client,calls}=fixture();let finish;
  client.checkForUpdates=()=>new Promise(resolve=>{finish=resolve;});
  const pending=service.check();assert.equal(service.snapshot().status,'checking');await service.check();
  client.emit('update-available',{version:'0.16.0'});finish();await pending;
  let complete;client.downloadUpdate=()=>new Promise(resolve=>{complete=resolve;});const download=service.download();
  await service.check();await assert.rejects(service.download(),/Check for/);
  client.emit('update-downloaded',{version:'0.16.0'});complete();await download;await service.check();
  assert.equal(service.snapshot().status,'ready');assert.equal(calls().installs,0);
});
test('network errors and missing releases remain retryable',async()=>{
  const {service,client}=fixture();client.checkForUpdates=async()=>{throw Object.assign(Error('not found'),{code:'ERR_UPDATER_NO_PUBLISHED_VERSIONS'});};
  await service.check();assert.equal(service.snapshot().status,'error');assert.match(service.snapshot().error,/No update package/);
  client.checkForUpdates=async()=>{client.emit('update-not-available',{});};await service.check();assert.equal(service.snapshot().status,'current');assert.equal(service.snapshot().error,null);
  client.emit('error',Error('offline'));assert.equal(service.snapshot().status,'error');assert.equal(service.snapshot().error,'offline');
});
test('failed download does not become installable',async()=>{
  const {service,client}=fixture();await service.check();client.downloadUpdate=async()=>{throw Error('checksum mismatch');};
  await service.download();assert.equal(service.snapshot().status,'error');assert.throws(()=>service.install(),/Download/);
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
