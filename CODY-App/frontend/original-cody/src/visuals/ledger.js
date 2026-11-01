'use strict';
const {createHash}=require('node:crypto');
const META=['requestId','turnId','sequence'];
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function splitMetadata(input){
 const args={...input},metadata={};
 for(const key of META)if(Object.hasOwn(args,key)){metadata[key]=args[key];delete args[key];}
 for(const key of ['requestId','turnId'])if(metadata[key]!==undefined&&(typeof metadata[key]!=='string'||!/^[-\w:.]{1,100}$/.test(metadata[key])))throw Error('validation_failed: invalid '+key);
 if(metadata.sequence!==undefined&&(!Number.isSafeInteger(metadata.sequence)||metadata.sequence<1||metadata.sequence>1000000000))throw Error('validation_failed: invalid sequence');
 return {args,metadata};
}
class VisualLedger{
 constructor(){this.scope='gui';this.sequence=0;this.requests=new Map();this.generation=0;this.queue=Promise.resolve();}
 begin(scope){this.scope=scope;this.sequence=0;this.requests.clear();this.generation++;}
 execute(action,input,context,run){
  const {args,metadata}=splitMetadata(input),generation=this.generation;
  const work=async()=>{
   if(generation!==this.generation||context.signal?.aborted||context.origin==='ai-chat'&&context.scopeId!==this.scope||metadata.turnId&&metadata.turnId!==(context.scopeId||this.scope))throw Error('stale_turn: visual command belongs to an inactive task');
   const hash=createHash('sha256').update(JSON.stringify(stable({action,args}))).digest('hex');
   if(metadata.requestId&&this.requests.has(metadata.requestId)){const previous=this.requests.get(metadata.requestId);if(previous.hash!==hash)throw Error('validation_failed: request ID was reused with different arguments');return {...previous.result,duplicate:true};}
   if(metadata.sequence!==undefined&&metadata.sequence<=this.sequence)throw Error('duplicate_sequence: visual sequence must increase');
   const sequence=metadata.sequence??this.sequence+1;this.sequence=sequence;
   const result=await run(args,{...context,sequence,turnId:context.scopeId||this.scope});
   if(generation!==this.generation||context.signal?.aborted)throw Error('stale_turn: visual command was cancelled');
   const response={...result,turnId:context.scopeId||this.scope,sequence};
   if(metadata.requestId){this.requests.set(metadata.requestId,{hash,result:response});while(this.requests.size>256)this.requests.delete(this.requests.keys().next().value);}
   return response;
  };
  const pending=this.queue.then(work);this.queue=pending.catch(()=>{});return pending;
 }
}
module.exports={VisualLedger,splitMetadata};
