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
test('no encrypted storage means no secret is written to disk',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cody-media-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'connections.dat'),service=new SelfHosted({file,cipher:{isEncryptionAvailable:()=>false}});
 assert.throws(()=>service.configure('plex',{url:'https://plex.example.com',key:'token'}),/encrypted/);
 assert.equal(fs.existsSync(file),false);
});
