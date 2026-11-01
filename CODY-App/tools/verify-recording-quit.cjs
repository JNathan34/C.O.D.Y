'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
module.exports=async({win,capture,app})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    const end=Date.now()+45000;while(Date.now()<end&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)'))await wait(100);
    await capture.execute('start');await wait(1800);
    capture.on('change',state=>{if(state.status==='saved')void fs.writeFile(path.resolve(__dirname,'../reports/screen-recording-quit.json'),JSON.stringify({passed:true,path:state.savedPath,bytes:state.bytes,status:state.status},null,2));});
    app.quit();
  }catch(error){await fs.writeFile(path.resolve(__dirname,'../reports/screen-recording-quit.json'),JSON.stringify({passed:false,error:error.stack},null,2));}
};
