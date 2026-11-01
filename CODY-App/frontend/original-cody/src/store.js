'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {suggestedTitle} = require('./router');
const {DEFAULT_PERMISSIONS,normalizePermissions}=require('./control/policy');
const {DEFAULTS:ANNOTATION_DEFAULTS,settings:annotationSettings}=require('./annotations/schema');
const {DEFAULTS:VISUAL_DEFAULTS,settings:visualSettings}=require('./visuals/schema');
function storedVisuals(value){try{return visualSettings(value||{});}catch{return {...VISUAL_DEFAULTS};}}
function storedAnnotations(value){try{return annotationSettings(value||{});}catch{return {...ANNOTATION_DEFAULTS};}}
const defaults = Object.freeze({assistantProvider:'heyclicky',visuals:VISUAL_DEFAULTS,annotations:ANNOTATION_DEFAULTS,computerControl:{...DEFAULT_PERMISSIONS},cloudProvider:'codex',defaultReasoning:'medium',optimiseContext:true,confirmExpensiveTasks:true,localAI:false,model:'',webModel:'website',workingFolder:'',appearance:'dark',runInBackground:true,startMinimized:false,voiceAutoSpeak:false,voiceAutoSend:true});
class StateStore {
  setNativePermissions(value){
    if(!value||!['ask','approve-safe','full','custom'].includes(value.level)||['enabled','readApps','extraUsage'].some(key=>typeof value[key]!=='boolean'))throw Error('Invalid backend permissions');
    this.data.settings.nativePermissions={enabled:value.enabled,level:value.level,readApps:value.readApps,extraUsage:value.extraUsage,computerUse:value.computerUse!==false,backgroundTasks:value.backgroundTasks!==false,workingFolder:typeof value.workingFolder==='string'?value.workingFolder:null};this.save();return this.data.settings.nativePermissions;
  }
  constructor(directory){this.directory=directory;this.file=path.join(directory,'cody-state.json'); this.data={settings:{...defaults},chats:[],activeChatId:null};this.load();}
  load(){try{const obj=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!obj||typeof obj!=='object')return;this.data.settings={...defaults,...(obj.settings||{}),computerControl:normalizePermissions(obj.settings?.computerControl),annotations:storedAnnotations(obj.settings?.annotations),visuals:storedVisuals(obj.settings?.visuals),localAI:false,cloudProvider:'codex'};this.data.chats=Array.isArray(obj.chats)?obj.chats.filter(c=>c&&typeof c.id==='string').slice(0,150):[];this.data.activeChatId=obj.activeChatId||null;}catch(e){if(e.code!=='ENOENT'){try{fs.renameSync(this.file,this.file+'.corrupt-'+Date.now());}catch{}}}}
  save(){if(this.pendingSave){clearTimeout(this.pendingSave);this.pendingSave=null;}fs.mkdirSync(this.directory,{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),'utf8');fs.renameSync(tmp,this.file);}
  publicState(){return JSON.parse(JSON.stringify(this.data));}
  settings(change){const nextVisuals=Object.hasOwn(change,'visuals')?visualSettings(change.visuals,this.data.settings.visuals):null;const nextAnnotations=Object.hasOwn(change,'annotations')?annotationSettings(change.annotations,this.data.settings.annotations):null;if(Object.hasOwn(change,'assistantProvider')&&!['heyclicky','codex','chatgpt'].includes(change.assistantProvider))throw Error('Invalid assistant provider');const editable=['assistantProvider','defaultReasoning','optimiseContext','confirmExpensiveTasks','model','webModel','workingFolder','appearance','runInBackground','startMinimized','voiceAutoSpeak','voiceAutoSend'];for(const key of editable){if(Object.prototype.hasOwnProperty.call(change,key))this.data.settings[key]=change[key];}if(nextAnnotations)this.data.settings.annotations=nextAnnotations;if(nextVisuals)this.data.settings.visuals=nextVisuals;if(Object.prototype.hasOwnProperty.call(change,'computerControl'))this.data.settings.computerControl=normalizePermissions(this.data.settings.computerControl,change.computerControl);this.data.settings.localAI=false;if(!/^(website|(6|6\.1-sol|5\.6):(low|medium|high|xhigh))$/.test(this.data.settings.webModel||''))this.data.settings.webModel='website';this.data.settings.cloudProvider='codex';this.save();return this.data.settings;}
  newChat(){const c={id:randomUUID(),title:'New chat',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),threadId:null,webThreadId:null,webThreadModel:null,webUrl:null,messages:[],usage:null};this.data.chats.unshift(c);this.data.activeChatId=c.id;this.save();return c;}
  select(id){if(!this.chat(id))throw Error('Chat not found');this.data.activeChatId=id;this.save();}
  chat(id){return this.data.chats.find(c=>c.id===id);}
  deleteChat(id){this.data.chats=this.data.chats.filter(c=>c.id!==id);if(this.data.activeChatId===id)this.data.activeChatId=this.data.chats[0]?.id||null;this.save();}
  addMessage(id,role,text,mode){const chat=this.chat(id);if(!chat)throw Error('Chat not found');const msg={id:randomUUID(),role,text:String(text).slice(0,200000),mode:mode||'chat',at:new Date().toISOString()};chat.messages.push(msg);chat.messages=chat.messages.slice(-120);if(role==='user'&&chat.title==='New chat')chat.title=suggestedTitle(text);chat.updatedAt=new Date().toISOString();this.save();return msg;}
  appendMessage(id,messageId,delta){const chat=this.chat(id);if(!chat)return;const msg=chat.messages.find(m=>m.id===messageId);if(msg)msg.text+=String(delta);this.save();}
  updateMessage(id,messageId,text,{persist=true}={}){const chat=this.chat(id);if(!chat)return;const msg=chat.messages.find(m=>m.id===messageId);if(msg)msg.text=String(text);if(persist)this.save();else this.scheduleSave();}
  scheduleSave(){if(this.pendingSave)return;this.pendingSave=setTimeout(()=>{this.pendingSave=null;this.save();},1200);this.pendingSave.unref?.();}
  setThread(id,threadId){const chat=this.chat(id);if(chat){chat.threadId=threadId;this.save();}}
  setWebThread(id,threadId,model){const chat=this.chat(id);if(chat){chat.webThreadId=threadId;chat.webThreadModel=model;this.save();}}
  setWebUrl(id,url){const chat=this.chat(id);if(chat){chat.webUrl=url;this.save();}}
  setUsage(id,usage){const chat=this.chat(id);if(chat){chat.usage=usage;this.save();}}
}
module.exports={StateStore,defaults};
