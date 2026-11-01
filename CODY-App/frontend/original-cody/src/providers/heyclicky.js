'use strict';
const {execFile}=require('node:child_process'),path=require('node:path');
function discover(){return new Promise((resolve,reject)=>{
 if(process.platform!=='win32')return resolve({detected:false});
 const script=path.join(__dirname,'../../windows/discover-heyclicky.ps1').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
 execFile('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,timeout:10000,maxBuffer:65536},(error,stdout)=>{if(error)return reject(Error('HeyClicky installation discovery failed or timed out'));try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(Error('Invalid installation metadata'));}});
});}
class HeyClickyAdapter{
 constructor({probe=discover}={}){this.probe=probe;this.state={provider:'heyclicky',availability:'unavailable',initialised:false,connected:false,operations:[],reason:'Installation check pending.'};}
 async refresh(){if(this.pending)return this.pending;this.pending=(async()=>{try{const installation=await this.probe();this.state={provider:'heyclicky',availability:'unavailable',initialised:true,connected:false,operations:[],installation,checkedAt:new Date().toISOString(),reason:installation.detected?'HeyClicky is installed. No supported external conversation, speech or tool interface has been verified.':'HeyClicky installation was not found.'};}catch{this.state={...this.state,availability:'failed',initialised:true,connected:false,reason:'Installation check failed. Other C.O.D.Y. providers remain independent.'};}return this.status();})().finally(()=>{this.pending=null;});return this.pending;}
 status(){return structuredClone(this.state);}
 async send(){throw Error(this.state.reason+' Select Codex explicitly to continue.');}
}
module.exports={HeyClickyAdapter,discover};
