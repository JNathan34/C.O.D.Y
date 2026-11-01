'use strict';
function taskPreviews({engine,thumbnail,websiteThumbnail,icon}){
 const cache=new Map(),pending=new Map();
 return async id=>{
  if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid task');
  if(cache.has(id)&&Date.now()-cache.get(id).at<10000)return cache.get(id).value;
  if(pending.has(id))return pending.get(id);
  const operation=(async()=>{
   // Paths come from the selected native task's own artifacts, never the renderer.
   const source=await engine.request('task-preview',{taskId:id}),images=[];
   for(const file of (source.imagePaths||[]).slice(0,4)){
    try{const data=await thumbnail(file);if(typeof data==='string'&&data.startsWith('data:image/png;base64,')&&data.length<=1000000)images.push(data);}catch{}
   }
   let websiteImage=null,appIcon=null;
   const image=value=>typeof value==='string'&&value.startsWith('data:image/png;base64,')&&value.length<=1000000?value:null;
   if(source.websitePath&&websiteThumbnail)try{websiteImage=image(await websiteThumbnail(source.websitePath));}catch{}
   if(source.iconPath&&icon)try{appIcon=image(await icon(source.iconPath));}catch{}
   const value={files:(source.files||[]).slice(0,8).map(name=>String(name).slice(0,240)),images,websiteImage,appIcon,documentText:typeof source.documentText==='string'?source.documentText.slice(0,2000):null,kind:source.kind,outputs:(source.outputs||[]).slice(0,24).filter(x=>typeof x.id==='string'&&typeof x.name==='string'&&['website','document','images'].includes(x.kind)).map(x=>({id:x.id.slice(0,80),name:x.name.slice(0,240),kind:x.kind}))};
   cache.set(id,{at:Date.now(),value});if(cache.size>100)cache.delete(cache.keys().next().value);return value;
  })();pending.set(id,operation);try{return await operation;}finally{pending.delete(id);}
 };
}
module.exports={taskPreviews};
