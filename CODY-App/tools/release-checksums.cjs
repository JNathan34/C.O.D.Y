'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {inspectRelease}=require('./github-release.cjs');
(async()=>{
  const version=require('../frontend/original-cody/package.json').version,directory=path.resolve(__dirname,'../dist/standalone-'+version);
  const assets=await inspectRelease(directory,version),lines=[];
  for(const asset of assets.filter(asset=>asset.name!=='SHA256SUMS.txt')){
    const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(asset.path))hash.update(bytes);
    lines.push(hash.digest('hex')+'  '+asset.name);
  }
  await fsp.writeFile(path.join(directory,'SHA256SUMS.txt'),lines.join('\n')+'\n');
  console.log('Generated SHA-256 checksums for '+lines.length+' release assets.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
