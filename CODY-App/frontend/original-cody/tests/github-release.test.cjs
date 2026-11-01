'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {inspectRelease}=require('../../../tools/github-release.cjs');
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cody-release-'));
  const bytes=Buffer.from('test installer payload'),sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  await fs.writeFile(path.join(root,'CODY.exe'),bytes);await fs.writeFile(path.join(root,'CODY.exe.blockmap'),'map');
  const manifest=`version: 0.15.1\nfiles:\n  - url: CODY.exe\n    size: ${bytes.length}\n    sha512: ${sha512}\n`;
  await fs.writeFile(path.join(root,'latest.yml'),manifest);return {root,manifest,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('release validation selects only hashed installer and update metadata',async()=>{
  const s=await fixture();try{await fs.writeFile(path.join(s.root,'profile.json'),'private');
    assert.deepEqual((await inspectRelease(s.root,'0.15.1')).map(item=>item.name),['latest.yml','CODY.exe','CODY.exe.blockmap']);
  }finally{await s.cleanup();}
});
test('release validation rejects mismatched version, installer corruption and path traversal',async()=>{
  const s=await fixture();try{
    await assert.rejects(inspectRelease(s.root,'0.15.2'),/version differs/);
    await fs.writeFile(path.join(s.root,'CODY.exe'),'tampered payload value');await assert.rejects(inspectRelease(s.root,'0.15.1'),/mismatch/);
    await fs.writeFile(path.join(s.root,'latest.yml'),s.manifest.replace('CODY.exe','../outside.exe'));await assert.rejects(inspectRelease(s.root,'0.15.1'),/Unsafe/);
  }finally{await s.cleanup();}
});
test('split releases must list both architecture installers in update metadata',async()=>{
  const s=await fixture();try{
    const x64='C.O.D.Y-Setup-0.15.1-x64.exe',arm64='C.O.D.Y-Setup-0.15.1-arm64.exe';
    await fs.rename(path.join(s.root,'CODY.exe'),path.join(s.root,x64));
    const manifest=s.manifest.replace('CODY.exe',x64);await fs.writeFile(path.join(s.root,'latest.yml'),manifest);
    await assert.rejects(inspectRelease(s.root,'0.15.1',{architectures:['x64','arm64']}),/Missing arm64 installer/);
    await fs.copyFile(path.join(s.root,x64),path.join(s.root,arm64));
    const entry=manifest.slice(manifest.indexOf('  - url:')).replace(x64,arm64);
    await fs.writeFile(path.join(s.root,'latest.yml'),manifest+entry);
    const assets=await inspectRelease(s.root,'0.15.1',{architectures:['x64','arm64']});
    assert.deepEqual(assets.map(asset=>asset.name),['latest.yml',x64,arm64]);
  }finally{await s.cleanup();}
});
