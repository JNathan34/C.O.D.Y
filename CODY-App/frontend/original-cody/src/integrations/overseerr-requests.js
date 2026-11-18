'use strict';
const {randomUUID}=require('node:crypto');
const requested=status=>[2,3,4,5].includes(status);

function mediaChoice(value){
 if(!value||!['movie','tv'].includes(value.type)||!Number.isSafeInteger(value.id)||value.id<1)throw Error('Choose a movie or TV result first.');
 return {id:value.id,type:value.type};
}
function requestDetails(data,choice){
 if(data?.id!==choice.id||typeof (data.title||data.name)!=='string')throw Error('Overseerr did not verify this title. Search again.');
 const info=data.mediaInfo;
 const title=String(data.title||data.name).slice(0,140),year=String(data.releaseDate||data.firstAirDate||'').slice(0,4);
 if(choice.type==='movie')return {title,year,seasons:[],blocked:requested(info?.status)||info?.requests?.some(r=>!r.is4k&&[1,2].includes(r.status))===true};
 if(!Array.isArray(data.seasons))throw Error('Overseerr did not return the TV seasons.');
 const seen=new Set();
 const seasons=data.seasons.filter(s=>Number.isInteger(s.seasonNumber)&&s.seasonNumber>=0&&s.seasonNumber<=1000&&!seen.has(s.seasonNumber)&&seen.add(s.seasonNumber)).slice(0,200).map(s=>{
  const existing=info?.seasons?.find(item=>item.seasonNumber===s.seasonNumber);
  const pending=info?.requests?.some(r=>!r.is4k&&[1,2].includes(r.status)&&r.seasons?.some(item=>item.seasonNumber===s.seasonNumber));
  return {number:s.seasonNumber,name:String(s.name||(s.seasonNumber===0?'Specials':'Season '+s.seasonNumber)).slice(0,100),blocked:requested(existing?.status)||!!pending||info?.status===5};
 });
 return {title,year,seasons,blocked:!seasons.some(s=>!s.blocked)};
}

class OverseerrRequests{
 constructor({service,now=Date.now}){Object.assign(this,{service,now});this.previews=new Map();this.sending=new Set();}
 async prepare(value){
  const choice=mediaChoice(value),config=this.service.data.overseerr;
  const data=await this.service.get('overseerr','/'+choice.type+'/'+choice.id,config);
  if(this.service.data.overseerr!==config)throw Error('The Overseerr connection changed. Search again.');
  const detail=requestDetails(data,choice);
  for(const [token,entry]of this.previews)if(entry.expires<this.now()&&entry.phase!=='sending')this.previews.delete(token);
  if(this.previews.size>=40)throw Error('Too many request previews. Try again in a few minutes.');
  const token=randomUUID();
  this.previews.set(token,{choice,config,detail,expires:this.now()+300000,phase:'ready'});
  return {token,...choice,...detail};
 }
 async submit({token,seasons}={}){
  const entry=typeof token==='string'?this.previews.get(token):null;
  if(!entry||entry.expires<this.now())throw Error('This request preview expired. Search again.');
  if(this.service.data.overseerr!==entry.config)throw Error('The Overseerr connection changed. Search again.');
  if(entry.phase==='done')return entry.result;
  if(entry.phase!=='ready')throw Error('This request was already submitted or is still being checked. View requests before trying again.');
  const {choice,config}=entry;
  const payload={mediaType:choice.type,mediaId:choice.id};
  if(choice.type==='tv'){
   if(!Array.isArray(seasons)||!seasons.length||seasons.length>200||seasons.some(n=>!Number.isInteger(n)||!entry.detail.seasons.some(s=>s.number===n&&!s.blocked)))throw Error('Choose at least one available TV season.');
   payload.seasons=[...new Set(seasons)].sort((a,b)=>a-b);
  }else if(seasons!==undefined)throw Error('Movie requests cannot include TV seasons.');
  if(entry.detail.blocked)throw Error('This title is already available or requested.');
  const key=choice.type+':'+choice.id;
  if(this.sending.has(key))throw Error('This title is already being requested.');
  entry.phase='sending';this.sending.add(key);
  let posted=false;
  try{
   const current=requestDetails(await this.service.get('overseerr','/'+choice.type+'/'+choice.id,config),choice);
   if(current.blocked||payload.seasons?.some(n=>!current.seasons.some(s=>s.number===n&&!s.blocked)))throw Error('This title or season is now available or requested. Search again.');
   if(this.service.data.overseerr!==config)throw Error('The Overseerr connection changed. Search again.');
   posted=true;
   const result=await this.service.json('overseerr','/request',config,{method:'POST',body:JSON.stringify(payload)});
   if(!Number.isSafeInteger(result?.id)||result.id<1||![1,2,3].includes(result.status)||result.type!==choice.type||result.media?.tmdbId!==choice.id)throw Error('Overseerr did not confirm the request result.');
   entry.result={id:result.id,title:entry.detail.title,status:result.status,type:choice.type};entry.phase='done';
   return entry.result;
  }catch(error){
   entry.phase='failed';
   if(posted&&!error.requestRejected)throw Error('The request may have reached Overseerr. View requests before trying again; it was not automatically resent.');
   throw error;
  }finally{this.sending.delete(key);}
 }
}
function registerOverseerrRequestIpc({ipcMain,authorise,requests}){
 ipcMain.handle('overseerr-request-preview',(event,value)=>{authorise(event);return requests.prepare(value);});
 ipcMain.handle('overseerr-request-submit',(event,value)=>{authorise(event);return requests.submit(value);});
}
module.exports={OverseerrRequests,registerOverseerrRequestIpc};
