'use strict';
const path=require('node:path'),{pathToFileURL,fileURLToPath}=require('node:url'),{randomUUID}=require('node:crypto');
async function websiteThumbnail(file,{BrowserWindow}){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.startsWith('\\\\')||!['.html','.htm'].includes(path.extname(file).toLowerCase()))throw Error('Invalid website preview');
 const root=path.dirname(path.resolve(file)),win=new BrowserWindow({show:false,width:1000,height:600,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,javascript:false,backgroundThrottling:false,partition:'cody-task-preview-'+randomUUID()}});
 const allowed=url=>{try{if(new URL(url).protocol!=='file:')return false;const relative=path.relative(root,fileURLToPath(url));return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}catch{return false;}};
 win.webContents.session.webRequest.onBeforeRequest((request,callback)=>callback({cancel:!allowed(request.url)}));
 win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 win.webContents.session.setPermissionCheckHandler(()=>false);
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
 try{
  await Promise.race([win.loadURL(pathToFileURL(file).href),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Website preview timed out')),5000);timer.unref();})]);
  await new Promise(resolve=>setTimeout(resolve,180));return(await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Website screenshot timed out')),3000);timer.unref();})])).resize({width:560}).toDataURL();
 }finally{win.destroy();}
}
module.exports={websiteThumbnail};
