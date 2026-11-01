'use strict';
const fs=require('node:fs'),path=require('node:path'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const run=promisify(execFile),{WakeListener}=require('../frontend/original-cody/src/voice/wake-listener');
const root=path.resolve(__dirname,'..'),script=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'frontend/original-cody/windows/wake-listener.ps1');
(async()=>{
 const samples=[...['hey','ok','okay','cody'].map(alias=>({file:`wake-hazel-only-${alias}.wav`,expected:true})),{file:'wake-hazel-hey.wav',expected:true},...['wake-negative.wav','wake-negative-name.wav',...Array.from({length:8},(_,i)=>`wake-ordinary-${i}.wav`)].map(file=>({file,expected:false}))];
 const results=[];
 for(const sample of samples){
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-TestAudioPath',path.join(root,'reports',sample.file)],{windowsHide:true,timeout:20000});
  const recognized=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line)).find(value=>value.type==='test');
  const listener=new WakeListener({handleCommand:async()=>({started:true})});listener.enabled=true;listener.ready=true;listener.phrases=['hey cody','ok cody','okay cody','cody'];listener.wire='listen';listener.child={stdin:{write(){},end(){}},kill(){}};
  let accepted;try{accepted=await listener.accept(recognized);}finally{listener.close();}
  results.push({...sample,recognized,accepted,passed:accepted===sample.expected});
 }
 const report={passed:results.every(r=>r.passed),results};fs.writeFileSync(path.join(root,process.argv[2]?'reports/wake-candidate-results.json':'reports/wake-audio-rejection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
