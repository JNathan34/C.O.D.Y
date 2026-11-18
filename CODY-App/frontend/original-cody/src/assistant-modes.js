'use strict';
const fs=require('node:fs'),path=require('node:path');
const PROFILE_KEYS=['visibility','idleReactions','funReactions','reactiveExpressions','wifiReactions','animationSpeed','islandSize','speechSubtitles'];
const profiles={
 normal:{name:'Normal',island:{visibility:'always',idleReactions:'subtle',funReactions:true,reactiveExpressions:true,wifiReactions:true,animationSpeed:'normal'},voiceAutoSpeak:true},
 focus:{name:'Focus',island:{visibility:'activity',idleReactions:'off',funReactions:false,reactiveExpressions:false,wifiReactions:false,animationSpeed:'off',speechSubtitles:false},voiceAutoSpeak:false},
 work:{name:'Work',island:{visibility:'activity',idleReactions:'subtle',funReactions:false,wifiReactions:false,animationSpeed:'normal'},voiceAutoSpeak:false},
 gaming:{name:'Gaming',island:{visibility:'hover',idleReactions:'off',funReactions:false,wifiReactions:false,animationSpeed:'fast'},voiceAutoSpeak:false}
};
const validName=name=>typeof name==='string'&&/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(name.trim());
function cleanProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!validName(value.name)||typeof value.voiceAutoSpeak!=='boolean')return null;
 const island={};
 for(const key of PROFILE_KEYS)if(Object.hasOwn(value.island||{},key)){
  const val=value.island[key];
  if(typeof val==='string'&&val.length<32||typeof val==='boolean')island[key]=val;
 }
 return {name:value.name.trim(),island,voiceAutoSpeak:value.voiceAutoSpeak};
}
class AssistantModes{
 constructor({file,island,store,onChange=()=>{}}){
  Object.assign(this,{file,island,store,onChange});this.custom={};this.active='normal';
  try{
   const saved=JSON.parse(fs.readFileSync(file,'utf8'));
   for(const [id,value]of Object.entries(saved.custom||{})){
    if(/^custom:[a-z\d-]{1,40}$/.test(id)&&Object.keys(this.custom).length<20){
     const entry=cleanProfile(value);if(entry)this.custom[id]=entry;
    }
   }
   if(typeof saved.active==='string'&&(profiles[saved.active]||this.custom[saved.active]))this.active=saved.active;
  }catch{}
 }
 list(){return {active:this.active,items:[...Object.entries(profiles),...Object.entries(this.custom)].map(([id,value])=>({id,name:value.name,custom:id.startsWith('custom:')}))};}
 persist(){
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({active:this.active,custom:this.custom}),{encoding:'utf8',mode:0o600});fs.renameSync(tmp,this.file);
 }
 activate(id){
  const entry=profiles[id]||this.custom[id];if(!entry)throw Error('Unknown assistant mode.');
  const next=this.island.updatePreferences(entry.island);
  this.store.settings({voiceAutoSpeak:entry.voiceAutoSpeak});
  this.active=id;this.persist();this.onChange();
  return {...this.list(),message:entry.name+' mode enabled.'};
 }
 save(name){
  if(!validName(name))throw Error('Choose a mode name up to 40 characters (letters, numbers, spaces, dot, dash or underscore).');
  if(Object.keys(this.custom).length>=20)throw Error('You can save up to 20 custom modes.');
  const id='custom:'+name.trim().toLowerCase().replace(/[^a-z\d]+/g,'-').replace(/^-|-$/g,'').slice(0,35);
  if(id==='custom:'||profiles[id]||this.custom[id])throw Error('A mode with that name already exists.');
  const preferences=this.island.preferences();
  this.custom[id]={name:name.trim(),island:Object.fromEntries(PROFILE_KEYS.filter(key=>key in preferences).map(key=>[key,preferences[key]])),
    voiceAutoSpeak:this.store.data.settings.voiceAutoSpeak===true};
  this.persist();this.onChange();return this.list();
 }
 remove(id){if(!Object.hasOwn(this.custom,id))throw Error('Only your own modes can be deleted.');delete this.custom[id];if(this.active===id)this.active='normal';this.persist();this.onChange();return this.list();}
}
module.exports={AssistantModes,PROFILE_KEYS};
