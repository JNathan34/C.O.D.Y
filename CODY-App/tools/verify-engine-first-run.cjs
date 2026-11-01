'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {NativeEngine}=require('../frontend/original-cody/src/native-engine');
const profile=path.resolve(__dirname,'../reports/engine-first-run-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);process.env.HEYCLICKY_DATA_DIR=path.join(profile,'native-account');
const engine=new NativeEngine();engine.on('diagnostic',message=>console.log(message));
app.whenReady().then(async()=>{let report;try{const status=await engine.refresh();report={passed:status.signedIn===false&&status.automaticUpdatesEnabled===false,status,modules:await engine.request('deployment-state')};}catch(error){report={passed:false,error:error.message};}finally{fs.writeFileSync(path.resolve(__dirname,'../reports/engine-first-run.json'),JSON.stringify(report,null,2));engine.close();app.quit();}});
