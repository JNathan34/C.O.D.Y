'use strict';
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {whatsappScript}=require('./whatsapp-web-dom');

const HOME='https://web.whatsapp.com/';
const ORIGIN=new URL(HOME).origin;
const PARTITION='persist:cody-whatsapp-web';
const originMatches=value=>{try{return new URL(value).origin===ORIGIN;}catch{return false;}};

function bounded(promise,ms){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WhatsApp Web timed out.')),ms);})])
    .finally(()=>clearTimeout(timer));
}

class WhatsAppWeb{
  constructor({BrowserWindow,session,icon,enabled,now=Date.now}){
    Object.assign(this,{BrowserWindow,session,icon,enabled,now});
    this.recent=new Map();
  }
  cancel(){this.operation?.abort();}
  close(){this.cancel();if(this.win&&!this.win.isDestroyed())this.win.destroy();}
  async ensure(){
    if(this.win&&!this.win.isDestroyed()){
      await this.loading;
      return this.win;
    }
    const session=this.session.fromPartition(PARTITION);
    session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    session.setPermissionCheckHandler(()=>false);
    const win=this.win=new this.BrowserWindow({title:'WhatsApp Web · C.O.D.Y.',icon:this.icon,width:1060,height:760,show:false,autoHideMenuBar:true,
      webPreferences:{partition:PARTITION,contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const event of ['will-navigate','will-redirect'])win.webContents.on(event,(e,url)=>{
      if(!originMatches(url))e.preventDefault();
    });
    win.on('close',e=>{e.preventDefault();win.hide();});
    win.on('closed',()=>{if(this.win===win)this.win=null;});
    this.loading=bounded(win.loadURL(HOME),12000);
    try{await this.loading;return win;}
    catch(error){if(!win.isDestroyed())win.destroy();throw error;}
    finally{this.loading=null;}
  }
  async link(){
    if(this.operation)throw Error('Wait for the current WhatsApp message to finish.');
    const win=await this.ensure();
    if(this.operation)throw Error('Wait for the current WhatsApp message to finish.');
    win.show();win.focus();
    return this.status();
  }
  async page(win,action,args){
    if(win.isDestroyed()||!originMatches(win.webContents.getURL()))throw Error('WhatsApp Web is unavailable.');
    return bounded(win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:whatsappScript(action,args)}],true),2200);
  }
  async status({check=false}={}){
    let state={};
    try{
      if(check&&!this.operation)await this.ensure();
      if(this.win&&!this.loading&&!this.operation)state=await this.page(this.win,'status')||{};
    }catch{state={unavailable:true};}
    return {enabled:this.enabled(),ready:state.ready===true,login:state.login===true,unavailable:state.unavailable===true,busy:Boolean(this.operation)};
  }
  async wait(read,signal,ms){
    const deadline=Date.now()+ms;
    do{
      signal.throwIfAborted();
      const result=await read();
      signal.throwIfAborted();
      if(result)return result;
      await delay(160,undefined,{signal});
    }while(Date.now()<deadline);
    return null;
  }
  async send({recipient,phone,text},{signal:cancel}={}){
    if(!this.enabled())return 'disabled';
    if(this.operation)return 'busy';
    const controller=this.operation=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(26000),...(cancel?[cancel]:[])]);
    const query=phone?'+'+phone:recipient;
    const key=createHash('sha256').update(JSON.stringify([query.normalize('NFKC').trim().toLowerCase(),text])).digest('hex');
    let win,target,filled=false,attempted=false;
    try{
      for(const [id,record]of this.recent)if(record.expires<=this.now())this.recent.delete(id);
      if(this.recent.has(key))return this.recent.get(key).sent?'already-sent':'uncertain';
      win=await this.ensure();signal.throwIfAborted();
      if(win.isVisible())return 'window-open';
      const status=await this.wait(async()=>{const state=await this.page(win,'status');return state?.ready||state?.login?state:null;},signal,6500);
      if(!status?.ready)return status?.login?'not-linked':'unavailable';
      signal.throwIfAborted();
      if(!await this.page(win,'new-chat'))return 'unavailable';
      if(!await this.wait(()=>this.page(win,'search-ready'),signal,3000))return 'unavailable';
      signal.throwIfAborted();
      if(!await this.page(win,'query',{query}))return 'unavailable';
      await delay(650,undefined,{signal});
      const lookup={query,phone};
      let lastCount=-1;
      const matches=await this.wait(async()=>{
        const next=await this.page(win,'matches',lookup);
        if(!next||next.incomplete){lastCount=-1;return null;}
        const stable=next.count===lastCount;lastCount=next.count;
        return next.count>0&&stable?next:null;
      },signal,4300);
      if(!matches)return 'not-found';
      if(matches.count!==1)return 'ambiguous';
      signal.throwIfAborted();
      target=await this.page(win,'choose',lookup);
      if(!target?.name||!await this.wait(()=>this.page(win,'composer',target),signal,3000))return 'unverified';
      signal.throwIfAborted();
      const draft=await this.page(win,'fill',{...target,text});
      if(draft?.status!=='filled')return draft?.status==='existing-draft'?'existing-draft':'unverified';
      filled=true;
      await delay(220,undefined,{signal});
      signal.throwIfAborted();
      if(win.isVisible()||!this.enabled())return 'unverified';
      if(this.recent.size>=100)this.recent.delete(this.recent.keys().next().value);
      this.recent.set(key,{expires:this.now()+5*60*1000,sent:false});
      attempted=true;
      if(!await this.page(win,'send',{...target,text})){
        attempted=false;this.recent.delete(key);return 'unverified';
      }
      const receipt=await this.wait(async()=>{
        const state=await this.page(win,'receipt',{...target,text,seen:draft.seen});
        return state?.sent===true;
      },signal,5500);
      if(!receipt)return 'uncertain';
      this.recent.set(key,{expires:this.now()+30000,sent:true});
      return 'sent';
    }catch{return attempted?'uncertain':controller.signal.aborted||cancel?.aborted?'cancelled':'unavailable';}
    finally{
      if(filled&&!attempted&&win&&!win.isDestroyed()&&!win.isVisible())
        await this.page(win,'clear-draft',{...target,text}).catch(()=>{});
      this.operation=null;
    }
  }
}

module.exports={WhatsAppWeb};
