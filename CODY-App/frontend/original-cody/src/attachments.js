'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const IMAGES=/\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
class Attachments{
  constructor({store,thumbnail=async()=>null,onChange=()=>{}}){Object.assign(this,{store,thumbnail,onChange});this.previews=new Map();this.queue=Promise.resolve();}
  chat(id){const chat=this.store.chat(id);if(!chat)throw Error('Select a conversation first.');return chat;}
  async inspect(file){
    if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||/^\\\\[?.]\\/.test(file))throw Error('Drop a file from your computer.');
    const real=await fs.realpath(file),stat=await fs.stat(real);if(!stat.isFile())throw Error('Please drop individual files, rather than folders.');
    return {path:real,name:path.basename(real),size:stat.size,modifiedAt:stat.mtimeMs,isImage:IMAGES.test(real)};
  }
  async snapshot(id){
    const chat=this.chat(id),items=await Promise.all((chat.attachments||[]).map(async saved=>{
      try{
        const info=await this.inspect(saved.path);let preview=null;
        if(info.isImage&&info.size<=25*1024*1024){const key=info.path+':'+info.size+':'+info.modifiedAt;if(!this.previews.has(key)){if(this.previews.size>=64)this.previews.delete(this.previews.keys().next().value);this.previews.set(key,Promise.resolve(this.thumbnail(info.path)).catch(()=>null));}preview=await this.previews.get(key);}
        return {id:saved.id,...info,preview};
      }catch{return {id:saved.id,name:path.basename(saved.path||'Missing file'),path:saved.path,missing:true,size:0,isImage:false};}
    }));
    return {chatId:id,items};
  }
  async publish(id){const state=await this.snapshot(id);this.onChange(state);return state;}
  add(id,paths){
    const operation=this.queue.catch(()=>{}).then(async()=>{
      const chat=this.chat(id);if(!Array.isArray(paths)||paths.length>100)throw Error('Attach up to 10 files at a time.');
      const existing=[...(chat.attachments||[])],seen=new Set(existing.map(file=>file.path.toLowerCase())),errors=[];
      for(const file of paths){
        try{const info=await this.inspect(file),key=info.path.toLowerCase();if(seen.has(key))continue;if(existing.length>=10){errors.push('You can attach up to 10 files.');break;}existing.push({id:randomUUID(),path:info.path});seen.add(key);}
        catch(error){errors.push(error.code==='ENOENT'?'A dropped file could not be found.':error.message);}
      }
      if(!existing.length&&errors.length)throw Error(errors[0]);
      chat.attachments=existing;this.store.save();return {...await this.publish(id),notice:[...new Set(errors)].join(' ')};
    });this.queue=operation;return operation;
  }
  remove(id,fileId){const operation=this.queue.catch(()=>{}).then(()=>{const chat=this.chat(id);chat.attachments=(chat.attachments||[]).filter(file=>file.id!==fileId);this.store.save();return this.publish(id);});this.queue=operation;return operation;}
  async paths(id){
    await this.queue.catch(()=>{});
    const chat=this.chat(id),paths=[];
    for(const saved of chat.attachments||[]){try{paths.push((await this.inspect(saved.path)).path);}catch{throw Error(path.basename(saved.path||'Attachment')+' is no longer available. Remove it or attach it again.');}}
    return paths;
  }
}
module.exports={Attachments};
