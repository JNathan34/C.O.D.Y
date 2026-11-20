'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {SelfHosted}=require('../src/integrations/self-hosted');
const {PlexSignIn}=require('../src/integrations/plex-sign-in');

const reply=data=>({ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(data)});
const resource=(id='server-one',owned=true)=>({
  clientIdentifier:id,name:id==='server-one'?'My Plex':'Shared Plex',provides:'server',owned,
  accessToken:'private-server-token-'+id,connections:[{uri:'https://'+id+'.example.com:32400',local:false}]
});
function fixture(t,{resources=[resource()],fetcher,openBrowser}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cody-plex-sign-in-'));
  t.after(()=>{auth.close();fs.rmSync(directory,{recursive:true,force:true});});
  const cipher={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text).toString('base64'),
    decryptString:bytes=>Buffer.from(bytes.toString(),'base64').toString()};
  const file=path.join(directory,'connections.dat');
  const service=new SelfHosted({file,cipher});
  const calls=[],opened=[],timers=[];
  let claimed=false,clock=1000;
  const defaultFetch=async(url,options)=>{
    if(url.includes('/pins?'))return reply({id:123,code:'private-sign-in-code',expiresIn:300});
    if(url.includes('/pins/'))return reply({authToken:claimed?'private-account-token':null});
    if(url.includes('/resources?'))return reply(resources);
    const match=resources.find(server=>url.startsWith(server.connections[0].uri));
    return reply({MediaContainer:{machineIdentifier:match?.clientIdentifier}});
  };
  const auth=new PlexSignIn({service,now:()=>clock,setTimer:(run,ms)=>{
    const timer={run,ms,cleared:false,unref(){}};
    timers.push(timer);
    return timer;
  },clearTimer(timer){if(timer)timer.cleared=true;},
    openBrowser:async url=>{opened.push(url);if(openBrowser)await openBrowser(url);},
    fetcher:async(url,options)=>{calls.push({url,options});return (fetcher||defaultFetch)(url,options);}
  });
  return {auth,service,file,cipher,calls,opened,timers,claim:()=>claimed=true,advance:milliseconds=>clock+=milliseconds};
}

test('Plex browser sign-in discovers the server and securely retains its server token',async t=>{
  const f=fixture(t);
  assert.equal((await f.auth.start()).phase,'waiting');
  const url=new URL(f.opened[0]);
  assert.equal(url.origin,'https://app.plex.tv');
  const query=new URLSearchParams(url.hash.slice(2));
  assert.equal(query.get('code'),'private-sign-in-code');
  const clientId=query.get('clientID');
  await f.auth.check();
  assert.equal(f.auth.snapshot().phase,'waiting');
  f.claim();await f.auth.check();
  assert.equal(f.auth.snapshot().phase,'servers');
  assert.equal(f.calls.some(call=>call.url.endsWith('/identity')),false);
  await f.auth.select('server-one');
  assert.equal(f.auth.snapshot().phase,'connected');
  const status=f.service.status().services.plex;
  assert.equal(status.name,'My Plex');
  assert.equal(status.account,true);
  assert.equal(status.connected,true);
  assert.ok(!JSON.stringify(f.auth.snapshot()).includes('private-'));
  assert.ok(!JSON.stringify(f.service.status()).includes('private-'));
  assert.ok(!fs.readFileSync(f.file,'utf8').includes('private-'));
  const probe=f.calls.find(call=>call.url.endsWith('/identity'));
  assert.equal(probe.options.headers['X-Plex-Token'],'private-server-token-server-one');
  assert.equal(probe.options.redirect,'error');
  assert.ok(f.calls.every(call=>!call.url.includes('private-account-token')&&!call.url.includes('private-server-token')));
  const restarted=new SelfHosted({file:f.file,cipher:f.cipher});
  assert.equal(restarted.plexClientIdentifier(),clientId);
  assert.equal(restarted.status().services.plex.account,true);
});

test('multiple and shared Plex servers require a choice from the discovered account',async t=>{
  const f=fixture(t,{resources:[resource(),resource('server-two',false)]});
  await f.auth.start();f.claim();await f.auth.check();
  assert.equal(f.auth.snapshot().phase,'servers');
  assert.equal(f.auth.snapshot().servers[1].owned,false);
  assert.equal(f.service.status().services.plex.connected,false);
  await assert.rejects(f.auth.select('https://arbitrary.example.com'),/Choose a server/);
  await f.auth.select('server-two');
  assert.equal(f.service.status().services.plex.name,'Shared Plex');
});

test('the server picker survives a queued PIN expiry and a slow choice can still connect',async t=>{
  let resolveProbe;
  const servers=[resource(),resource('server-two',false)];
  const f=fixture(t,{fetcher:async url=>{
    if(url.includes('/pins?'))return reply({id:123,code:'private-sign-in-code',expiresIn:2});
    if(url.includes('/pins/'))return reply({authToken:'private-account-token'});
    if(url.includes('/resources?'))return reply(servers);
    return new Promise(resolve=>resolveProbe=resolve);
  }});
  await f.auth.start();
  const pinTimer=f.timers.find(timer=>timer.ms===2000);
  f.advance(1900);
  await f.auth.check();
  const choiceTimer=f.timers.at(-1);
  assert.equal(pinTimer.cleared,true);
  f.advance(200);
  pinTimer.run();
  assert.deepEqual(f.auth.snapshot().servers.map(server=>server.id),['server-one','server-two']);
  const select=f.auth.select('server-two');
  f.advance(choiceTimer.ms);
  choiceTimer.run();
  assert.equal(f.auth.snapshot().phase,'connecting');
  resolveProbe(reply({MediaContainer:{machineIdentifier:'server-two'}}));
  assert.equal((await select).phase,'connected');
  assert.equal(f.service.status().services.plex.name,'Shared Plex');
});

test('approved discovery retries without polling the PIN again, and a failed server stays available to retry',async t=>{
  let discoveries=0,probes=0;
  const f=fixture(t,{fetcher:async url=>{
    if(url.includes('/pins?'))return reply({id:123,code:'private-sign-in-code',expiresIn:2});
    if(url.includes('/pins/'))return reply({authToken:'private-account-token'});
    if(url.includes('/resources?'))return ++discoveries===1?{ok:false,status:503}:reply([resource()]);
    return ++probes===1?{ok:false,status:503}:reply({MediaContainer:{machineIdentifier:'server-one'}});
  }});
  await f.auth.start();
  await f.auth.check();
  assert.equal(f.auth.snapshot().phase,'discovering');
  f.advance(2100);
  await f.auth.check();
  assert.equal(f.auth.snapshot().phase,'servers');
  assert.equal((await f.auth.select('server-one')).phase,'servers');
  assert.match(f.auth.snapshot().message,/could not be reached/);
  assert.equal(f.auth.snapshot().servers.length,1);
  assert.equal(f.calls.filter(call=>call.url.includes('/pins/')).length,1);
  assert.equal(f.timers.filter(timer=>!timer.cleared&&timer.ms===1500).length,0);
  assert.equal((await f.auth.select('server-one')).phase,'connected');
});

test('cancelled Plex sign-in never opens a late browser window or overwrites the connection',async t=>{
  let resolvePin;
  const f=fixture(t,{fetcher:()=>new Promise(resolve=>resolvePin=resolve)});
  f.service.configure('plex',{url:'https://old.example.com',key:'existing-token'});
  const start=f.auth.start();
  f.auth.cancel();resolvePin(reply({id:123,code:'private-sign-in-code'}));
  await start;
  assert.equal(f.opened.length,0);
  assert.equal(f.auth.snapshot().phase,'idle');
  assert.equal(f.service.status().services.plex.url,'https://old.example.com');
});

test('expired sign-in drops the pending account state and leaves an existing connection intact',async t=>{
  const f=fixture(t);
  f.service.configure('plex',{url:'https://old.example.com',key:'existing-token'});
  await f.auth.start();f.advance(300001);await f.auth.check();
  assert.equal(f.auth.snapshot().phase,'expired');
  assert.equal(f.auth.session,null);
  assert.equal(f.service.status().services.plex.connected,true);
});

test('server identity mismatch cannot save a discovered access token',async t=>{
  const f=fixture(t,{fetcher:async url=>{
    if(url.includes('/pins?'))return reply({id:123,code:'private-sign-in-code'});
    if(url.includes('/pins/'))return reply({authToken:'private-account-token'});
    if(url.includes('/resources?'))return reply([resource()]);
    return reply({MediaContainer:{machineIdentifier:'different-server'}});
  }});
  await f.auth.start();await f.auth.check();
  await f.auth.select('server-one');
  assert.equal(f.auth.snapshot().phase,'servers');
  assert.equal(f.service.status().services.plex.connected,false);
  assert.match(f.auth.snapshot().message,/could not be reached/);
});

test('browser failures do not expose the sign-in code and failed storage preserves previous credentials',async t=>{
  const f=fixture(t,{openBrowser:async()=>{throw Error('private-sign-in-code');}});
  assert.equal((await f.auth.start()).phase,'error');
  assert.ok(!f.auth.snapshot().message.includes('private-sign-in-code'));
  f.service.configure('plex',{url:'https://old.example.com',key:'existing-token'});
  f.cipher.encryptString=()=>{throw Error('Storage unavailable');};
  assert.throws(()=>f.service.configure('plex',{url:'https://new.example.com',key:'new-token'}),/Storage unavailable/);
  assert.equal(f.service.status().services.plex.url,'https://old.example.com');
});
