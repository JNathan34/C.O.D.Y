'use strict';
const DEFAULTS=Object.freeze({enabled:true,color:'#009DFF',glowIntensity:.45,animationMs:350,defaultDurationMs:5000,speechLinkedRemoval:true,automaticClearing:true,maxConcurrent:40,spotlight:true});
const KINDS=['circle','rectangle','arrow','line','text','underline','spotlight','path','card'];
const ACTIONS=Object.freeze([...KINDS.map(kind=>'draw.'+kind),'draw.clear','draw.remove','draw.update','draw.batch','draw.status']);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object');}
function keys(value,allowed){for(const key of Object.keys(value))if(!allowed.includes(key))throw Error('Unknown annotation field: '+key);}
function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('Invalid annotation '+label);return value;}
function id(value){if(typeof value!=='string'||!/^[-\w:.]{1,100}$/.test(value))throw Error('Invalid annotation ID');return value;}
function color(value){if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error('Use an annotation colour such as #009DFF');return value.toUpperCase();}
function settings(patch={},base=DEFAULTS){object(patch,'Annotation settings');keys(patch,Object.keys(DEFAULTS));const result={...base};for(const [key,value]of Object.entries(patch)){
 if(typeof DEFAULTS[key]==='boolean'){if(typeof value!=='boolean')throw Error('Invalid annotation setting: '+key);result[key]=value;}
 else if(key==='color')result.color=color(value);
 else if(key==='glowIntensity')result[key]=number(value,0,1,key);
 else if(key==='maxConcurrent'){number(value,1,120,key);if(!Number.isInteger(value))throw Error('Annotation limit must be an integer');result[key]=value;}
 else result[key]=number(value,key==='animationMs'?0:500,key==='animationMs'?2000:120000,key);
}return result;}
const STYLE=['id','targetId','relative','color','strokeWidth','glow','opacity','durationMs','animationMs','mode','space','captureId','displayId'];
const GEOMETRY={circle:['x','y','radius'],rectangle:['x','y','width','height'],arrow:['x','y','toX','toY'],line:['x','y','toX','toY','controlX','controlY'],text:['x','y','text','fontSize'],underline:['x','y','width'],spotlight:['x','y','width','height'],path:['points'],card:['x','y','width','height','marks']};
function validate(action,input={}){
 if(!ACTIONS.includes(action))throw Error('Unsupported drawing command');object(input,'Annotation arguments');
 if(action==='draw.status'){keys(input,[]);return {};}
 if(action==='draw.batch'){
  keys(input,['commands']);if(!Array.isArray(input.commands)||!input.commands.length||input.commands.length>32)throw Error('Annotation batches contain 1–32 commands');
  return {commands:input.commands.map(command=>{object(command,'Drawing command');keys(command,['action','args']);if(command.action==='draw.batch')throw Error('Nested annotation batches are not allowed');return {action:command.action,args:validate(command.action,command.args)};})};
 }
 if(action==='draw.remove'){keys(input,['id']);return {id:id(input.id)};}
 if(action==='draw.clear'){keys(input,['ids']);if(input.ids===undefined)return {};if(!Array.isArray(input.ids)||input.ids.length>120)throw Error('Invalid annotation ID list');return {ids:input.ids.map(id)};}
 if(action==='draw.update'){
  keys(input,['id','changes']);object(input.changes,'Annotation changes');keys(input.changes,[...STYLE.filter(key=>key!=='id'),...new Set(Object.values(GEOMETRY).flat())]);
  if(!Object.keys(input.changes).length)throw Error('Provide annotation changes');
  return {id:id(input.id),changes:JSON.parse(JSON.stringify(input.changes))};
 }
 const kind=action.slice(5),geometry=GEOMETRY[kind];keys(input,[...STYLE,...geometry]);const result={...input};
 if(input.space!==undefined&&!['desktop-dip','display-normalized','capture-normalized','capture-pixels'].includes(input.space))throw Error('Invalid annotation coordinate space');
 if(input.captureId!==undefined)id(input.captureId);
 if(input.displayId!==undefined&&(!['string','number'].includes(typeof input.displayId)||String(input.displayId).length>100))throw Error('Invalid display ID');
 if(input.space?.startsWith('capture-')&&!input.captureId)throw Error('Capture coordinates require a trusted capture ID');
 if(input.space==='display-normalized'&&(typeof input.displayId!=='string'&&typeof input.displayId!=='number'))throw Error('Display-normalized coordinates require a display ID');
 for(const key of ['id','targetId'])if(own(input,key))result[key]=id(input[key]);
 for(const key of ['relative','glow'])if(own(input,key)&&typeof input[key]!=='boolean')throw Error('Invalid annotation '+key);
 if(own(input,'color'))result.color=color(input.color);
 for(const [key,min,max]of [['strokeWidth',1,16],['opacity',.05,1],['durationMs',0,120000],['animationMs',0,2000],['fontSize',10,64]])if(own(input,key))number(input[key],min,max,key);
 if(input.mode!==undefined&&!['temporary','speech','persistent'].includes(input.mode))throw Error('Invalid annotation lifetime mode');
 if(input.durationMs===0&&input.mode!=='persistent')throw Error('A zero duration requires persistent mode');
 for(const key of geometry.filter(key=>!['text','points','marks'].includes(key))){
  if(input[key]===undefined){if(!input.targetId&&!(kind==='card'&&['x','y'].includes(key))&&!['controlX','controlY','fontSize'].includes(key))throw Error('Missing annotation '+key);continue;}
  number(input[key],['width','height','radius'].includes(key)?0.001:-100000,50000,key);
 }
 if((input.controlX===undefined)!==(input.controlY===undefined))throw Error('A curved line needs both control coordinates');
 if(kind==='card'){result.marks=require('../visuals/card').marks(input.marks);if(input.width>1000||input.height>1000)throw Error('Visual card is too large');}
 if(kind==='text'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>500))throw Error('Annotation text must contain 1–500 characters');
 if(kind==='path'&&(!input.targetId||input.points!==undefined)){
  if(!Array.isArray(input.points)||input.points.length<2||input.points.length>256)throw Error('A drawing path needs 2–256 points');
  result.points=input.points.map(point=>{object(point,'Path point');keys(point,['x','y']);return {x:number(point.x,-100000,100000,'path x'),y:number(point.y,-100000,100000,'path y')};});
 }
 return result;
}
module.exports={DEFAULTS,KINDS,ACTIONS,settings,validate,GEOMETRY};
