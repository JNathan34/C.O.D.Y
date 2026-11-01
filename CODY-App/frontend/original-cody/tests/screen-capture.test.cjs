'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ScreenCapture,captureCommand}=require('../src/screen-capture');
test('screen commands route locally while unrelated requests remain AI questions',()=>{
  for(const text of ['take a screenshot','could you take a screenshot of my screen please','screen shot','capture my screen']){
    assert.equal(captureCommand(text),'screenshot',text);
  }
  for(const text of ['start screen recording','record my screen','start recording the screen','start recording'])assert.equal(captureCommand(text),'start',text);
  assert.equal(captureCommand('pause screen recording'),'pause');assert.equal(captureCommand('resume the recording',{recording:true}),'resume');assert.equal(captureCommand('stop recording',{recording:true}),'stop');
  assert.equal(captureCommand('stop recording'),'stop');
  for(const text of ['explain screen recording','record a song','start screen recording and email it','pause my music'])assert.equal(captureCommand(text),null,text);
});
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cody-capture-test-')),handlers=new Map();let now=1000;
  const capture=new ScreenCapture({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>handlers.set(name,fn)},pictures:root,videos:root,now:()=>now});
  capture.source=async()=>({source:{id:'screen:0:0'},display:{size:{width:1920,height:1080},scaleFactor:1}});
  capture.makeWorker=async()=>{};
  capture.request=async action=>{if(action==='stop'){const video=require('./helpers/fragmented-mp4.cjs').fixture();await capture.file.writeFile(video);capture.bytes+=video.length;}return {ok:true};};
  return {capture,handlers,setNow:value=>now=value,cleanup:async()=>{if(capture.active)await capture.execute('stop');for(const name of await fs.readdir(root))await fs.unlink(path.join(root,name));await fs.rmdir(root);}};
}
test('pause freezes elapsed time, resume excludes the pause, stop commits saved bytes',async()=>{
  const s=await fixture();try{
    await s.capture.execute('start');s.setNow(3500);assert.equal(s.capture.snapshot().elapsedMs,2500);
    await s.capture.execute('pause');s.setNow(9000);assert.equal(s.capture.snapshot().elapsedMs,2500);
    await s.capture.execute('resume');s.setNow(10000);assert.equal(s.capture.snapshot().elapsedMs,3500);
    const saved=await s.capture.execute('stop');assert.equal(s.capture.status,'saved');assert.equal(s.capture.snapshot().elapsedMs,3500);assert.equal(path.extname(saved.path),'.mp4');const video=await fs.readFile(saved.path);assert.equal(video.subarray(4,8).toString(),'ftyp');assert.equal(video.subarray(8,12).toString(),'isom');
    await assert.rejects(fs.stat(s.capture.partial),{code:'ENOENT'});
  }finally{await s.cleanup();}
});
test('duplicate starts do not create another recording and stop without video never reports saved',async()=>{
  const s=await fixture();try{
    await s.capture.execute('start');const file=s.capture.output;await s.capture.execute('start');assert.equal(s.capture.output,file);
    s.capture.request=async()=>({ok:true});await assert.rejects(s.capture.execute('stop'),/no video/);assert.equal(s.capture.status,'error');assert.equal(s.capture.lastSaved,undefined);
  }finally{await s.cleanup();}
});
test('another renderer cannot inject recorded data',async()=>{
  const s=await fixture();try{await assert.rejects(s.handlers.get('screen-recorder-chunk')({sender:{},senderFrame:{}},{sequence:0,bytes:new ArrayBuffer(4)}),/Untrusted/);}finally{await s.cleanup();}
});
