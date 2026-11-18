'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const SERVICES=new Set(['plex','overseerr']);
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
class SelfHosted{
 constructor({file,cipher,fetcher=globalThis.fetch}){
  Object.assign(this,{file,cipher,fetcher});this.data={};
  if(cipher?.isEncryptionAvailable()){
   try{
    const raw=JSON.parse(cipher.decryptString(fs.readFileSync(file)));
    for(const service of SERVICES)if(raw[service]&&typeof raw[service].url==='string'&&typeof raw[service].key==='string')
      this.data[service]={url:endpoint(raw[service].url),key:raw[service].key};
   }catch{}
  }
 }
 available(){return this.cipher?.isEncryptionAvailable()===true;}
 status(){return {available:this.available(),services:Object.fromEntries([...SERVICES].map(id=>[id,{connected:!!this.data[id],url:this.data[id]?.url||''}]))};}
 save(){
  if(!this.available())throw Error('Windows encrypted storage is required to save self-hosted credentials.');
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const tmp=this.file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(tmp,this.cipher.encryptString(JSON.stringify(this.data)),{flag:'wx',mode:0o600});fs.renameSync(tmp,this.file);}finally{try{fs.unlinkSync(tmp)}catch{}}
 }
 configure(service,{url,key}={}){
  if(!SERVICES.has(service))throw Error('Unknown self-hosted service.');
  if(!this.available())throw Error('Windows encrypted storage is unavailable.');
  const clean=endpoint(url);
  if(typeof key!=='string'||!key.trim()||key.length>1024||/[\r\n]/.test(key))throw Error('Enter your server access token or API key.');
  this.data[service]={url:clean,key:key.trim()};this.save();return this.status();
 }
 disconnect(service){
  if(!SERVICES.has(service))throw Error('Unknown self-hosted service.');
  delete this.data[service];this.save();return this.status();
 }
 async get(service,resource){
  const config=this.data[service];if(!config)throw Error('Connect your own '+service+' server in Plugins settings first.');
  const route=service==='plex'?resource:'/api/v1'+resource;
  const url=config.url+route;
  const headers={'Accept':'application/json',...(service==='plex'?{'X-Plex-Token':config.key}:{'X-Api-Key':config.key})};
  let response;try{response=await this.fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{throw Error(service+' server could not be reached. Check its address and network connection.');}
  if(!response?.ok){if([401,403].includes(response?.status))throw Error(service+' rejected these credentials. Reconnect your own account.');throw Error(service+' returned HTTP '+response?.status+'.');}
  const length=Number(response.headers?.get?.('content-length'));
  if(length>1024*1024)throw Error(service+' response is too large.');
  const body=await response.text();if(Buffer.byteLength(body)>1024*1024)throw Error(service+' response is too large.');
  try{return JSON.parse(body);}catch{throw Error(service+' did not return the expected JSON API response.');}
 }
 async plexSessions(){
  const data=await this.get('plex','/status/sessions');
  const items=data?.MediaContainer?.Metadata||data?.MediaContainer?.Video||[];
  if(!Array.isArray(items))throw Error('Plex returned invalid session data.');
  return {count:items.length,sessions:items.slice(0,20).map(item=>({
   ...summarisePlexEntry(item),viewer:String(item.User?.title||item.User?.username||'Unknown').slice(0,70),
   player:String(item.Player?.title||'Unknown').slice(0,90),
   state:String(item.Player?.state||'unknown').slice(0,30)}))};
 }
 async plexRecent(){
  const data=await this.get('plex','/library/recentlyAdded?X-Plex-Container-Size=12');
  const entries=data?.MediaContainer?.Metadata||[];
  if(!Array.isArray(entries))throw Error('Plex returned invalid recent media.');
  return entries.slice(0,12).map(summarisePlexEntry);
 }
 async overseerrRequests(){
  const data=await this.get('overseerr','/request?take=12&skip=0&sort=added');
  if(!Array.isArray(data?.results))throw Error('Overseerr returned invalid requests.');
  return data.results.slice(0,12).map(item=>({
   id:Number.isInteger(item.id)?item.id:null,
   status:Number.isInteger(item.status)?item.status:null,
   type:item.type==='movie'?'movie':item.type==='tv'?'tv':'media',
   title:String(item.media?.title||item.media?.name||'Request').slice(0,150)
  }));
 }
 async overseerrSearch(query){
  if(typeof query!=='string'||query.trim().length<2||query.length>100)throw Error('Enter a movie or TV title to search.');
  const data=await this.get('overseerr','/search?query='+encodeURIComponent(query.trim())+'&page=1');
  if(!Array.isArray(data?.results))throw Error('Overseerr returned invalid search results.');
  return data.results.filter(item=>['movie','tv'].includes(item.mediaType)&&Number.isInteger(item.id)).slice(0,12)
   .map(item=>({id:item.id,type:item.mediaType,title:String(item.title||item.name||'Untitled').slice(0,140),year:String(item.releaseDate||item.firstAirDate||'').slice(0,4)}));
 }
}
module.exports={SelfHosted,endpoint};
