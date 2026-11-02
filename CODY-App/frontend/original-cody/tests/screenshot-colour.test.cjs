'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {captureFrame,captureScreenshot}=require('../src/screen-recorder/screenshot');
const {ScreenCapture}=require('../src/screen-capture');
function renderer(fail=false){
 let stopped=false,requested,options;
 const video={videoWidth:2880,videoHeight:1800,play:async()=>{},pause(){},requestVideoFrameCallback:callback=>queueMicrotask(callback)};
 const canvas={getContext:(_kind,value)=>{options=value;return {drawImage(){if(fail)throw Error('conversion failed');}};},toBlob:callback=>callback({arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})};
 const context=vm.createContext({navigator:{mediaDevices:{getUserMedia:async value=>{requested=value;return {getTracks:()=>[{stop(){stopped=true;}}]};}}},document:{createElement:name=>name==='video'?video:canvas},queueMicrotask});
 return {run:()=>vm.runInContext('('+captureFrame.toString()+')("screen:test",2880,1800)',context),stopped:()=>stopped,requested:()=>requested,options:()=>options};
}
test('screenshot frame is decoded at screen resolution into an sRGB canvas, with no audio capture',async()=>{
 const f=renderer();await f.run();assert.equal(f.options().colorSpace,'srgb');assert.equal(f.options().alpha,false);assert.equal(f.requested().audio,false);assert.equal(f.requested().video.mandatory.maxWidth,2880);assert.equal(f.requested().video.mandatory.maxHeight,1800);assert.equal(f.stopped(),true);
});
test('screenshot conversion failures always release screen capture',async()=>{const f=renderer(true);await assert.rejects(f.run(),/conversion failed/);assert.equal(f.stopped(),true);});
test('a stalled screenshot renderer is destroyed on timeout',async()=>{
 let destroyed=false;class Window{constructor(){this.webContents={session:{setPermissionRequestHandler(){}},setWindowOpenHandler(){},on(){},executeJavaScript:()=>new Promise(()=>{})};}async loadFile(){}isDestroyed(){return destroyed;}destroy(){destroyed=true;}}
 await assert.rejects(captureScreenshot({BrowserWindow:Window,sourceId:'screen:0',width:100,height:100,timeoutMs:15}),/timed out/);assert.equal(destroyed,true);
});
test('saved and clipboard screenshots use the converted image and do not interrupt a recording',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cody-screenshot-colour-'));try{
  const png=Buffer.from('converted PNG fixture'),image={isEmpty:()=>false};let copied;
  const capture=new ScreenCapture({ipcMain:{handle(){},on(){}},pictures:root,captureImage:async()=>png,nativeImage:{createFromBuffer:bytes=>{assert.deepEqual(bytes,png);return image;}},clipboard:{writeImage:value=>copied=value}});
  capture.source=async()=>({source:{id:'screen:0'},display:{size:{width:1440,height:900},scaleFactor:2}});capture.status='recording';capture.segment=Date.now();const recorder={};capture.worker=recorder;
  const result=await capture.execute('screenshot');assert.deepEqual(await fs.readFile(result.path),png);assert.equal(copied,image);assert.equal(capture.worker,recorder);assert.equal(capture.status,'recording');
 }finally{for(const name of await fs.readdir(root))await fs.unlink(path.join(root,name));await fs.rmdir(root);}
});
