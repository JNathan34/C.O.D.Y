'use strict';
const path=require('node:path'),{createHash}=require('node:crypto');
function nativeLayout({packaged=false,resourcesPath,sourceDirectory=__dirname,userData,environment=process.env}={}){
  if(!userData)throw Error('C.O.D.Y. profile directory is required.');
  const directory=packaged?path.join(resourcesPath,'native-engine'):path.resolve(sourceDirectory,'../../../run/current');
  const identity=createHash('sha256').update(path.resolve(userData).toLowerCase()).digest('hex').slice(0,16);
  const state=path.join(userData,'native-state');
  return {directory,executable:path.join(directory,'CODYEngine.exe'),pipeName:'CODY.Engine.'+identity,
    environment:{...environment,CODY_ENGINE_PIPE_NAME:'CODY.Engine.'+identity,CODY_ENGINE_STATE_DIR:state,
      HEYCLICKY_DATA_DIR:path.join(userData,'native-account')}};
}
function unpacked(file){return file.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);}
module.exports={nativeLayout,unpacked};
