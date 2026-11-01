'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'run/current'),build=path.join(root,'work/Cody.Engine/bin/Debug/net9.0-windows10.0.22621.0');
for(const name of ['sherpa-onnx.dll','onnxruntime.dll','sherpa-onnx-c-api.dll'])fs.copyFileSync(path.join(build,name),path.join(runtime,name));
fs.cpSync(path.join(build,'BundledResources/wake'),path.join(runtime,'BundledResources/wake'),{recursive:true});
const file=path.join(runtime,'HeyClicky.deps.json'),current=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),built=JSON.parse(fs.readFileSync(path.join(build,'HeyClicky.deps.json'),'utf8').replace(/^\uFEFF/,''));
for(const target of Object.values(built.targets))for(const [key,value]of Object.entries(target))if(key.startsWith('sherpa-onnx/')){
 current.libraries[key]=built.libraries[key];for(const existing of Object.values(current.targets)){existing[key]=value;for(const entry of Object.keys(existing))if(entry.startsWith('HeyClicky/'))(existing[entry].dependencies??={})['sherpa-onnx']=key.split('/')[1];}
}
fs.writeFileSync(file,JSON.stringify(current,null,2));
console.log('Synchronized local wake detector assets and self-contained runtime dependencies.');
