'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const SERVICES=new Set(['plex','overseerr']);
const PLEX_RETRY_DELAY_MS=750;
const UNREACHABLE='SELF_HOSTED_UNREACHABLE';
const posterPath=value=>typeof value==='string'&&/^\/[\w-]{1,120}\.(?:jpg|jpeg|png|webp)$/i.test(value)?value:null;
function endpoint(raw){
 if(typeof raw!=='string'||raw.length>350)throw Error('Enter your own server URL.');
 let url;try{url=new URL(raw.trim());}catch{throw Error('Enter a valid server URL.');}
 if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('Server URLs cannot contain credentials, queries or fragments.');
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 const local=/^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}|::1)$/.test(host)||host.endsWith('.local');
 if(url.protocol==='http:'&&!local)throw Error('Use HTTPS outside your private local network.');
 if(url.pathname.includes('..'))throw Error('Invalid server path.');
 return url.origin+url.pathname.replace(/\/+$/,'');
}
function summarisePlexEntry(item){
 return {title:String(item.title||item.grandparentTitle||'Untitled').slice(0,140),
   type:String(item.type||'media').slice(0,25),year:Number.isInteger(item.year)?item.year:null};
}
function confirmsPlexLibrary(data){
 const size=data?.MediaContainer?.size;
 return Number.isInteger(size)&&size>=0;
}
function connectionError(service){
 const name=service==='plex'?'Plex':service;
 return Object.assign(Error(name+' server could not be reached. Check its address and network connection.'),{code:UNREACHABLE});
}
class SelfHosted{
 constructor({file,cipher,fetcher=globalThis.fetch}){
  Object.assign(this,{file,cipher,fetcher});this.data={};
  if(cipher?.isEncryptionAvailable()){
   try{
    const raw=JSON.parse(cipher.decryptString(fs.readFileSync(file)));
    for(const service of SERVICES)if(raw[service]&&typeof raw[service].url==='string'&&typeof raw[service].key==='string')
      this.data[service]={url:endpoint(raw[service].url),key:raw[service].key,
        ...(raw[service].account===true?{account:true,name:String(raw[service].name||'Plex server').slice(0,100)}:{})};
    if(typeof raw.plexClientId==='string'&&/^[a-f0-9-]{36}$/i.test(raw.plexClientId))this.data.plexClientId=raw.plexClientId;
   }catch{}
  }
 }
 available(){return this.cipher?.isEncryptionAvailable()===true;}
 status(){return {available:this.available(),services:Object.fromEntries([...SERVICES].map(id=>[id,{connected:!!this.data[id],url:this.data[id]?.url||'',
  ...(this.data[id]?.account?{account:true,name:this.data[id].name}:{})}]))};}
 plexClientIdentifier(){
  if(!this.available())throw Error('Windows encrypted storage is unavailable.');
  if(!this.data.plexClientId){this.data.plexClientId=randomUUID();try{this.save();}catch(error){delete this.data.plexClientId;throw error;}}
  return this.data.plexClientId;
 }
 save(){
  if(!this.available())throw Error('Windows encrypted storage is required to save self-hosted credentials.');
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const tmp=this.file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,this.cipher.encryptString(JSON.stringify(this.data)),{flag:'wx',mode:0o600});fs.renameSync(tmp,this.file);}finally{try{fs.unlinkSync(tmp)}catch{}}
 }
 credentials(service,{url,key,account=false,name='Plex server'}={}){
  if(!SERVICES.has(service))throw Error('Unknown self-hosted service.');
  if(!this.available())throw Error('Windows encrypted storage is unavailable.');
  const clean=endpoint(url);
  if((key===undefined||key==='')&&this.data[service]?.url===clean)key=this.data[service].key;
  if(typeof key!=='string'||!key.trim()||key.length>1024||/[\r\n]/.test(key))throw Error('Enter your server access token or API key.');
  return {url:clean,key:key.trim(),...(service==='plex'&&account===true?{account:true,name:String(name).slice(0,100)}:{})};
 }
 async connect(service,credentials){
  const candidate=this.credentials(service,credentials);
  const previous=this.data[service];
  const identity=await this.get(service,service==='plex'?'/identity':'/auth/me',candidate);
  if(service==='overseerr'&&!Number.isInteger(identity?.id))throw Error('Overseerr did not confirm the API key. Check your server URL.');
  if(service==='plex'&&!identity?.MediaContainer?.machineIdentifier)throw Error('Plex did not return its server identity.');
  if(this.data[service]!==previous)throw Error('This connection changed during verification. Try again.');
  return this.configure(service,candidate);
 }
 configure(service,credentials){
  const candidate=this.credentials(service,credentials);
  const previous=this.data[service];
  this.data[service]=candidate;
  try{this.save();}catch(error){if(previous)this.data[service]=previous;else delete this.data[service];throw error;}
  return this.status();
 }
 disconnect(service){
  if(!SERVICES.has(service))throw Error('Unknown self-hosted service.');
  const previous=this.data[service];delete this.data[service];
  try{this.save();}catch(error){if(previous)this.data[service]=previous;throw error;}
  return this.status();
 }
 async get(service,resource,config=this.data[service]){
  try{return await this.json(service,resource,config);}
  catch(error){
   if(service!=='plex'||error.code!==UNREACHABLE||this.data.plex!==config)throw error;
   // The saved server may still be coming online when the first read starts.
   await delay(PLEX_RETRY_DELAY_MS);
   if(this.data.plex!==config)throw Error('The Plex connection changed. Try again.');
   return this.json(service,resource,config);
  }
 }
 async json(service,resource,config=this.data[service],request={}){
  if(!config)throw Error('Connect your own '+service+' server in Plugins settings first.');
  const route=service==='plex'?resource:'/api/v1'+resource;
  const url=config.url+route;
  const headers={'Accept':'application/json',...(service==='plex'?{'X-Plex-Token':config.key,
    ...(this.data.plexClientId?{'X-Plex-Client-Identifier':this.data.plexClientId}:{})}:{'X-Api-Key':config.key})};
  if(request.method==='POST')headers['Content-Type']='application/json';
  let response;try{response=await this.fetcher(url,{...request,headers,redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{throw connectionError(service);}
  if(!response?.ok){
   if(request.method==='POST'){
    const message=response?.status===403?'Overseerr does not allow this account to request media.':response?.status===401?'Overseerr rejected the API key. Reconnect in Plugins settings.':'Overseerr rejected the request (HTTP '+response?.status+'). Check existing requests and your server settings.';
    throw Object.assign(Error(message),{requestRejected:response?.status>=400&&response?.status<500});
   }
   if([401,403].includes(response?.status))throw Error(service+' rejected these credentials. Reconnect your own account.');throw Error(service+' returned HTTP '+response?.status+'.');
  }
  const length=Number(response.headers?.get?.('content-length'));
  if(length>1024*1024)throw Error(service+' response is too large.');
  let body;try{body=await response.text();}catch{throw connectionError(service);}
  if(Buffer.byteLength(body)>1024*1024)throw Error(service+' response is too large.');
  try{return JSON.parse(body);}catch{throw Error(service+' did not return the expected JSON API response.');}
 }
 async plexSessions(){
  if(!this.data.plex)throw Error('Connect your Plex server under Settings → Plugins to check who is watching.');
  const data=await this.get('plex','/status/sessions');
  const container=data?.MediaContainer;
  const items=container?.Metadata??container?.Video??(container?.size===0?[]:null);
  if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object')||(!items.length&&container.size>0))
   throw Error('Plex did not return a valid list of viewing sessions. Try again in a moment.');
  return {count:items.length,sessions:items.slice(0,20).map(item=>({
   ...summarisePlexEntry(item),viewer:String(item.User?.title||item.User?.username||'Unknown').slice(0,70),
   player:String(item.Player?.title||'Unknown').slice(0,90),
   state:String(item.Player?.state||'unknown').slice(0,30)}))};
 }
 async plexTest(){
  const data=await this.get('plex','/library/sections');
  if(!confirmsPlexLibrary(data))throw Error('Plex did not confirm library access. Sign in again.');
  return {ok:true,name:this.data.plex?.name||'Plex server'};
 }
 async plexRecent(){
  const data=await this.get('plex','/library/recentlyAdded?X-Plex-Container-Size=12');
  const entries=data?.MediaContainer?.Metadata||[];
  if(!Array.isArray(entries))throw Error('Plex returned invalid recent media.');
  return entries.slice(0,12).map(summarisePlexEntry);
 }
 async overseerrRequestPage(config,take){
  if(!config)throw Error('Connect Overseerr under Settings → Plugins first.');
  const data=await this.get('overseerr','/request?take='+take+'&skip=0&sort=added',config);
  if(!Array.isArray(data?.results)||data.results.some(item=>!item||typeof item!=='object'))throw Error('Overseerr returned invalid requests.');
  if(this.data.overseerr!==config)throw Error('The Overseerr connection changed. Try again.');
  return data.results.slice(0,take);
 }
 async overseerrTest(){
  await this.overseerrRequestPage(this.data.overseerr,1);
  return {ok:true};
 }
 async overseerrRequests(){
  const config=this.data.overseerr;
  const items=await this.overseerrRequestPage(config,12),details=new Map();
  // Request media contains TMDB IDs, rather than a title, in Overseerr's API.
  for(let offset=0;offset<items.length;offset+=3)await Promise.all(items.slice(offset,offset+3).map(async item=>{
   const type=item.type,id=item.media?.tmdbId,resource='/'+type+'/'+id;
   if(!['movie','tv'].includes(type)||!Number.isInteger(id)||item.media?.title||item.media?.name)return;
   if(!details.has(resource))details.set(resource,this.get('overseerr',resource,config).catch(()=>null));
   await details.get(resource);
  }));
  if(this.data.overseerr!==config)throw Error('The Overseerr connection changed. Try again.');
  return Promise.all(items.map(async item=>{
   const detail=await details.get('/'+item.type+'/'+item.media?.tmdbId);
   return {
   id:Number.isInteger(item.id)?item.id:null,
   status:Number.isInteger(item.status)?item.status:null,
   type:item.type==='movie'?'movie':item.type==='tv'?'tv':'media',
   title:String(item.media?.title||item.media?.name||detail?.title||detail?.name||(Number.isInteger(item.media?.tmdbId)?'TMDB '+item.media.tmdbId:'Request')).slice(0,150)
  };}));
 }
 async overseerrSearch(query,{pages=1,config=this.data.overseerr}={}){
  if(typeof query!=='string'||query.trim().length<2||query.length>100)throw Error('Enter a movie or TV title to search.');
  const results=[];
  for(let page=1;page<=Math.min(2,pages);page++){
   const data=await this.get('overseerr','/search?query='+encodeURIComponent(query.trim())+'&page='+page,config);
   if(!Array.isArray(data?.results))throw Error('Overseerr returned invalid search results.');
   results.push(...data.results.filter(item=>['movie','tv'].includes(item?.mediaType)&&Number.isSafeInteger(item.id)&&item.id>0));
   if(!(data.totalPages>page))break;
  }
  return results.slice(0,pages===1?12:60).map(item=>{
   const date=String(item.releaseDate||item.firstAirDate||'').slice(0,10);
   return {id:item.id,type:item.mediaType,title:String(item.title||item.name||'Untitled').slice(0,140),year:date.slice(0,4),date,posterPath:posterPath(item.posterPath)};
  });
 }
}
module.exports={SelfHosted,endpoint,confirmsPlexLibrary,posterPath};
