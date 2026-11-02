'use strict';
const path=require('node:path');
async function captureFrame(sourceId,width,height){
 let stream,video;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:sourceId,maxWidth:width,maxHeight:height,maxFrameRate:1}}});
  video=document.createElement('video');video.muted=true;video.srcObject=stream;
  await video.play();
  await new Promise((resolve,reject)=>{video.onerror=()=>reject(Error('The screen frame could not be decoded.'));video.requestVideoFrameCallback(resolve);});
  if(!video.videoWidth||!video.videoHeight)throw Error('Windows returned an empty screenshot.');
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  // Drawing the decoded frame converts its colour space and video range to sRGB,
  // rather than saving a display-capture thumbnail as if it were ordinary RGB.
  const context=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});if(!context)throw Error('Screenshot colour conversion is unavailable.');
  context.drawImage(video,0,0);
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw Error('The screenshot could not be encoded.');
  return await png.arrayBuffer();
 }finally{stream?.getTracks().forEach(track=>track.stop());if(video){video.pause();video.srcObject=null;}}
}
async function captureScreenshot({BrowserWindow,sourceId,width,height,timeoutMs=15000}){
 const window=new BrowserWindow({show:false,width:1,height:1,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'cody-screenshot'}});
 const pageUrl=require('node:url').pathToFileURL(path.join(__dirname,'screenshot.html')).href;
 window.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>callback(permission==='media'&&contents.getURL()===pageUrl));
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 let timer;
 try{
  const operation=(async()=>{await window.loadFile(path.join(__dirname,'screenshot.html'));return window.webContents.executeJavaScript('('+captureFrame.toString()+')('+[sourceId,width,height].map(value=>JSON.stringify(value)).join(',')+')');})();
  const bytes=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Screenshot capture timed out.')),timeoutMs);})]);
  return Buffer.from(bytes);
 }finally{clearTimeout(timer);if(!window.isDestroyed())window.destroy();}
}
module.exports={captureScreenshot,captureFrame};
