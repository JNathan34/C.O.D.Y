'use strict';
const {app,BrowserWindow}=require('electron'),path=require('node:path'),assert=require('node:assert/strict');
const {captureFrame}=require('../frontend/original-cody/src/screen-recorder/screenshot');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 try{
  await window.loadFile(path.resolve(__dirname,'../frontend/original-cody/src/screen-recorder/screenshot.html'));
  await window.webContents.executeJavaScript(`(()=>{const source=document.createElement('canvas');source.width=320;source.height=40;const context=source.getContext('2d',{colorSpace:'srgb'});const colours=['#000000','#101010','#808080','#ebebeb','#ffffff','#204060','#449966','#bb5522'];const paint=()=>{colours.forEach((colour,index)=>{context.fillStyle=colour;context.fillRect(index*40,0,40,40);});};paint();window.sourceTimer=setInterval(paint,30);navigator.mediaDevices.getUserMedia=async()=>source.captureStream(30);})()`);
  const bytes=await window.webContents.executeJavaScript('('+captureFrame.toString()+')(' +JSON.stringify('colour-chart')+',320,40)');
  const samples=await window.webContents.executeJavaScript(`(async()=>{const image=await createImageBitmap(new Blob([new Uint8Array(${JSON.stringify([...new Uint8Array(bytes)])})],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d',{colorSpace:'srgb'});context.drawImage(image,0,0);clearInterval(window.sourceTimer);return Array.from({length:8},(_,index)=>Array.from(context.getImageData(index*40+20,20,1,1).data).slice(0,3));})()`);
  const expected=[[0,0,0],[16,16,16],[128,128,128],[235,235,235],[255,255,255],[32,64,96],[68,153,102],[187,85,34]];
  for(let i=0;i<expected.length;i++)for(let channel=0;channel<3;channel++)assert.ok(Math.abs(expected[i][channel]-samples[i][channel])<=3,'Colour or video range changed: '+JSON.stringify({expected:expected[i],actual:samples[i]}));
  console.log(JSON.stringify({passed:true,checks:['black and near-black retained','mid-grey and white levels retained','colour swatches preserved through decoded frame and sRGB PNG'],expected,samples}));
 }catch(error){console.error(error);app.exitCode=1;}
 finally{window.destroy();app.exit(app.exitCode||0);}
});
