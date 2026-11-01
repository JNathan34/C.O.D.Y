'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.join(root,'frontend/original-cody'),stage=path.join(root,'build/standalone-app');
if(path.relative(root,path.resolve(stage))!==path.join('build','standalone-app'))throw Error('Unsafe staging path.');
fs.rmSync(stage,{recursive:true,force:true});
fs.mkdirSync(stage,{recursive:true});
for(const directory of ['src','assets','windows','ui'])fs.cpSync(path.join(source,directory),path.join(stage,directory),{recursive:true});
fs.mkdirSync(path.join(stage,'node_modules'),{recursive:true});

const original=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:original.name,productName:'C.O.D.Y',version:original.version,description:'C.O.D.Y. with its integrated AI, voice and drawing engine',main:'src/main.js',author:original.author,private:true,dependencies:original.dependencies},null,2));
require('./copy-runtime-deps.cjs').copyRuntimeDependencies(root,stage,original.dependencies);
const required=['BrowserHost/CODYBrowserHost.exe','CODYBrowserExtension/manifest.json','CODYBrowserExtensionID.txt','CODYEngine.exe','HeyClicky.dll','HeyClicky.Core.dll','HeyClicky.Contracts.dll','HeyClicky.Platform.dll','HeyClicky.Drawing.dll','HeyClicky.Drawing3D.dll','HeyClicky.Agents.dll','coreclr.dll','hostfxr.dll','hostpolicy.dll','Microsoft.UI.Xaml.dll','Microsoft.WindowsAppRuntime.dll','HeyClicky.pri','HeyClicky.runtimeconfig.json','Assets/Cody/cody-64.png','Assets/Engine/clicky-three.js'];
required.push('Assets/Cody/identity.md','sherpa-onnx.dll','onnxruntime.dll','sherpa-onnx-c-api.dll',...['encoder.onnx','decoder.onnx','joiner.onnx','tokens.txt','silero-vad.onnx'].map(name=>'BundledResources/wake/'+name));
for(const name of required)if(!fs.existsSync(path.join(root,'run/current',name)))throw Error('Missing bundled engine dependency: '+name);
function files(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(directory,item.name)):[path.join(directory,item.name)]);}
const runtime=path.join(root,'run/current');
const manifest=files(runtime).filter(file=>!file.endsWith('.log')&&!file.endsWith('.pdb')).map(file=>({path:path.relative(runtime,file).replaceAll('\\','/'),size:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
fs.writeFileSync(path.join(root,'build/engine-manifest.json'),JSON.stringify(manifest,null,2));
console.log('Prepared current C.O.D.Y. GUI and '+manifest.length+' engine files. No account/profile data is included.');
