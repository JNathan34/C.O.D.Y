'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'run/current'),base=path.join(root,'pristine/windows-1.1.3');
function owned(file){const relative=path.relative(runtime,path.resolve(file));if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unexpected branding target');}
const fileVersion=require('../frontend/original-cody/package.json').version+'.0';
const rcedit=path.join(root,'node_modules/electron-winstaller/vendor/rcedit.exe'),icon=path.join(root,'frontend/original-cody/assets/brand/cody.ico');
function exe(relative,target,title){const input=path.join(base,relative),output=path.join(runtime,target);owned(output);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(input,output);const args=[output,'--set-icon',icon,'--set-file-version',fileVersion,'--set-product-version',fileVersion];for(const [key,value]of Object.entries({CompanyName:'CODY',ProductName:title,FileDescription:title,InternalName:path.basename(target,'.exe'),OriginalFilename:path.basename(target)}))args.push('--set-version-string',key,value);const p=spawnSync(rcedit,args,{windowsHide:true,encoding:'utf8'});if(p.status!==0)throw Error('CODY executable branding failed: '+p.stderr);}
exe('HeyClicky.exe','CODYEngine.exe','CODY Engine');exe('ClickyBrowserHost/ClickyBrowserHost.exe','BrowserHost/CODYBrowserHost.exe','CODY Browser Host');
fs.cpSync(path.join(base,'ClickyBrowserExtension'),path.join(runtime,'CODYBrowserExtension'),{recursive:true});fs.copyFileSync(path.join(base,'ClickyBrowserExtensionID.txt'),path.join(runtime,'CODYBrowserExtensionID.txt'));
for(const name of ['HeyClicky.exe','ClickyBrowserHost','ClickyBrowserExtension','ClickyBrowserExtensionID.txt']){const file=path.join(runtime,name);owned(file);fs.rmSync(file,{recursive:true,force:true});}
require('./brand-browser-extension.cjs');
console.log('CODY process names, executable properties, icons and browser resources prepared.');

