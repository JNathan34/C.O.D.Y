'use strict';
const KINDS=['capsule','pipe','spring','gear'];
function recipe(kind,value){
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid geometry recipe');
 const fields={capsule:['r','h','axis'],pipe:['r','points','seg'],spring:['r','h','coils','wire','axis'],gear:['r','w','teeth','tooth','hole','axis']}[kind];
 if(!fields&&Object.keys(value).length===0)return {};
 if(!fields||Object.keys(value).some(k=>!fields.includes(k)))throw Error('Unsupported geometry recipe field');
 const out={};for(const[k,v]of Object.entries(value)){
  if(k==='axis'){if(!['x','y','z','-x','-y','-z'].includes(v))throw Error('Invalid geometry axis');out[k]=v;}
  else if(k==='points'){if(!Array.isArray(v)||v.length<2||v.length>24||v.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>20)))throw Error('Invalid pipe points');out[k]=v.map(p=>[...p]);}
  else {const max=k==='teeth'?48:k==='coils'?12:k==='seg'?16:20;if(typeof v!=='number'||!Number.isFinite(v)||v<.001||v>max)throw Error('Invalid geometry recipe number');out[k]=v;}
 }return out;
}
module.exports={KINDS,recipe};
