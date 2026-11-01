'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
 try{
  await win.loadURL('data:text/html,<body></body>');const source=fs.readFileSync(path.resolve(__dirname,'../frontend/original-cody/src/control-overlay/cursor.svg'),'utf8');
  const directory=path.resolve(__dirname,'../frontend/original-cody/src/control-overlay/cursors');fs.mkdirSync(directory,{recursive:true});
  for(const color of Object.values(require('../frontend/original-cody/src/island/renderer/mascot-looks')).map(look=>look.color.slice(1))){
   const dark='#'+[0,2,4].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*.74).toString(16).padStart(2,'0')).join('');const images=[];
   for(const size of [32,48,64]){
    const pixels=await win.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src='data:image/svg+xml;base64,'+${JSON.stringify(Buffer.from(source.replace('fill="white"',`fill="#${color}" stroke="${dark}" stroke-width="1.25" stroke-linejoin="round"`)).toString('base64'))};await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=${size};const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,${size},${size});return Array.from(ctx.getImageData(0,0,${size},${size}).data);})()`);
    const maskStride=Math.ceil(size/32)*4,dib=Buffer.alloc(40+size*size*4+maskStride*size);dib.writeUInt32LE(40,0);dib.writeInt32LE(size,4);dib.writeInt32LE(size*2,8);dib.writeUInt16LE(1,12);dib.writeUInt16LE(32,14);dib.writeUInt32LE(size*size*4,20);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const src=(y*size+x)*4,dst=40+((size-1-y)*size+x)*4;dib[dst]=pixels[src+2];dib[dst+1]=pixels[src+1];dib[dst+2]=pixels[src];dib[dst+3]=pixels[src+3];if(!pixels[src+3])dib[40+size*size*4+(size-1-y)*maskStride+(x>>3)]|=0x80>>(x&7);}
    images.push({size,data:dib});
   }
   const header=Buffer.alloc(6+images.length*16);header.writeUInt16LE(2,2);header.writeUInt16LE(images.length,4);let offset=header.length;
   images.forEach(({size,data},i)=>{const at=6+i*16;header[at]=header[at+1]=size;header.writeUInt16LE(Math.round(5.5*size/48),at+4);header.writeUInt16LE(Math.round(6*size/48),at+6);header.writeUInt32LE(data.length,at+8);header.writeUInt32LE(offset,at+12);offset+=data.length;});
   fs.writeFileSync(path.join(directory,'cody-'+color.toLowerCase()+'.cur'),Buffer.concat([header,...images.map(i=>i.data)]));
  }
 }finally{win.destroy();app.quit();}
});
