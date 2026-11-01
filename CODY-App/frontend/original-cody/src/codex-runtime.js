'use strict';
const fs=require('node:fs'),path=require('node:path');
function executable(){
 const root=process.resourcesPath?path.join(process.resourcesPath,'codex',process.arch):'';
 const bundled=root&&path.join(root,'bin/codex.exe');if(bundled&&fs.existsSync(bundled))return bundled;
 const local=path.resolve(__dirname,'../runtime/codex/0.164.0',process.arch,'bin/codex.exe');if(fs.existsSync(local))return local;
 return null;
}
module.exports={executable};
