'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{taskPreviews}=require('../src/task-previews'),{taskState}=require('../src/background-tasks');
test('task previews read only images returned for the selected native task and reuse cached thumbnails',async()=>{
 const calls=[],files=[];const preview=taskPreviews({engine:{request:async(command,args)=>{calls.push({command,args});return{imagePaths:['C:/task/output.png'],files:['output.png']};}},thumbnail:async file=>{files.push(file);return 'data:image/png;base64,AAAA';}});
 const result=await preview('task-one');assert.deepEqual(calls,[{command:'task-preview',args:{taskId:'task-one'}}]);assert.deepEqual(files,['C:/task/output.png']);assert.equal(result.images.length,1);assert.equal(result.imagePaths,undefined);assert.deepEqual(await preview('task-one'),result);assert.equal(calls.length,1);await assert.rejects(preview(''),/Invalid task/);
});
test('preview failures retain file names and bound image counts and payload sizes',async()=>{
 let reads=0;const preview=taskPreviews({engine:{request:async()=>({imagePaths:['bad','oversized','remote','good','extra'],files:Array(15).fill('result.txt')})},thumbnail:async file=>{reads++;if(file==='bad')throw Error('Missing');if(file==='oversized')return 'data:image/png;base64,'+'A'.repeat(1000000);if(file==='remote')return 'https://example.test/tracker.png';return 'data:image/png;base64,AAAA';}});
 const result=await preview('one');assert.equal(reads,4);assert.equal(result.files.length,8);assert.deepEqual(result.images,['data:image/png;base64,AAAA']);
});
test('concurrent task preview requests share native work',async()=>{
 let requests=0;const preview=taskPreviews({engine:{request:async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,10));return{imagePaths:[],files:[]};}},thumbnail:()=>{throw Error('Unexpected');}});await Promise.all([preview('one'),preview('one')]);assert.equal(requests,1);
});
test('website previews and app icons come from native-selected outputs without exposing paths',async()=>{
 const calls=[],preview=taskPreviews({engine:{request:async()=>({websitePath:'C:/result/index.html',iconPath:'C:/browser.exe',kind:'website',outputs:[{id:'one',name:'index.html',kind:'website',target:'hidden'}]})},thumbnail:async()=>'',websiteThumbnail:async file=>{calls.push(file);return 'data:image/png;base64,AAAA';},icon:async file=>{calls.push(file);return 'data:image/png;base64,BBBB';}});
 const value=await preview('one');assert.deepEqual(calls,['C:/result/index.html','C:/browser.exe']);assert.ok(value.websiteImage);assert.ok(value.appIcon);assert.equal(value.websitePath,undefined);assert.deepEqual(value.outputs,[{id:'one',name:'index.html',kind:'website'}]);
});
test('failed website snapshots retain the output opener and do not turn remote image URLs into covers',async()=>{
 const preview=taskPreviews({engine:{request:async()=>({websitePath:'C:/result/index.html',kind:'website',outputs:[{id:'one',name:'index.html',kind:'website'}]})},thumbnail:async()=>'',websiteThumbnail:async()=>{throw Error('Missing file');}});const result=await preview('one');assert.equal(result.websiteImage,null);assert.equal(result.outputs.length,1);
});
test('task plan progress uses bounded reported steps and remains unknown without a plan',()=>{
 const base={id:'one',title:'Task',status:'Running'};let value=taskState({tasks:[{...base,stepsTotal:6,stepsDone:4,preview:'Real output'}]}).tasks[0];assert.equal(value.stepsTotal,6);assert.equal(value.stepsDone,4);assert.equal(value.preview,'Real output');value=taskState({tasks:[{...base,stepsDone:100}]}).tasks[0];assert.equal(value.stepsTotal,0);assert.equal(value.stepsDone,0);value=taskState({tasks:[{...base,stepsTotal:6,stepsDone:100}]}).tasks[0];assert.equal(value.stepsDone,6);
});
