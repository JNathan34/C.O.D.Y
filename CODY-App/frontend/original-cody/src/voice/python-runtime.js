'use strict';
const fs=require('node:fs'),path=require('node:path');
function bundledPythonDirectory({resourcesPath=process.resourcesPath,arch=process.arch}={}){
 return resourcesPath?path.join(resourcesPath,'voice',arch):path.resolve(__dirname,'../../runtime/voice',arch);
}
function selectPython(directory,{bundledDirectory=bundledPythonDirectory(),packaged=__dirname.includes('app.asar'),exists=fs.existsSync}={}){
 const bundled=path.join(bundledDirectory,'python.exe');
 if(exists(bundled))return {bin:bundled,prefix:[],bundled:true};
 if(packaged)throw Error('The bundled speech runtime is missing. Reinstall C.O.D.Y using the complete installer. No separate Python or Node.js installation is needed.');
 const managed=path.join(directory,'voice-runtime','Scripts','python.exe');
 if(exists(managed))return {bin:managed,prefix:[],bundled:false};
 const development=path.resolve(__dirname,'../../../Voice System/voice-lab-v0.4/.venv/Scripts/python.exe');
 if(exists(development))return {bin:development,prefix:[],bundled:false};
 return null;
}
module.exports={selectPython,bundledPythonDirectory};
