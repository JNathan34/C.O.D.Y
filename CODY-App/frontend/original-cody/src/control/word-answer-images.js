'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

async function prepareAnswerImages(files,{directory,nativeImage}){
  const prepared=[];
  for(const file of files){
    const resolved=await fs.realpath(file);
    const relative=path.relative(directory,resolved);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!relative.endsWith('.png'))
      throw Error('The saved drawing is unavailable.');
    const image=nativeImage.createFromPath(resolved);
    if(image.isEmpty())throw Error('The saved drawing could not be opened.');
    const {width,height}=image.getSize();
    const bitmap=image.toBitmap();
    let left=width,top=height,right=-1,bottom=-1;
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        if(bitmap[(y*width+x)*4+3]){
          left=Math.min(left,x);top=Math.min(top,y);
          right=Math.max(right,x);bottom=Math.max(bottom,y);
        }
      }
    }
    if(right<left)throw Error('The saved drawing is empty.');
    const padding=12;
    const x=Math.max(0,left-padding),y=Math.max(0,top-padding);
    const cropped=image.crop({x,y,width:Math.min(width,right+padding+1)-x,height:Math.min(height,bottom+padding+1)-y});
    const output=resolved.replace(/\.png$/i,'-word.png');
    await fs.writeFile(output,cropped.toPNG());
    prepared.push(output);
  }
  return prepared;
}

async function pruneAnswerImages(directory,chats){
  const used=new Set(chats.flatMap(chat=>(chat.messages||[]).flatMap(message=>
    Array.isArray(message.wordImages)?message.wordImages.map(file=>path.dirname(path.resolve(file))):[])));
  const entries=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{
    if(error.code==='ENOENT')return [];
    throw error;
  });
  for(const entry of entries){
    if(!entry.isDirectory()||!(/^[a-f0-9]{32}$/i.test(entry.name)))continue;
    const target=path.resolve(directory,entry.name);
    if(!used.has(target))await fs.rm(target,{recursive:true,force:true});
  }
}

module.exports={prepareAnswerImages,pruneAnswerImages};
