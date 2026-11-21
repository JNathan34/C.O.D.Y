'use strict';
const {randomUUID}=require('node:crypto');
const {posterPath}=require('./self-hosted');
const requested=status=>[2,3,4,5].includes(status);
const playable=status=>status===4||status===5;
const nameKey=value=>value.toLowerCase().normalize('NFKD').replace(/^the\s+/,'').replace(/[^\p{L}\p{N}]/gu,'');

function availability(info){
 if(info?.status===5||info?.status4k===5)return 'available';
 if(info?.status===4||info?.status4k===4)return 'partial';
 if(info?.status===3||info?.status4k===3)return 'processing';
 if(info?.status===2||info?.status4k===2||info?.requests?.some(r=>[1,2].includes(r.status)))return 'requested';
 return info?.status==null||[1,6].includes(info.status)?'missing':'unknown';
}

function mediaChoice(value){
 if(!value||!['movie','tv'].includes(value.type)||!Number.isSafeInteger(value.id)||value.id<1)throw Error('Choose a movie or TV result first.');
 return {id:value.id,type:value.type};
}
function plexItemLink(value){
 if(typeof value!=='string'||value.length>2048)return null;
 let url;try{url=new URL(value);}catch{return null;}
 if(!['http:','https:'].includes(url.protocol))return null;
 const route=/^#!?\/server\/([\w-]{1,128})\/details\?(.+)$/.exec(url.hash);
 if(!route)return null;
 const key=new URLSearchParams(route[2]).get('key');
 if(!/^\/library\/metadata\/[1-9]\d{0,19}$/.test(key??''))return null;
 // Use Plex Web and retain only the server and item identifiers.
 return 'https://app.plex.tv/desktop#!/server/'+route[1]+'/details?key='+encodeURIComponent(key);
}
function requestDetails(data,choice){
 if(data?.id!==choice.id||typeof (data.title||data.name)!=='string')throw Error('Overseerr did not verify this title. Search again.');
 const info=data.mediaInfo;
 const title=String(data.title||data.name).slice(0,140),year=String(data.releaseDate||data.firstAirDate||'').slice(0,4);
 const summary={title,year,posterPath:posterPath(data.posterPath),availability:availability(info)};
 if(choice.type==='movie')return {...summary,seasons:[],blocked:requested(info?.status)||info?.requests?.some(r=>!r.is4k&&[1,2].includes(r.status))===true};
 if(!Array.isArray(data.seasons))throw Error('Overseerr did not return the TV seasons.');
 const seen=new Set();
 const seasons=data.seasons.filter(s=>Number.isInteger(s.seasonNumber)&&s.seasonNumber>=0&&s.seasonNumber<=1000&&!seen.has(s.seasonNumber)&&seen.add(s.seasonNumber)).slice(0,200).map(s=>{
  const existing=info?.seasons?.find(item=>item.seasonNumber===s.seasonNumber);
  const pending=info?.requests?.some(r=>!r.is4k&&[1,2].includes(r.status)&&r.seasons?.some(item=>item.seasonNumber===s.seasonNumber));
  return {number:s.seasonNumber,name:String(s.name||(s.seasonNumber===0?'Specials':'Season '+s.seasonNumber)).slice(0,100),blocked:requested(existing?.status)||!!pending||info?.status===5};
 });
 return {...summary,seasons,blocked:!seasons.some(s=>!s.blocked)};
}

class OverseerrRequests{
 constructor({service,now=Date.now}){Object.assign(this,{service,now});this.previews=new Map();this.sending=new Set();}
 async lookup({query,type,year,latest,fallbackQuery}){
  const config=this.service.data.overseerr;
  if(!config)throw Error('Connect Overseerr under Settings → Plugins to check your Plex library.');
  const search=async text=>{
   const list=await this.service.overseerrSearch(text,{pages:latest?2:1,config});
   if(this.service.data.overseerr!==config)throw Error('The Overseerr connection changed. Search again.');
   const seen=new Set();
   return list.filter(item=>{
    const key=item.type+':'+item.id;
    if(type&&item.type!==type||year&&item.year!==year||seen.has(key))return false;
    seen.add(key);return true;
   });
  };
  const key=nameKey(query);
  let matches=await search(query);
  if(latest){
   const today=new Date(this.now()).toISOString().slice(0,10);
   matches=matches.filter(item=>key&&nameKey(item.title).startsWith(key)&&/^\d{4}-\d{2}-\d{2}$/.test(item.date)&&item.date<=today)
    .sort((a,b)=>b.date.localeCompare(a.date));
   if(matches.length)matches=matches.filter(item=>item.date===matches[0].date);
  }else{
   let exact=matches.filter(item=>nameKey(item.title)===key);
   if(!exact.length&&fallbackQuery){
    const alternatives=await search(fallbackQuery);
    exact=alternatives.filter(item=>nameKey(item.title)===nameKey(fallbackQuery));
    if(alternatives.length)matches=alternatives;
   }
   if(exact.length)matches=exact;
  }
  if(!matches.length)return {reply:latest?'Overseerr did not find a released match for that title.':'Overseerr did not find a matching title.'};
  if(matches.length>1)return {reply:'Overseerr found several matches. Choose the one you want to check.',mediaLookup:{choices:matches.slice(0,4)}};
  const item=matches[0],detail=await this.inspect(item,config);
  const reply={available:'Overseerr shows this title is available on Plex.',partial:'Overseerr shows this title is partly available on Plex.',
   processing:'Overseerr is processing an existing request for this title.',requested:'This title has already been requested in Overseerr.',
   missing:'Overseerr shows this title is missing from Plex.',unknown:'Overseerr did not give a clear availability status for this title.'}[detail.availability];
  const canRequest=!detail.blocked&&['missing','partial'].includes(detail.availability);
  return {reply:reply+(canRequest?' Want me to request it?':''),mediaLookup:{result:{...item,...detail,posterPath:detail.posterPath||item.posterPath}}};
 }
 async inspect(value,config=this.service.data.overseerr){
  const choice=mediaChoice(value);
  const data=await this.loadDetails(choice,config);
  return {...choice,...requestDetails(data,choice)};
 }
 async loadDetails(choice,config){
  const data=await this.service.get('overseerr','/'+choice.type+'/'+choice.id,config);
  if(this.service.data.overseerr!==config)throw Error('The Overseerr connection changed. Search again.');
  return data;
 }
 async mediaPage(value){
  const choice=mediaChoice(value);
  if(!['plex','overseerr'].includes(value.site))throw Error('Choose Plex or Overseerr.');
  const config=this.service.data.overseerr;
  if(!config)throw Error('Connect Overseerr under Settings → Plugins first.');
  if(value.site==='overseerr')return config.url+'/'+choice.type+'/'+choice.id;
  const data=await this.loadDetails(choice,config);
  const detail=requestDetails(data,choice);
  if(!['available','partial'].includes(detail.availability))throw Error('Overseerr does not currently show this title on Plex.');
  const info=data.mediaInfo;
  // Overseerr uses plexUrl, while Seerr uses mediaUrl for the same route.
  const standard=playable(info.status)&&plexItemLink(info.plexUrl??info.mediaUrl);
  const ultraHd=playable(info.status4k)&&plexItemLink(info.plexUrl4k??info.mediaUrl4k);
  const link=standard||ultraHd;
  if(!link)throw Error('Overseerr has no Plex link for this title yet. Use View on Overseerr to see its details.');
  return link;
 }
 async prepare(value){
  const choice=mediaChoice(value),config=this.service.data.overseerr;
  const detail=await this.inspect(choice,config);
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
function registerOverseerrRequestIpc({ipcMain,authorise,requests,openPage}){
 ipcMain.handle('overseerr-request-preview',(event,value)=>{authorise(event);return requests.prepare(value);});
 ipcMain.handle('overseerr-request-submit',(event,value)=>{authorise(event);return requests.submit(value);});
 ipcMain.handle('overseerr-media-open',(event,value)=>{
  authorise(event);
  return requests.mediaPage(value).then(openPage);
 });
}
module.exports={OverseerrRequests,registerOverseerrRequestIpc};
