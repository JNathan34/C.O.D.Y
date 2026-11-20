'use strict';
const {endpoint}=require('./self-hosted');
const SERVER_CHOICE_MS=15*60*1000;

// The browser handles account credentials. PINs and discovery tokens stay in
// this main-process session; the renderer receives names and server IDs only.
class PlexSignIn {
  constructor({service,openBrowser,fetcher=globalThis.fetch,version='1.0',now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
    Object.assign(this,{service,openBrowser,fetcher,version,now,setTimer,clearTimer});
    this.phase='idle';this.message='';this.session=null;
  }
  snapshot(){
    if(this.session&&!this.current(this.session))this.expire(this.session);
    return {phase:this.phase,message:this.message,servers:this.session?.servers?.map(server=>({
      id:server.id,name:server.name,owned:server.owned
    }))||[]};
  }
  cancel(){
    this.session?.abort.abort();
    this.clearTimer(this.pollTimer);this.clearTimer(this.expiryTimer);
    this.session=null;this.phase='idle';this.message='';
    return this.snapshot();
  }
  close(){this.cancel();}
  current(session){return this.session===session&&!session.abort.signal.aborted&&this.now()<session.expires;}
  setExpiry(session,duration){
    this.clearTimer(this.expiryTimer);
    const expires=session.expires=this.now()+duration;
    this.expiryTimer=this.setTimer(()=>{
      // An old PIN timer can already be queued when authentication completes.
      if(session.expires===expires)this.expire(session);
    },duration);
    this.expiryTimer?.unref?.();
  }
  expire(session){
    if(this.session!==session)return;
    const choosing=this.phase==='servers'||this.phase==='discovering';
    this.cancel();this.phase='expired';
    this.message=choosing?'Plex server selection timed out. Sign in again to refresh your server list.':
      'Plex sign-in expired. Select Sign in with Plex to try again.';
  }
  async json(url,{token,method='GET',signal,clientId}={}){
    let response;
    try{
      response=await this.fetcher(url,{method,redirect:'error',
        headers:{Accept:'application/json','X-Plex-Product':'C.O.D.Y.','X-Plex-Version':this.version,
          'X-Plex-Client-Identifier':clientId,...(token?{'X-Plex-Token':token}:{})},
        signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
    }catch{throw Error('Plex could not be reached. Check your connection and try again.');}
    if(!response.ok){
      const error=Error([401,403].includes(response.status)?'Plex sign-in was rejected. Sign in again.':'Plex could not complete this request.');
      error.status=response.status;throw error;
    }
    if(Number(response.headers?.get?.('content-length'))>1024*1024)throw Error('Plex returned too much data.');
    const body=await response.text();
    if(Buffer.byteLength(body)>1024*1024)throw Error('Plex returned too much data.');
    try{return JSON.parse(body);}catch{throw Error('Plex returned an invalid response. Try signing in again.');}
  }
  async start(){
    this.cancel();
    const clientId=this.service.plexClientIdentifier();
    const session={clientId,abort:new AbortController(),expires:this.now()+300000,servers:[]};
    this.session=session;this.phase='starting';this.message='Opening Plex sign-in…';
    try{
      const pin=await this.json('https://plex.tv/api/v2/pins?strong=true',{method:'POST',clientId,signal:session.abort.signal});
      if(!this.current(session))return this.snapshot();
      if(!Number.isSafeInteger(pin.id)||pin.id<=0||typeof pin.code!=='string'||!/^[a-z0-9-]{4,256}$/i.test(pin.code))
        throw Error('Plex could not start sign-in. Try again.');
      session.pin=pin.id;session.code=pin.code;
      const seconds=Number(pin.expiresIn);
      this.setExpiry(session,Math.min(600,Number.isFinite(seconds)&&seconds>0?seconds:300)*1000);
      const query=new URLSearchParams({clientID:clientId,code:pin.code,'context[device][product]':'C.O.D.Y.'});
      try{await this.openBrowser('https://app.plex.tv/auth#?'+query);}
      catch{throw Error('Could not open Plex sign-in in your browser. Try again.');}
      if(!this.current(session))return this.snapshot();
      this.phase='waiting';this.message='Finish signing in on the Plex website. C.O.D.Y. will connect when you approve it.';
      this.schedule(session);
      return this.snapshot();
    }catch(error){
      if(this.session===session){this.cancel();this.phase='error';this.message=error.message;}
      return this.snapshot();
    }
  }
  schedule(session){
    if(!this.current(session))return;
    this.pollTimer=this.setTimer(()=>void this.check(session),1500);
    this.pollTimer?.unref?.();
  }
  async check(session=this.session){
    if(!session||!this.current(session)){if(session)this.expire(session);return;}
    if(!['waiting','discovering'].includes(this.phase)||session.polling)return;
    this.clearTimer(this.pollTimer);
    session.polling=true;
    try{
      if(!session.authToken){
        const pin=await this.json('https://plex.tv/api/v2/pins/'+session.pin+'?code='+encodeURIComponent(session.code),
          {clientId:session.clientId,signal:session.abort.signal});
        if(!this.current(session))return;
        if(!pin.authToken){this.schedule(session);return;}
        if(typeof pin.authToken!=='string'||pin.authToken.length>1024||/[\r\n]/.test(pin.authToken))
          throw Error('Plex returned an invalid sign-in response.');
        session.authToken=pin.authToken;
        delete session.pin;
        delete session.code;
        this.phase='discovering';this.message='Signed in to Plex. Finding your media servers…';
        this.setExpiry(session,SERVER_CHOICE_MS);
      }
      const resources=await this.json('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1',
        {token:session.authToken,clientId:session.clientId,signal:session.abort.signal});
      if(!this.current(session))return;
      if(!Array.isArray(resources))throw Error('Plex could not find your servers. Try signing in again.');
      session.servers=resources.filter(server=>
        typeof server.provides==='string'&&server.provides.split(',').includes('server')&&
        typeof server.clientIdentifier==='string'&&server.clientIdentifier.length<=300&&
        typeof server.accessToken==='string'&&server.accessToken.length>0&&server.accessToken.length<=1024&&
        !/[\r\n]/.test(server.accessToken)&&Array.isArray(server.connections)
      ).slice(0,30).map(server=>({
        id:server.clientIdentifier,name:String(server.name||'Plex server').slice(0,100),
        owned:server.owned===true||server.owned===1,key:server.accessToken,
        connections:server.connections
      }));
      delete session.authToken;
      if(!session.servers.length){
        this.cancel();this.phase='error';
        this.message='This Plex account has no media servers. Add a server to your account, then sign in again.';
        return;
      }
      this.phase='servers';this.message='Signed in to Plex. Choose your media server.';
      this.setExpiry(session,SERVER_CHOICE_MS);
    }catch(error){
      if(!this.current(session))return;
      if(!session.authToken&&[404,410].includes(error.status)){this.expire(session);return;}
      if([401,403].includes(error.status)){this.cancel();this.phase='error';this.message=error.message;return;}
      this.message=error.message+' Retrying…';this.schedule(session);
    }finally{session.polling=false;}
  }
  async select(id){
    const session=this.session;
    if(!session||!this.current(session)){if(session)this.expire(session);throw Error('Sign in to Plex again.');}
    if(this.phase!=='servers')throw Error('Wait for Plex sign-in to finish.');
    const server=session.servers.find(server=>server.id===id);
    if(!server)throw Error('Choose a server from your Plex account.');
    // Connection probes have their own request timeouts. Let a choice made
    // before expiry finish even if the picker deadline passes during a probe.
    this.clearTimer(this.expiryTimer);
    session.expires=Infinity;
    this.phase='connecting';this.message='Connecting to '+server.name+'…';
    const connections=[];
    for(const connection of server.connections){
      try{
        const url=endpoint(connection.uri);
        if(!connections.some(item=>item.url===url))connections.push({url,rank:(url.startsWith('https:')?0:2)+(connection.local?0:1)+(connection.relay?4:0)});
      }catch{}
    }
    connections.sort((a,b)=>a.rank-b.rank);
    try{
      const attempts=await Promise.allSettled(connections.slice(0,6).map(async connection=>{
        const data=await this.json(connection.url+'/identity',{token:server.key,clientId:session.clientId,signal:session.abort.signal});
        if(data?.MediaContainer?.machineIdentifier!==server.id)throw Error('Server identity did not match.');
        return connection.url;
      }));
      if(!this.current(session))return this.snapshot();
      const connected=attempts.find(attempt=>attempt.status==='fulfilled');
      if(!connected)throw Error('Your Plex server could not be reached. Check that it is running, then try connecting again.');
      this.service.configure('plex',{url:connected.value,key:server.key,account:true,name:server.name});
      this.cancel();this.phase='connected';this.message='Connected to '+server.name+'.';
      return this.snapshot();
    }catch(error){
      if(this.session!==session)return this.snapshot();
      this.phase='servers';this.message=error.message;
      this.setExpiry(session,SERVER_CHOICE_MS);
      return this.snapshot();
    }
  }
}
module.exports={PlexSignIn};
