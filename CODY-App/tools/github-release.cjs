'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const yaml=require('js-yaml');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
async function inspectRelease(directory,version){
  const names=await fsp.readdir(directory);
  const manifests=names.filter(name=>/^latest(?:-arm64)?\.yml$/.test(name));
  if(!manifests.includes('latest.yml'))throw Error('Missing latest.yml. Build the NSIS installer first.');
  const assets=new Set(manifests);
  for(const name of manifests){
    const manifest=yaml.load(await fsp.readFile(path.join(directory,name),'utf8'));
    if(manifest.version!==version)throw Error('Release manifest version differs from the app version.');
    if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Manifest has no installer files.');
    for(const entry of manifest.files){
      const filename=decodeURIComponent(entry.url);
      if(path.basename(filename)!==filename||!filename.endsWith('.exe'))throw Error('Unsafe installer path in manifest.');
      const file=path.join(directory,filename),stat=await fsp.stat(file);
      if(entry.size!==undefined&&entry.size!==stat.size)throw Error('Installer size mismatch: '+filename);
      const hash=crypto.createHash('sha512');for await(const bytes of fs.createReadStream(file))hash.update(bytes);
      if(hash.digest('base64')!==entry.sha512)throw Error('Installer checksum mismatch: '+filename);
      assets.add(filename);
      if(names.includes(filename+'.blockmap'))assets.add(filename+'.blockmap');
    }
  }
  const buildInputs=`C.O.D.Y-Build-Inputs-${version}.zip`;
  if(names.includes(buildInputs)){
    const manifest=JSON.parse(await fsp.readFile(path.join(root,'build-inputs.json'),'utf8'));
    if(manifest.name!==buildInputs||manifest.version!==version)throw Error('Build-input manifest version mismatch.');
    const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(path.join(directory,buildInputs)))hash.update(bytes);
    if(hash.digest('hex')!==manifest.sha256)throw Error('Build-input checksum mismatch.');
    assets.add(buildInputs);
  }
  if(names.includes('SHA256SUMS.txt'))assets.add('SHA256SUMS.txt');
  return [...assets].map(name=>({name,path:path.join(directory,name),size:fs.statSync(path.join(directory,name)).size}));
}
async function main(){
  const mode=process.argv[2]||'--check';
  if(!['--check','--draft'].includes(mode))throw Error('Use --check or --draft.');
  const version=require('../frontend/original-cody/package.json').version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Use a stable major.minor.patch version.');
  const directory=path.join(root,'dist','standalone-'+version),assets=await inspectRelease(directory,version);
  console.log('Validated v'+version+': '+assets.map(asset=>asset.name).join(', '));
  if(mode==='--check')return;
  const login=process.env.GH_TOKEN||process.env.GITHUB_TOKEN?null:spawnSync(process.env.GH_CLI||'gh',['auth','token'],{encoding:'utf8',windowsHide:true});
  const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN||(login?.status===0?login.stdout.trim():null);
  if(!token)throw Error('Sign in with gh auth login, or set GH_TOKEN or GITHUB_TOKEN for an account with write access to JNathan34/C.O.D.Y.');
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  async function request(url,options={}){
    const response=await fetch(url,{...options,headers:{...headers,...options.headers}});
    if(!response.ok)throw Error('GitHub request failed ('+response.status+'). Check repository access and whether this version already has a release.');
    return response.json();
  }
  const notesFile=path.join(root,'docs',`RELEASE-NOTES-${version}.md`);
  const notes=fs.existsSync(notesFile)?await fsp.readFile(notesFile,'utf8'):'C.O.D.Y. '+version+' for Windows x64 and ARM64.\n\nDownload the setup executable for a first installation. Existing installations can use Settings → Updates.';
  const release=await request('https://api.github.com/repos/JNathan34/C.O.D.Y/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:'v'+version,name:'C.O.D.Y. '+version,body:notes,draft:true,prerelease:false})});
  console.log('Draft created: '+release.html_url);
  for(const asset of assets){
    console.log('Uploading '+asset.name+'…');
    await request(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(asset.name),{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(asset.size)},body:fs.createReadStream(asset.path),duplex:'half'});
  }
  console.log('All update assets uploaded. Review release notes and publish the draft at '+release.html_url);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={inspectRelease};
