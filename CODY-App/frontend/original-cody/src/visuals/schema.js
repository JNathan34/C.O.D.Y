'use strict';
// Extended from CODY-Visual-Engine-Package's original starter validator.
const ACTIONS=Object.freeze(['scene.status','scene.create','scene.move','scene.clear','model.createPrimitive','model.create','model.generate','model.generateDetailed','model.load','model.move','model.rotate','model.scale','model.animate','model.select','model.setMaterial','model.remove']);
const PRIMITIVES=['box','sphere','cylinder','cone','torus',...require('./kernel-schema').KINDS];
const MATERIALS=['standard','matte','metal','glass'];
const DEFAULTS=Object.freeze({enabled:true,maxModels:12,maxParts:256,displayId:'primary',width:440,height:380,animations:true,planner:'balanced'});
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('validation_failed: arguments must be an object');return value;}
function keys(value,allowed){object(value);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error('validation_failed: unexpected field '+key);}
function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('validation_failed: invalid '+label);return value;}
function id(value,target=false){if(typeof value!=='string'||!(target?/^[\w-]{1,64}(?::[\w-]{1,64})?$/:/^[\w-]{1,64}$/).test(value))throw Error('validation_failed: invalid model ID');return value;}
function vector(value,kind='position'){if(!Array.isArray(value)||value.length!==3)throw Error('validation_failed: '+kind+' requires three numbers');return value.map(n=>number(n,kind==='scale'?.01:kind==='rotation'?-36000:-30,kind==='scale'?20:kind==='rotation'?36000:30,kind));}
function color(value){if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error('validation_failed: use a hex colour');return value.toUpperCase();}
function text(value,label,max=120){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('validation_failed: invalid '+label);return value.trim();}
function transform(a){return {position:a.position===undefined?[0,0,0]:vector(a.position),rotation:a.rotation===undefined?[0,0,0]:vector(a.rotation,'rotation'),scale:a.scale===undefined?[1,1,1]:vector(a.scale,'scale')};}
function material(a){if(a.material!==undefined&&!MATERIALS.includes(a.material))throw Error('validation_failed: unsupported material');return {color:color(a.color||'#009DFF'),material:a.material||'standard'};}
function display(value){if(typeof value!=='string'&&typeof value!=='number')throw Error('display_not_found: display ID is required');const result=String(value);if(!/^[-\w]{1,64}$/.test(result))throw Error('display_not_found: invalid display ID');return result;}
function settings(patch={},base=DEFAULTS){keys(patch,Object.keys(DEFAULTS));const result={...base};for(const [key,value]of Object.entries(patch)){
 if(['enabled','animations'].includes(key)){if(typeof value!=='boolean')throw Error('Invalid visual setting '+key);result[key]=value;}
 else if(key==='planner'){if(!['balanced','fast','quality','chatgpt'].includes(value))throw Error('Invalid visual planner');result[key]=value;}
 else if(key==='displayId')result[key]=display(value);
 else {number(value,key==='maxModels'?1:key==='maxParts'?1:240,key==='maxModels'?24:key==='maxParts'?512:1000,key);if(!Number.isInteger(value))throw Error('Visual setting must be an integer');result[key]=value;}
 }return result;}
function validate(action,input={}){
 if(!ACTIONS.includes(action))throw Error('validation_failed: unsupported scene command');object(input);const a={...input};
 if(['scene.status','scene.clear','scene.create','scene.move'].includes(action)){
  keys(a,action==='scene.status'||action==='scene.clear'?[]:['name','displayId','x','y','width','height']);
  if(a.name!==undefined)a.name=text(a.name,'scene name',80);
  if(a.displayId!==undefined)a.displayId=display(a.displayId);
  for(const key of ['x','y','width','height'])if(a[key]!==undefined)number(a[key],['x','y'].includes(key)?-100000:240,['x','y'].includes(key)?100000:1000,key);
  return a;
 }
 if(action==='model.generateDetailed'){keys(a,['description']);return {description:text(a.description,'description',1500)};}
 if(action==='model.generate'){
  keys(a,['id','preset','label','position','rotation','scale','color','material']);id(a.id);
  if(!['computer','robot','tree'].includes(a.preset))throw Error('provider_unavailable: procedural presets are computer, robot and tree; detailed generation is not configured');
  return {...a,...transform(a),...(a.label===undefined?{}:{label:text(a.label,'label')}),...(a.color===undefined?{}:{color:color(a.color)}),...(a.material===undefined?{}:{material:material(a).material})};
 }
 const target=['model.move','model.rotate','model.scale','model.animate','model.select','model.setMaterial','model.remove'].includes(action);
 id(a.id,target);
 if(action==='model.createPrimitive'){
  keys(a,['id','primitive','recipe','label','position','rotation','scale','color','material']);if(!PRIMITIVES.includes(a.primitive))throw Error('validation_failed: unsupported primitive');
  return {...a,recipe:require('./kernel-schema').recipe(a.primitive,a.recipe),label:a.label===undefined?a.id:text(a.label,'label'),...transform(a),...material(a)};
 }
 if(action==='model.create'){
  keys(a,['id','label','position','rotation','scale','parts']);if(!Array.isArray(a.parts)||!a.parts.length||a.parts.length>64)throw Error('validation_failed: model needs 1–64 parts');
  const known=new Set();const parts=a.parts.map(part=>{keys(part,['id','parentId','primitive','recipe','position','rotation','scale','color','material']);id(part.id);if(known.has(part.id)||part.parentId&&!known.has(part.parentId))throw Error('validation_failed: parts must have unique IDs and parents before children');known.add(part.id);if(!PRIMITIVES.includes(part.primitive))throw Error('validation_failed: unsupported part primitive');return {...part,recipe:require('./kernel-schema').recipe(part.primitive,part.recipe),...transform(part),...material(part)};});
  return {...a,label:a.label===undefined?a.id:text(a.label,'label'),...transform(a),parts};
 }
 if(action==='model.load'){keys(a,['id','label','assetId','position','rotation','scale']);return {...a,label:a.label===undefined?a.id:text(a.label,'label'),assetId:id(a.assetId),...transform(a)};}
 if(action==='model.move'){keys(a,['id','position']);return {id:a.id,position:vector(a.position)};}
 if(action==='model.rotate'){keys(a,['id','rotation']);return {id:a.id,rotation:vector(a.rotation,'rotation')};}
 if(action==='model.scale'){keys(a,['id','scale']);return {id:a.id,scale:vector(a.scale,'scale')};}
 if(action==='model.setMaterial'){keys(a,['id','color','material']);if(a.color===undefined&&a.material===undefined)throw Error('validation_failed: specify a material or colour');return {id:a.id,...(a.color===undefined?{}:{color:color(a.color)}),...(a.material===undefined?{}:{material:material(a).material})};}
 if(action==='model.animate'){
  keys(a,['id','property','to','durationMs','easing','start']);if(!['position','rotation','scale'].includes(a.property))throw Error('validation_failed: unsupported animation property');
  if(a.easing!==undefined&&!['linear','smooth'].includes(a.easing))throw Error('validation_failed: unsupported easing');
  if(a.start!==undefined&&!['now','speech'].includes(a.start))throw Error('validation_failed: invalid animation start');
  return {...a,to:vector(a.to,a.property),durationMs:number(a.durationMs,50,60000,'durationMs'),easing:a.easing||'smooth',start:a.start||'now'};
 }
 keys(a,['id']);return {id:a.id};
}
module.exports={ACTIONS,PRIMITIVES,MATERIALS,DEFAULTS,settings,validate,vector,id,number,keys};
