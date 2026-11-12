'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const IMAGES=/\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/i;
const isImageAttachment=file=>IMAGES.test(file);
const TEXT_PREVIEW=/\.(?:txt|text|md|markdown|csv|tsv|log|json|xml|ya?ml|pdf|docx?|docm|dotx|odt|rtf|pptx|xlsx)$/i;
const MAX_PASTED_BYTES=25*1024*1024;
const PASTED_FILE=/^pasted-image-[a-f0-9-]{36}\.png$/i;
const attachmentNames=paths=>paths.map(file=>({path:file,name:path.basename(file)}));
class Attachments{
  constructor({store,thumbnail=async()=>null,largeThumbnail=async()=>null,excerpt=async()=>null,encodeImage,onChange=()=>{}}){
    Object.assign(this,{store,thumbnail,largeThumbnail,excerpt,encodeImage,onChange});
    this.pasteDirectory=encodeImage&&path.join(store.directory,'pasted-images');
    this.previews=new Map();this.messagePreviews=new Map();this.queue=Promise.resolve();
  }
  chat(id){const chat=this.store.chat(id);if(!chat)throw Error('Select a conversation first.');return chat;}
  async inspect(file){
    if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||/^\\\\[?.]\\/.test(file))throw Error('Drop a file from your computer.');
    const real=await fs.realpath(file),stat=await fs.stat(real);if(!stat.isFile())throw Error('Please drop individual files, rather than folders.');
    return {path:real,name:path.basename(real),size:stat.size,modifiedAt:stat.mtimeMs,isImage:isImageAttachment(real)};
  }
  preview(info){
    if(!info.isImage||info.size>MAX_PASTED_BYTES)return null;
    const key=info.path+':'+info.size+':'+info.modifiedAt;
    if(!this.previews.has(key)){
      if(this.previews.size>=64)this.previews.delete(this.previews.keys().next().value);
      this.previews.set(key,Promise.resolve().then(()=>this.thumbnail(info.path)).catch(()=>null));
    }
    return this.previews.get(key);
  }
  async messagePreview(chatId,messageId,index){
    const message=this.chat(chatId).messages?.find(item=>item.id===messageId);
    const file=Number.isInteger(index)&&index>=0?message?.attachments?.[index]:null;
    if(!file)throw Error('This attachment is unavailable.');
    let info;
    try{info=await this.inspect(file.path);}catch{return {missing:true};}
    const key=info.path+':'+info.size+':'+info.modifiedAt;
    if(!this.messagePreviews.has(key)){
      if(this.messagePreviews.size>=24)this.messagePreviews.delete(this.messagePreviews.keys().next().value);
      const operation=this.loadMessagePreview(info);
      this.messagePreviews.set(key,operation);
    }
    return this.messagePreviews.get(key);
  }
  async loadMessagePreview(info){
    const [image,text]=await Promise.all([
      info.isImage&&info.size<=MAX_PASTED_BYTES?this.largeThumbnail(info.path).catch(()=>null):null,
      TEXT_PREVIEW.test(info.path)?this.excerpt(info.path).catch(()=>null):null
    ]);
    return {image,text,size:info.size};
  }
  async snapshot(id){
    const chat=this.chat(id),items=await Promise.all((chat.attachments||[]).map(async saved=>{
      try{
        const info=await this.inspect(saved.path);
        return {id:saved.id,...info,name:saved.name||info.name,preview:await this.preview(info)};
      }catch{return {id:saved.id,name:saved.name||path.basename(saved.path||'Missing file'),path:saved.path,missing:true,size:0,isImage:false};}
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
  addImage(id,bytes){
    const operation=this.queue.catch(()=>{}).then(async()=>{
      const chat=this.chat(id),previous=chat.attachments;
      if((previous?.length||0)>=10)throw Error('You can attach up to 10 files.');
      if(!this.encodeImage||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_PASTED_BYTES)throw Error('Paste an image up to 25 MB.');
      const png=this.encodeImage(Buffer.from(bytes));
      if(!png?.length||png.length>MAX_PASTED_BYTES)throw Error('C.O.D.Y. could not read this clipboard image.');
      const fileId=randomUUID(),file=path.join(this.pasteDirectory,'pasted-image-'+fileId+'.png');
      await fs.mkdir(this.pasteDirectory,{recursive:true});
      await fs.writeFile(file,png,{flag:'wx'});
      try{
        chat.attachments=[...(previous||[]),{id:fileId,path:file,name:'Pasted image.png'}];this.store.save();
      }catch(error){
        chat.attachments=previous;await fs.unlink(file).catch(()=>{});throw error;
      }
      return this.publish(id);
    });this.queue=operation;return operation;
  }
  remove(id,fileId){const operation=this.queue.catch(()=>{}).then(async()=>{const chat=this.chat(id);chat.attachments=(chat.attachments||[]).filter(file=>file.id!==fileId);this.store.save();await this.removeUnusedPastes();return this.publish(id);});this.queue=operation;return operation;}
  async removeUnusedPastes(){
    if(!this.pasteDirectory)return;
    const files=await fs.readdir(this.pasteDirectory,{withFileTypes:true}).catch(()=>[]);
    const pathKey=value=>process.platform==='win32'?value.toLowerCase():value;
    const referenced=new Set(this.store.data.chats.flatMap(chat=>[...(chat.attachments||[]),...(chat.messages||[]).flatMap(message=>message.attachments||[])])
      .filter(file=>typeof file.path==='string').map(file=>pathKey(file.path)));
    await Promise.all(files.filter(file=>file.isFile()&&PASTED_FILE.test(file.name)).map(async file=>{
      const fullPath=path.join(this.pasteDirectory,file.name);
      if(!referenced.has(pathKey(fullPath)))await fs.unlink(fullPath).catch(()=>{});
    }));
  }
  prunePastes(){
    const operation=this.queue.catch(()=>{}).then(()=>this.removeUnusedPastes());this.queue=operation;return operation;
  }
  prepare(id){
    const operation=this.queue.catch(()=>{}).then(async()=>{
      const files=[...(this.chat(id).attachments||[])],items=[];
      for(const saved of files){
        try{
          const info=await this.inspect(saved.path),preview=await this.preview(info);
          items.push({path:info.path,name:saved.name||info.name,...(preview?{preview}:{})});
        }catch{throw Error((saved.name||path.basename(saved.path||'Attachment'))+' is no longer available. Remove it or attach it again.');}
      }
      return {paths:items.map(file=>file.path),ids:files.map(file=>file.id),items};
    });this.queue=operation;return operation;
  }
  clearSent(id,ids){
    const operation=this.queue.catch(()=>{}).then(()=>{
      const chat=this.chat(id),sent=new Set(ids);chat.attachments=(chat.attachments||[]).filter(file=>!sent.has(file.id));
      this.store.save();return this.publish(id);
    });this.queue=operation;return operation;
  }
  async paths(id){return (await this.prepare(id)).paths;}
}
module.exports={Attachments,attachmentNames,isImageAttachment};
