'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SelfHosted}=require('../src/integrations/self-hosted');
const {OverseerrRequests,registerOverseerrRequestIpc}=require('../src/integrations/overseerr-requests');
const {IslandUtilities}=require('../src/island-utilities');

function fixture(t,post){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-request-test-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const state={calls:[],movie:{id:42,title:'A Film',releaseDate:'2002-01-01'},tv:{id:17,name:'A Show',seasons:[{seasonNumber:0,name:'Specials'},{seasonNumber:1,name:'Season 1'},{seasonNumber:2,name:'Season 2'}],mediaInfo:{status:4,seasons:[{seasonNumber:1,status:5}]}}};
 const service=new SelfHosted({file:path.join(folder,'connections.dat'),cipher:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},fetcher:async(url,options)=>{
  const payload=options.body?JSON.parse(options.body):null;state.calls.push({url,options,payload});
  if(options.method==='POST'&&post)return post(payload,state);
  const parsed=new URL(url);
  const data=payload?{id:10,status:1,type:payload.mediaType,media:{tmdbId:payload.mediaId}}:
   parsed.pathname.endsWith('/search')?state.search?.[parsed.searchParams.get('page')]||{results:[]}:
   url.endsWith('/movie/42')?state.movie:state.tv;
  return {ok:true,status:payload?201:200,text:async()=>JSON.stringify(data)};
 }});
 service.configure('overseerr',{url:'https://overseerr.example.org',key:'fixture-secret'});
 return {...state,state,service,flow:new OverseerrRequests({service})};
}

test('the reported Plex question uses Overseerr and finds the newest released matching movie without making a request',async t=>{
 const f=fixture(t);
 const utilities=new IslandUtilities({overseerrRequests:f.flow,showCard(){}});
 const prompt='can you check if the latest spiderman movie is on plex';
 f.state.movie={id:42,title:'Spider-Man: Fixture Two',releaseDate:'2024-05-30',posterPath:'/fixture-poster.jpg'};
 f.state.search={1:{totalPages:2,results:[
  {id:13,mediaType:'movie',title:'Spider-Man: Fixture One',releaseDate:'2023-01-01'},
  {id:21,mediaType:'movie',title:'Spider-Man: Future',releaseDate:'2999-01-01'},
  {id:24,mediaType:'movie',title:'Unrelated New Film',releaseDate:'2025-01-01'}
 ]},2:{totalPages:2,results:[{id:42,mediaType:'movie',title:f.state.movie.title,releaseDate:f.state.movie.releaseDate}]}};
 assert.equal(utilities.match(prompt,{spoken:true}).action,'overseerr-availability');
 let result=await utilities.run(prompt);
 assert.equal(result.mediaLookup.result.title,f.state.movie.title);
 assert.equal(result.mediaLookup.result.posterPath,'/fixture-poster.jpg');
 assert.equal(result.mediaLookup.result.availability,'missing');
 assert.match(result.reply,/Want me to request it\?/);
 assert.ok(!JSON.stringify(result).includes('fixture-secret'));
 assert.match(f.calls[0].url,/Spider-Man/);
 f.state.movie.mediaInfo={status:5};
 result=await utilities.run(prompt);
 assert.equal(result.mediaLookup.result.availability,'available');
 assert.doesNotMatch(result.reply,/Want me to request/);
 f.state.movie.mediaInfo={status:2};
 result=await utilities.run(prompt);
 assert.match(result.reply,/already been requested/);
 assert.doesNotMatch(result.reply,/Want me to request/);
 assert.equal(f.calls.filter(call=>call.payload).length,0);
});

test('unqualified title collisions give poster choices and the year can narrow the search',async t=>{
 const f=fixture(t);
 const utilities=new IslandUtilities({overseerrRequests:f.flow,showCard(){}});
 f.state.search={1:{results:[
  {id:42,mediaType:'movie',title:'A Film',releaseDate:'2002-01-01',posterPath:'/valid.jpg'},
  {id:15,mediaType:'movie',title:'A Film',releaseDate:'1978-03-20',posterPath:'https://untrusted.example/poster.jpg'}
 ]}};
 const ambiguous=await utilities.run('Is A Film on Plex?');
 assert.deepEqual(ambiguous.mediaLookup.choices.map(item=>item.posterPath),['/valid.jpg',null]);
 assert.equal(f.calls.filter(call=>call.url.includes('/movie/')).length,0);
 const chosen=await utilities.run('Is “A Film (2002)” on Plex?');
 assert.equal(chosen.mediaLookup.result.id,42);
 assert.equal(chosen.mediaLookup.result.posterPath,'/valid.jpg');
});

test('Overseerr links open the selected movie or show under the configured base path',async t=>{
 const f=fixture(t);
 f.service.configure('overseerr',{url:'https://overseerr.example.org/media/',key:'fixture-secret'});
 assert.equal(await f.flow.mediaPage({site:'overseerr',id:42,type:'movie',url:'https://other.example'}),'https://overseerr.example.org/media/movie/42');
 assert.equal(await f.flow.mediaPage({site:'overseerr',id:17,type:'tv'}),'https://overseerr.example.org/media/tv/17');
 assert.equal(f.calls.length,0);
});

test('Plex links use the available edition and retain only its Plex server and media identifiers',async t=>{
 const f=fixture(t);
 const route='#!/server/fixture-server/details?key=%2Flibrary%2Fmetadata%2F';
 f.state.movie.mediaInfo={status:5,plexUrl:'https://plex.example.org/web?X-Plex-Token=private'+route+'71&token=hidden'};
 assert.equal(await f.flow.mediaPage({site:'plex',id:42,type:'movie'}),'https://app.plex.tv/desktop'+route+'71');
 f.state.tv.mediaInfo={status:1,status4k:4,plexUrl:'https://app.plex.tv/desktop'+route+'72',mediaUrl4k:'https://app.plex.tv/desktop'+route+'73'};
 assert.equal(await f.flow.mediaPage({site:'plex',id:17,type:'tv'}),'https://app.plex.tv/desktop'+route+'73');
 assert.ok(f.calls.every(call=>!call.payload));
});

test('Plex navigation rejects stale availability and links without an exact Plex library item',async t=>{
 const f=fixture(t),item={site:'plex',id:42,type:'movie'};
 await assert.rejects(f.flow.mediaPage(item),/does not currently show/);
 for(const plexUrl of [undefined,'https://other.example/movie/42','file:///C:/file','https://app.plex.tv/desktop#!/server/fixture/details?key=/library/sections/1']){
  f.state.movie.mediaInfo={status:5,plexUrl};
  await assert.rejects(f.flow.mediaPage(item),/no Plex link for this title/);
 }
 await assert.rejects(f.flow.mediaPage({...item,site:'other'}),/Choose Plex or Overseerr/);
 await assert.rejects(f.flow.mediaPage({...item,id:'42/../settings'}),/Choose a movie/);
 f.service.disconnect('overseerr');
 await assert.rejects(f.flow.mediaPage(item),/Connect Overseerr/);
});

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

test('Overseerr IPC authorizes preview, submit and the title link before dispatching',async()=>{
 const handlers=new Map(),calls=[],opens=[];
 const url='https://overseerr.example.org/movie/42';
 registerOverseerrRequestIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},authorise:e=>{if(e!=='trusted')throw Error('Untrusted');},
  requests:{prepare:async value=>calls.push(value),submit:async value=>calls.push(value),mediaPage:async value=>{calls.push(value);return url;}},openPage:value=>opens.push(value)});
 for(const handler of handlers.values())assert.throws(()=>handler('untrusted',{}),/Untrusted/);
 assert.equal(calls.length,0);
 await handlers.get('overseerr-request-preview')('trusted',{type:'movie',id:42});
 await handlers.get('overseerr-request-submit')('trusted',{token:'preview'});
 await handlers.get('overseerr-media-open')('trusted',{site:'overseerr',type:'movie',id:42});
 assert.deepEqual(calls,[{type:'movie',id:42},{token:'preview'},{site:'overseerr',type:'movie',id:42}]);
 assert.deepEqual(opens,[url]);assert.equal(handlers.size,3);
});
