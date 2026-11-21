'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SelfHosted,endpoint}=require('../src/integrations/self-hosted');
test('only HTTPS or privately addressed HTTP servers can receive user tokens',()=>{
 for(const url of ['https://plex.example.com','http://192.168.0.10:32400','http://10.0.0.5:5055','http://localhost:32400'])
  assert.equal(typeof endpoint(url),'string');
 for(const url of ['http://example.com','ftp://localhost:22','https://user:password@example.com','https://example.com/?token=foo','javascript:alert(1)'])
  assert.throws(()=>endpoint(url),/HTTPS|server|URL|credentials/);
});
function fixture(t,fetcher){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cody-media-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cipher={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('ENCRYPTED:'+Buffer.from(value).toString('base64')),
  decryptString:bytes=>Buffer.from(bytes.toString().slice(10),'base64').toString()};
 const file=path.join(dir,'connections.dat');
 return {service:new SelfHosted({file,cipher,fetcher}),file,cipher};
}
test('Plex sessions use header token, never URLs or cloud accounts',async t=>{
 const calls=[];
 const f=fixture(t,async(url,options)=>{
  calls.push({url,options});
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({MediaContainer:{Metadata:[{title:'Test Movie',User:{title:'Viewer'},Player:{state:'playing',title:'TV'}}]}})};
 });
 f.service.configure('plex',{url:'http://192.168.1.5:32400',key:'test-only-Plex-secret'});
 assert.equal(fs.readFileSync(f.file,'utf8').includes('test-only-Plex-secret'),false);
 const result=await f.service.plexSessions();
 assert.equal(result.count,1);assert.equal(result.sessions[0].viewer,'Viewer');
 assert.equal(calls[0].options.headers['X-Plex-Token'],'test-only-Plex-secret');
 assert.equal(calls[0].url.includes('test-only-Plex-secret'),false);
 assert.equal(calls[0].options.redirect,'error');
 assert.equal(f.service.status().services.plex.key,undefined);
 f.service.disconnect('plex');assert.equal(f.service.status().services.plex.connected,false);
});

test('Plex connection test verifies authenticated library access and exposes no library or token',async t=>{
 const f=fixture(t,async(url,options)=>{
  assert.equal(url,'https://plex.example.org/library/sections');assert.equal(options.headers['X-Plex-Token'],'saved-token');
  return {ok:true,text:async()=>JSON.stringify({MediaContainer:{size:0}})};
 });
 f.service.configure('plex',{url:'https://plex.example.org',key:'saved-token',account:true,name:'Home server'});
 assert.deepEqual(await f.service.plexTest(),{ok:true,name:'Home server'});
});

test('Plex session lookup distinguishes an empty server from disconnected and invalid responses',async t=>{
 let data={MediaContainer:{size:0}};
 const f=fixture(t,async()=>({ok:true,text:async()=>JSON.stringify(data)}));
 await assert.rejects(f.service.plexSessions(),/Connect your Plex server/);
 f.service.configure('plex',{url:'https://plex.example.org',key:'fixture-only'});
 assert.deepEqual(await f.service.plexSessions(),{count:0,sessions:[]});
 for(data of [{}, {MediaContainer:{size:2}}, {MediaContainer:{size:1,Metadata:[]}}])
  await assert.rejects(f.service.plexSessions(),/valid list of viewing sessions/);
});

test('the first Plex session lookup after restart retries a brief network failure using the saved connection',async t=>{
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(calls.length===1)throw TypeError('Connection reset');
  return {ok:true,text:async()=>JSON.stringify({MediaContainer:{size:0}})};
 };
 const {service,file,cipher}=fixture(t,fetcher);
 service.configure('plex',{url:'https://plex.example.org',key:'saved-token',account:true,name:'Home server'});
 const restarted=new SelfHosted({file,cipher,fetcher});
 assert.deepEqual(await restarted.plexSessions(),{count:0,sessions:[]});
 assert.deepEqual(calls.map(call=>call.url),Array(2).fill('https://plex.example.org/status/sessions'));
 assert.ok(calls.every(call=>call.options.headers['X-Plex-Token']==='saved-token'));
 assert.notEqual(calls[0].options.signal,calls[1].options.signal);
});

test('a dropped Plex response is retried once and a still-unreachable server reports the connection error',async t=>{
 let calls=0;
 const {service}=fixture(t,async()=>{
  calls++;
  return {ok:true,text:async()=>{throw Error('Connection closed during response');}};
 });
 service.configure('plex',{url:'https://plex.example.org',key:'saved-token'});
 await assert.rejects(service.plexSessions(),/Plex server could not be reached/);
 assert.equal(calls,2);
 assert.equal(service.status().services.plex.connected,true);
});

test('disconnecting Plex while a read is waiting to retry skips the old server',async t=>{
 let calls=0;
 const {service}=fixture(t,async()=>{calls++;throw Error('Connection reset');});
 service.configure('plex',{url:'https://plex.example.org',key:'saved-token'});
 const pending=service.plexSessions();
 await new Promise(resolve=>setImmediate(resolve));
 service.disconnect('plex');
 await assert.rejects(pending,/Plex connection changed/);
 assert.equal(calls,1);
});

test('Plex connection test rejects invalid credentials and unexpected server responses',async t=>{
 for(const response of [{ok:false,status:401},{ok:true,text:async()=>JSON.stringify({MediaContainer:{machineIdentifier:'public-identity'}})}]){
  let calls=0;
  const f=fixture(t,async()=>{calls++;return response;});f.service.configure('plex',{url:'https://plex.example.org',key:'old-token'});
  await assert.rejects(f.service.plexTest(),/rejected|did not confirm/);
  assert.equal(calls,1);
  assert.equal(f.service.status().services.plex.connected,true);
 }
});
test('Overseerr search and requests use official read-only API paths',async t=>{
 const calls=[];
 const f=fixture(t,async(url,options)=>{
  calls.push({url,options});
  const data=url.includes('/search?')?{results:[{id:42,mediaType:'movie',title:'Some Film'}]}:{results:[{id:7,type:'movie',media:{title:'Some Film'},status:2}]};
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(data)};
 });
 f.service.configure('overseerr',{url:'https://overseerr.example.org',key:'test-only-api-key'});
 assert.equal((await f.service.overseerrSearch('Some Film'))[0].id,42);
 assert.equal((await f.service.overseerrRequests())[0].id,7);
 assert.ok(calls[0].url.endsWith('/api/v1/search?query=Some%20Film&page=1'));
 assert.equal(calls[0].options.headers['X-Api-Key'],'test-only-api-key');
 await assert.rejects(f.service.get('plex','/status/sessions'),/Connect your own/);
});
test('Overseerr Test connection reads a single request with the saved key and accepts an empty list',async t=>{
 const calls=[];
 let response={ok:true,text:async()=>JSON.stringify({results:[]})};
 const {service}=fixture(t,async(url,options)=>{calls.push({url,options});return response;});
 await assert.rejects(service.overseerrTest(),/Connect Overseerr/);
 service.configure('overseerr',{url:'https://requests.example.org/media',key:'fixture-key'});
 assert.deepEqual(await service.overseerrTest(),{ok:true});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://requests.example.org/media/api/v1/request?take=1&skip=0&sort=added');
 assert.equal(calls[0].options.headers['X-Api-Key'],'fixture-key');
 assert.equal(calls[0].options.method,undefined);
 response={ok:false,status:401};
 await assert.rejects(service.overseerrTest(),/rejected these credentials/);
 response={ok:true,text:async()=>JSON.stringify({id:1})};
 await assert.rejects(service.overseerrTest(),/invalid requests/);
 assert.equal(service.status().services.overseerr.connected,true);
});
test('no encrypted storage means no secret is written to disk',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cody-media-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'connections.dat'),service=new SelfHosted({file,cipher:{isEncryptionAvailable:()=>false}});
 assert.throws(()=>service.configure('plex',{url:'https://plex.example.com',key:'token'}),/encrypted/);
 assert.equal(fs.existsSync(file),false);
});

test('Overseerr key survives restart and blank-key reconnect; failed verification preserves it',async t=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,key:options.headers['X-Api-Key']});return {ok:options.headers['X-Api-Key']==='saved-secret',status:401,headers:{get:()=>null},text:async()=>JSON.stringify({id:1})};};
 const f=fixture(t,fetcher);
 await f.service.connect('overseerr',{url:'https://requests.example.org',key:'saved-secret'});
 const service=new SelfHosted({file:f.file,cipher:f.cipher,fetcher});
 assert.equal(service.status().services.overseerr.connected,true);
 assert.ok(!JSON.stringify(service.status()).includes('saved-secret'));
 await service.connect('overseerr',{url:'https://requests.example.org/',key:''});
 assert.equal(calls.at(-1).key,'saved-secret');
 assert.ok(calls.at(-1).url.endsWith('/api/v1/auth/me'));
 await assert.rejects(service.connect('overseerr',{url:'https://requests.example.org',key:'bad-secret'}),/rejected/);
 await service.connect('overseerr',{url:'https://requests.example.org',key:''});
 await assert.rejects(service.connect('overseerr',{url:'https://other.example.org',key:''}),/Enter your/);
 assert.equal(calls.some(call=>call.url.includes('other.example.org')),false);
 service.disconnect('overseerr');
 assert.equal(new SelfHosted({file:f.file,cipher:f.cipher,fetcher}).status().services.overseerr.connected,false);
});

test('Overseerr refuses fake connected status for HTML, invalid JSON identity or an unreachable server',async t=>{
 for(const response of [{ok:true,text:async()=>'<html>Proxy login</html>'},{ok:true,text:async()=>'{}'},null]){
  const f=fixture(t,async()=>{if(!response)throw Error('offline');return response;});
  await assert.rejects(f.service.connect('overseerr',{url:'https://requests.example.org',key:'secret'}),/JSON|confirm|reached/);
  assert.equal(f.service.status().services.overseerr.connected,false);assert.equal(fs.existsSync(f.file),false);
 }
});

test('Overseerr requests resolve real API media IDs into titles and retain failed lookups',async t=>{
 const calls=[];
 const f=fixture(t,async(url)=>{
  calls.push(url);
  const data=url.includes('/request?')?{results:[{id:1,type:'movie',status:2,media:{tmdbId:42}},{id:2,type:'tv',status:1,media:{tmdbId:17}},{id:3,type:'movie',status:3,media:{tmdbId:43}}]}:url.endsWith('/movie/42')?{title:'A Film'}:url.endsWith('/tv/17')?{name:'A Show'}:null;
  return {ok:!!data,status:404,text:async()=>JSON.stringify(data)};
 });
 f.service.configure('overseerr',{url:'https://requests.example.org',key:'secret'});
 const items=await f.service.overseerrRequests();
 assert.deepEqual(items.map(item=>[item.title,item.status]),[['A Film',2],['A Show',1],['TMDB 43',3]]);
 assert.equal(calls.length,4);
});
