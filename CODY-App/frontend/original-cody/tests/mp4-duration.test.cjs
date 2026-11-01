'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {finalizeMp4}=require('../src/screen-recorder/finalize-mp4');
const {fixture}=require('./helpers/fragmented-mp4.cjs');
for(const version of [0,1])for(const defaultDuration of [false,true])test(`finalizes all MP4 durations (version ${version}, default samples ${defaultDuration})`,async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cody-mp4-')),file=path.join(root,'test.mp4');
  try{
    const before=fixture({version,defaultDuration});await fs.writeFile(file,before);
    assert.deepEqual(await finalizeMp4(file),{durationMs:4000});
    const after=await fs.readFile(file);assert.equal(after.length,before.length);
    for(const [type,ticks,short,long] of [['mvhd',4000,16,24],['tkhd',4000,20,28],['mdhd',120000,16,24]]){
      const at=after.indexOf(Buffer.from(type))+4+(version?long:short);
      assert.equal(version?Number(after.readBigUInt64BE(at)):after.readUInt32BE(at),ticks);
    }
    const fragment=before.indexOf(Buffer.from('moof'))-4;
    assert.deepEqual(after.subarray(fragment),before.subarray(fragment),'encoded samples and fragment timestamps are unchanged');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('rejects incomplete MP4 instead of reporting a saved recording',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cody-mp4-')),file=path.join(root,'test.mp4');
  try{const bytes=fixture().subarray(0,50);await fs.writeFile(file,bytes);await assert.rejects(finalizeMp4(file),/Invalid MP4/);assert.deepEqual(await fs.readFile(file),bytes);}
  finally{await fs.rm(root,{recursive:true,force:true});}
});
