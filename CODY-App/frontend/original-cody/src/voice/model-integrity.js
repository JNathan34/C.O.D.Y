'use strict';
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const MODEL_BYTES=147964211;
const MODEL_SHA256='a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002';
const ACCURATE_MODEL_BYTES=190098681;
const ACCURATE_MODEL_SHA256='bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30';

function createModelVerifier({bytes=MODEL_BYTES,sha256=MODEL_SHA256}={}){
  const cache=new Map();
  return file=>{
    let descriptor;
    try{
      const stat=fs.statSync(file);
      const signature=[stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':');
      if(cache.get(file)?.signature===signature)return cache.get(file).valid;
      let valid=false;
      if(stat.isFile()&&stat.size===bytes){
        descriptor=fs.openSync(file,'r');
        const buffer=Buffer.alloc(1024*1024),hash=createHash('sha256');let count,total=0;
        while((count=fs.readSync(descriptor,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,count));total+=count;}
        const after=fs.fstatSync(descriptor);
        valid=total===bytes&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&hash.digest('hex')===sha256;
      }
      cache.set(file,{signature,valid});return valid;
    }catch{cache.delete(file);return false;}
    finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
  };
}
const verifyModel=createModelVerifier();
const verifyAccurateModel=createModelVerifier({bytes:ACCURATE_MODEL_BYTES,sha256:ACCURATE_MODEL_SHA256});
module.exports={MODEL_BYTES,MODEL_SHA256,ACCURATE_MODEL_BYTES,ACCURATE_MODEL_SHA256,createModelVerifier,verifyModel,verifyAccurateModel};
