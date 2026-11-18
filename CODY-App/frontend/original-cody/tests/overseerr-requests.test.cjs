'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SelfHosted}=require('../src/integrations/self-hosted');
const {OverseerrRequests,registerOverseerrRequestIpc}=require('../src/integrations/overseerr-requests');

function fixture(t,post){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-request-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const state={calls:[],movie:{id:42,title:'A Film',releaseDate:'2002-01-01'},tv:{id:17,name:'A Show',seasons:[{seasonNumber:0,name:'Specials'},{seasonNumber:1,name:'Season 1'},{seasonNumber:2,name:'Season 2'}],mediaInfo:{status:4,seasons:[{seasonNumber:1,status:5}]}}};
 const service=new SelfHosted({file:path.join(folder,'connections.dat'),cipher:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},fetcher:async(url,options)=>{
  const payload=options.body?JSON.parse(options.body):null;state.calls.push({url,options,payload});
  if(options.method==='POST'&&post)return post(payload,state);
  const data=payload?{id:10,status:1,type:payload.mediaType,media:{tmdbId:payload.mediaId}}:url.endsWith('/movie/42')?state.movie:state.tv;
  return {ok:true,status:payload?201:200,text:async()=>JSON.stringify(data)};
 }});
 service.configure('overseerr',{url:'https://overseerr.example.org',key:'fixture-secret'});
 return {...state,state,service,flow:new OverseerrRequests({service})};
}

test('movie requests require a verified preview and preserve the exact ID, key header and minimal API payload',async t=>{
 const f=fixture(t);await assert.rejects(f.flow.submit({token:'invented'}),/expired/);
 const preview=await f.flow.prepare({id:42,type:'movie',title:'Spoofed title'});
 assert.equal(preview.title,'A Film');assert.equal(f.calls.filter(c=>c.payload).length,0);
 assert.ok(!JSON.stringify(preview).includes('fixture-secret'));
 const result=await f.flow.submit({token:preview.token,mediaId:999,userId:999,serverId:999});
 assert.equal(result.id,10);assert.equal(result.status,1);
 const post=f.calls.find(c=>c.payload);assert.ok(post.url.endsWith('/api/v1/request'));
 assert.deepEqual(post.payload,{mediaType:'movie',mediaId:42});assert.equal(post.options.headers['X-Api-Key'],'fixture-secret');
 assert.equal(post.options.headers['Content-Type'],'application/json');assert.equal(post.options.redirect,'error');
 assert.deepEqual(await f.flow.submit({token:preview.token}),result);assert.equal(f.calls.filter(c=>c.payload).length,1);
});

test('TV request sends only explicitly chosen unrequested seasons, including specials when selected',async t=>{
 const f=fixture(t),preview=await f.flow.prepare({type:'tv',id:17});
 assert.deepEqual(preview.seasons.map(s=>[s.number,s.blocked]),[[0,false],[1,true],[2,false]]);
 for(const seasons of [undefined,[],[1],[999],'all',[2.5]])await assert.rejects(f.flow.submit({token:preview.token,seasons}),/Choose/);
 await f.flow.submit({token:preview.token,seasons:[2,0,2]});
 assert.deepEqual(f.calls.find(c=>c.payload).payload,{mediaType:'tv',mediaId:17,seasons:[0,2]});
});

test('already available/requested movies and newly requested seasons cannot be submitted',async t=>{
 const f=fixture(t);f.state.movie.mediaInfo={status:5};
 const blocked=await f.flow.prepare({id:42,type:'movie'});assert.equal(blocked.blocked,true);
 await assert.rejects(f.flow.submit({token:blocked.token}),/already/);
 const tv=await f.flow.prepare({id:17,type:'tv'});f.state.tv.mediaInfo.seasons.push({seasonNumber:2,status:2});
 await assert.rejects(f.flow.submit({token:tv.token,seasons:[2]}),/now available or requested/);
 assert.equal(f.calls.filter(c=>c.payload).length,0);
});

test('changed connections, expired previews and invalid media never send a request',async t=>{
 const f=fixture(t);
 for(const value of [null,{}, {id:0,type:'movie'},{id:42,type:'person'},{id:'42',type:'movie'}])await assert.rejects(f.flow.prepare(value),/Choose/);
 let now=0;const flow=new OverseerrRequests({service:f.service,now:()=>now});
 const preview=await flow.prepare({id:42,type:'movie'});now=300001;await assert.rejects(flow.submit({token:preview.token}),/expired/);
 const fresh=await f.flow.prepare({id:42,type:'movie'});f.service.disconnect('overseerr');
 await assert.rejects(f.flow.submit({token:fresh.token}),/connection changed/);assert.equal(f.calls.filter(c=>c.payload).length,0);
});

test('double submit and overlapping previews cannot create concurrent duplicate requests',async t=>{
 let release;const waiting=new Promise(resolve=>release=resolve);
 const f=fixture(t,async payload=>{await waiting;return {ok:true,text:async()=>JSON.stringify({id:10,status:2,type:payload.mediaType,media:{tmdbId:payload.mediaId}})};});
 const a=await f.flow.prepare({id:42,type:'movie'}),b=await f.flow.prepare({id:42,type:'movie'});
 const pending=f.flow.submit({token:a.token});
 await assert.rejects(f.flow.submit({token:a.token}),/already submitted/);
 await assert.rejects(f.flow.submit({token:b.token}),/already being/);
 release();await pending;assert.equal(f.calls.filter(c=>c.payload).length,1);
});

test('a lost or malformed POST result never claims success or automatically resends',async t=>{
 for(const post of [async()=>{throw Error('timeout');},async()=>({ok:true,text:async()=>'{}'}),async()=>({ok:false,status:500})]){
  const f=fixture(t,post),preview=await f.flow.prepare({id:42,type:'movie'});
  await assert.rejects(f.flow.submit({token:preview.token}),/may have reached Overseerr/);
  await assert.rejects(f.flow.submit({token:preview.token}),/already submitted/);
  assert.equal(f.calls.filter(c=>c.payload).length,1);
 }
});

test('request permission failures explain rejection and preserve the saved connection',async t=>{
 const f=fixture(t,async()=>({ok:false,status:403})),preview=await f.flow.prepare({id:42,type:'movie'});
 await assert.rejects(f.flow.submit({token:preview.token}),/does not allow this account/);
 assert.equal(f.service.status().services.overseerr.connected,true);
});

test('request IPC authorizes both preview and submit and does not expose a general API writer',async()=>{
 const handlers=new Map(),calls=[];
 registerOverseerrRequestIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},authorise:e=>{if(e!=='trusted')throw Error('Untrusted');},requests:{prepare:async value=>calls.push(value),submit:async value=>calls.push(value)}});
 for(const handler of handlers.values())assert.throws(()=>handler('untrusted',{}),/Untrusted/);
 assert.equal(calls.length,0);
 await handlers.get('overseerr-request-preview')('trusted',{type:'movie',id:42});
 await handlers.get('overseerr-request-submit')('trusted',{token:'preview'});
 assert.deepEqual(calls,[{type:'movie',id:42},{token:'preview'}]);assert.equal(handlers.size,2);
});
