'use strict';
const fs=require('node:fs'),path=require('node:path');
function executable({resourcesPath=process.resourcesPath,architecture=process.arch,appRoot=path.resolve(__dirname,'../../..')}={}){
 const candidates=[
  resourcesPath&&path.join(resourcesPath,'codex',architecture,'bin/codex.exe'),
  resourcesPath&&path.join(resourcesPath,'native-engine/CodexRuntime/bin/codex.exe'),
  path.join(appRoot,'frontend/original-cody/runtime/codex/0.164.0',architecture,'bin/codex.exe'),
  path.join(appRoot,'run/current/CodexRuntime/bin/codex.exe')
 ];
 return candidates.find(file=>file&&fs.existsSync(file))||null;
}
module.exports={executable};
