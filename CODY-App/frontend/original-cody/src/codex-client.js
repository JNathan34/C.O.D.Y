'use strict';
const {spawn} = require('node:child_process');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const {StringDecoder} = require('node:string_decoder');
const {requirePersonalCodex}=require('./usage-policy');
/** Official Codex app-server bridge. No provider tokens or internal API URLs are handled here. */
class CodexClient extends EventEmitter {
  constructor(opts={}){super();this.launch=opts.launch||(()=>{const isWin=process.platform==='win32';const env={...process.env};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;if(opts.home){fs.mkdirSync(opts.home,{recursive:true});env.CODEX_HOME=opts.home;}const binary=require('./codex-runtime').executable();return spawn(binary||(isWin?'cmd.exe':'codex'),binary?['app-server']:isWin?['/d','/s','/c','codex app-server']:['app-server'],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});});this.capabilities=opts.capabilities;this.proc=null;this.nextId=1;this.pending=new Map();this.buf='';this.decoder=new StringDecoder('utf8');this.ready=null;}
  async start(){requirePersonalCodex();if(this.ready)return this.ready;this.ready=this._start().catch(e=>{this.ready=null;throw e;});return this.ready;}
  async _start(){requirePersonalCodex();const proc=this.launch();this.proc=proc;this.buf='';this.decoder=new StringDecoder('utf8');proc.stdout.on('data',chunk=>this.feed(this.decoder.write(chunk)));proc.stderr.on('data',chunk=>{const str=chunk.toString('utf8');if(/error|not found|not recognized|ENOENT/i.test(str))this.emit('diagnostic',str.slice(0,500));});proc.on('error',err=>{this._failAll(err);this.emit('offline',err.message);});proc.on('exit',(code)=>{this._failAll(Error(`Codex app-server exited (${code}). Is Codex CLI installed?`));this.ready=null;this.proc=null;this.emit('offline',`Codex exited (${code})`);});await this.request('initialize',{clientInfo:{name:'cody_desktop',title:'C.O.D.Y',version:'0.11.0'},...(this.capabilities?{capabilities:this.capabilities}:{})},15000);this.send({method:'initialized',params:{}});this.emit('online');return true;}
  feed(data){this.buf+=data;let idx;while((idx=this.buf.indexOf('\n'))>=0){const line=this.buf.slice(0,idx).trim();this.buf=this.buf.slice(idx+1);if(!line)continue;let msg;try{msg=JSON.parse(line);}catch{this.emit('diagnostic','Received malformed JSON from Codex');continue;}this.onMessage(msg);}if(this.buf.length>8_000_000){this.buf='';this.emit('diagnostic','Discarded oversized Codex response');}}
  onMessage(msg){if(msg.id!==undefined&&this.pending.has(msg.id)){const p=this.pending.get(msg.id);this.pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.reject(Error(msg.error.message||JSON.stringify(msg.error)));else p.resolve(msg.result);return;}if(msg.id!==undefined&&msg.method){this.emit('approval',{id:msg.id,method:msg.method,params:msg.params||{}});return;}if(msg.method)this.emit('event',msg);}
  send(obj){if(!this.proc?.stdin?.writable)throw Error('Codex is not running');this.proc.stdin.write(JSON.stringify(obj)+'\n');}
  request(method,params={},timeout=35000){return new Promise((resolve,reject)=>{const id=this.nextId++;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`${method} timed out`));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({method,id,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
  respond(id,decision){this.send({id,result:{decision}});}
  _failAll(err){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(err);}this.pending.clear();}
  async account(){return this.request('account/read',{refreshToken:false});}
  async login(){return this.request('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'chatgpt'});}
  async models(){const res=await this.request('model/list',{limit:40,includeHidden:false});return res.data||[];}
  async rateLimits(){return this.request('account/rateLimits/read',{});}
  async newThread(options={}){const p={approvalPolicy:'on-request',sandbox:'read-only',serviceName:'cody_desktop'};if(options.cwd)p.cwd=options.cwd;if(options.model)p.model=options.model;const res=await this.request('thread/start',p);return res.thread?.id;}
  async resume(threadId){return this.request('thread/resume',{threadId,excludeTurns:true});}
  async turn({threadId,text,mode,effort,model,cwd}){const isAgent=mode==='agent';const sandboxPolicy=isAgent?{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false}:{type:'readOnly'};const p={threadId,input:[{type:'text',text}],approvalPolicy:'on-request',sandboxPolicy,effort:effort||'medium',summary:'concise'};if(model)p.model=model;if(cwd)p.cwd=cwd;return this.request('turn/start',p,40000);}
  async interrupt(threadId,turnId){return this.request('turn/interrupt',{threadId,turnId});}
  close(){this._failAll(Error('Application closed'));if(this.proc){this.proc.kill();this.proc=null;}this.ready=null;}
}
module.exports={CodexClient};
