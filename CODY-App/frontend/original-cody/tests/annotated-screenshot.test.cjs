'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ScreenCapture,captureCommand}=require('../src/screen-capture');
test('explicit drawing save commands do not become ordinary screenshots or unrelated AI questions',()=>{
 for(const s of ['save that drawing','save this annotated screen as a picture','take a screenshot of my drawing'])
  assert.equal(captureCommand(s),'annotated-screenshot',s);
 assert.equal(captureCommand('take a screenshot'),'screenshot');
 assert.equal(captureCommand('clear the drawing'),null);
});
test('annotated captures include the overlay and do not call Clear',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cody-annotated-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const uses=[],annotations={serial:Promise.resolve(),status:()=>({active:[{id:'circle'}]}),
  overlay:{withoutAnnotations:async(fn,settings)=>{uses.push(settings.includeAnnotations);return fn();}}};
 const clipboard=[];
 const capture=new ScreenCapture({ipcMain:{handle(){},on(){}},pictures:root,videos:root,annotations,
  nativeImage:{createFromBuffer:()=>({isEmpty:()=>false})},clipboard:{writeImage:v=>clipboard.push(v)},
  captureImage:async()=>Buffer.from('mock-png')});
 capture.source=async()=>({source:{id:'screen:0'},display:{size:{width:1920,height:1080},scaleFactor:1}});
 const result=await capture.execute('annotated-screenshot');
 assert.match(result.reply,/Annotated screenshot saved/);assert.match(path.basename(result.path),/^Annotated Screenshot /);
 assert.deepEqual(uses,[true]);assert.equal(clipboard.length,1);
 await capture.execute('screenshot');assert.deepEqual(uses,[true,false]);
 assert.equal(annotations.status().active.length,1);
});
