'use strict';
// Firefox Open Browser Control wire protocol (smankoo/open-browser-control v0.2.0).
// This is intentionally a single-extension bridge, NOT an open MCP agent server.
// Only the CODY main process is allowed to originate browser actions.
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const PORT=9334;
const {readTextExpression,readCommentsExpression}=require('./browser-extractors');
const ACTION_MAP=Object.freeze({
 'browser.navigate':'navigate', 'browser.pageInfo':'get_page_info',
 'browser.getDom':'get_dom', 'browser.listTabs':'list_tabs',
 'browser.newTab':'new_tab', 'browser.switchTab':'switch_tab',
 'browser.closeTab':'close_tab','browser.click':'click','browser.type':'type',
 'browser.scroll':'scroll','browser.keypress':'keypress',
 'browser.hover':'hover','browser.select':'select_option','browser.wait':'wait'
});
class FirefoxBridge extends EventEmitter {
 constructor({WebSocketServer,port=PORT,timeoutMs=30000,sessionId}={}){
  super();this.WebSocketServer=WebSocketServer;this.port=port;this.timeoutMs=timeoutMs;
  this.server=null;this.server6=null;this.socket=null;this.instanceId=null;this.session=typeof sessionId==='string'&&/^cody-[a-z0-9]{8,24}$/.test(sessionId)?sessionId:'cody-'+randomUUID().slice(0,8);
  this.pending=new Map();this.ready=false;this.sessionReady=false;this.probeId=null;this.error=null;
 }
 status(){return {connected:this.ready&&this.sessionReady,transportConnected:this.ready,port:this.port,browser:this.ready?'firefox':null,error:this.error||(!this.sessionReady&&this.ready?'Waiting for Firefox tool handshake':null)};}
 start(){
  if(this.server)return;
  // Delay require until runtime to avoid a network dependency in unit tests.
  const WSS=this.WebSocketServer||require('ws').WebSocketServer;
  this.server=new WSS({port:this.port,host:'127.0.0.1',maxPayload:1024*1024});
  this.server.on('error',err=>{this.error=err.code==='EADDRINUSE'?'Port 9334 is occupied; quit the other browser bridge.':err.message;this.emit('status',this.status());});
  const onConnection=socket=>{
   let identified=false;
   socket.on('message',raw=>{
    if(Buffer.byteLength(raw)>1024*1024){socket.close();return;}
    let msg;try{msg=JSON.parse(raw.toString());}catch{return;}
    if(!identified){
     if(msg?.type!=='event'||msg.event!=='connected'||msg.data?.browser!=='firefox'||typeof msg.data.instanceId!=='string'){
      socket.close(1008,'Firefox extension required');return;
     }
     if(this.socket&&this.socket!==socket){
      if(this.instanceId!==msg.data.instanceId){socket.close(4002,'Another extension attached');return;}
      this.socket.close(4001,'Reconnected');
     }
     identified=true;this.socket=socket;this.instanceId=msg.data.instanceId;this.ready=true;this.sessionReady=false;this.error=null;
     this._send({type:'session_start',session:this.session,name:'C.O.D.Y Browser'});
     // The extension creates its session asynchronously. A schema response is
     // our acknowledgement that its message queue has processed session_start.
     this.probeId='probe-'+randomUUID();
     this._send({type:'get_tool_schema',session:this.session,id:this.probeId});
     this.emit('status',this.status());return;
    }
    if(socket!==this.socket)return;
    if(msg?.type==='tool_schema'&&msg.session===this.session&&msg.id===this.probeId){
     this.sessionReady=true;this.probeId=null;this.error=null;this.emit('status',this.status());return;
    }
    if(msg?.type==='result'&&msg.session===this.session&&typeof msg.id==='string'){
     const req=this.pending.get(msg.id);if(!req)return;
     clearTimeout(req.timer);this.pending.delete(msg.id);
     if(msg.success===true)req.resolve({ok:true,data:msg.data||{},pageState:msg.pageState||null});
     else req.reject(Error(String(msg.error||'Firefox action failed').slice(0,500)));
    }
   });
   socket.on('error',()=>{});
   socket.on('close',()=>{
    if(this.socket!==socket)return;
    this.socket=null;this.instanceId=null;this.ready=false;this.sessionReady=false;this.probeId=null;
    for(const [id,req] of this.pending){clearTimeout(req.timer);req.reject(Error('Firefox extension disconnected'));this.pending.delete(id);}
    this.emit('status',this.status());
   });
  };
  this.server.on('connection',onConnection);
  // Firefox uses ws://localhost, which may resolve to ::1 before 127.0.0.1.
  // Bind both loopback families, never a public interface. If IPv6 is disabled,
  // keep IPv4 running and ignore the secondary listener failure.
  this.server6=new WSS({port:this.port,host:'::1',maxPayload:1024*1024});
  this.server6.on('connection',onConnection);
  this.server6.on('error',()=>{});
  return this.status();
 }
 _send(msg){if(!this.socket||this.socket.readyState!==1)throw Error('Firefox extension not connected');this.socket.send(JSON.stringify(msg));}
 async execute(action,args={},signal){
  const extraReader=action==='browser.readText'?readTextExpression:action==='browser.readComments'?readCommentsExpression:null;
  if(!extraReader&&!Object.hasOwn(ACTION_MAP,action))throw Error('Unsupported Firefox action');
  if(!this.ready)throw Error('Firefox extension is not connected. Install Open Browser Control in Firefox and leave Firefox running.');
  // Do not start an action against a not-yet-created session.
  for(let i=0;i<80&&this.ready&&!this.sessionReady;i++){
   if(signal?.aborted)throw Error('Cancelled');
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!this.ready||!this.sessionReady)throw Error('Firefox extension connected but did not confirm browser tools. Open the Firefox extension panel, check its connection, or reload it.');
  if(signal?.aborted)throw Error('Cancelled');
  const id=randomUUID();
  const promise=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Firefox action timed out'));},this.timeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   try{this._send({type:'action',action:extraReader?'execute_js':ACTION_MAP[action],id,session:this.session,params:extraReader?{expression:extraReader(args)}:args});}
   catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });
  if(!signal)return promise;
  const onAbort=()=>{const p=this.pending.get(id);if(p){clearTimeout(p.timer);this.pending.delete(id);p.reject(Error('Cancelled'));}};
  signal.addEventListener('abort',onAbort,{once:true});
  try{return await promise;}finally{signal.removeEventListener('abort',onAbort);}
 }
 async close(){
  try{if(this.ready)this._send({type:'session_end',session:this.session});}catch{}
  for(const [id,req] of this.pending){clearTimeout(req.timer);req.reject(Error('Browser bridge closed'));this.pending.delete(id);}
  this.ready=false;this.sessionReady=false;
  if(this.socket){try{this.socket.close();}catch{}this.socket=null;}
  if(this.server){const s=this.server;this.server=null;await new Promise(resolve=>s.close(resolve));}
  if(this.server6){const s=this.server6;this.server6=null;await new Promise(resolve=>s.close(resolve));}
 }
}
module.exports={FirefoxBridge,ACTION_MAP,PORT};
