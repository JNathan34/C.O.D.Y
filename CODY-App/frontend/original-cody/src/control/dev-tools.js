'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {rootOf,locate}=require('./file-engine');
const PRESETS=new Set(['git.status','git.diff','npm.test','npm.build','node.check']);
function validate(action,args){
 if(action==='terminal.run'){
  if(typeof args.preset!=='string'||!PRESETS.has(args.preset))throw Error('Only approved terminal presets are supported');
  if(args.preset==='node.check' && (typeof args.path!=='string'||args.path.length>1024))throw Error('node.check requires relative file path');
  return {preset:args.preset,...(args.preset==='node.check'?{path:args.path}:{})};
 }
 if(action==='code.check'){if(typeof args.path!=='string'||args.path.length>1024)throw Error('Specify a JavaScript file path');return {path:args.path};}
 return {};
}
function run(executable,args,cwd,{timeout=25000,spawnFn=spawn}={}){
 return new Promise((resolve,reject)=>{
  let closed=false,stdout='',stderr='';const opts={cwd,windowsHide:true,shell:false,env:{...process.env,NODE_ENV:'test',CI:'1'},stdio:['ignore','pipe','pipe']};
  const proc=spawnFn(executable,args,opts);
  const timer=setTimeout(()=>{proc.kill('SIGKILL');done(Error('Developer command timed out'));},timeout);
  function done(err,result){if(closed)return;closed=true;clearTimeout(timer);if(err)reject(err);else resolve(result);}
  const collect=(key,x)=>{const v=x.toString();if(key==='stdout')stdout+=v;else stderr+=v;if(stdout.length+stderr.length>65000){proc.kill('SIGKILL');done(Error('Developer command exceeded output limit'));}};
  proc.stdout.on('data',data=>collect('stdout',data));proc.stderr.on('data',data=>collect('stderr',data));proc.on('error',done);
  proc.on('close',code=>done(null,{exitCode:code,stdout:stdout.slice(0,20000),stderr:stderr.slice(0,12000),success:code===0}));
 });
}
async function execute(root,action,args,runner=run){const cwd=rootOf(root);let preset=action==='code.test'?'npm.test':action==='code.build'?'npm.build':action==='code.check'?'node.check':args.preset;
 let exe,argv;if(preset==='node.check'){
  const file=locate(cwd,args.path,{kind:'file'});if(!/\.(?:js|mjs|cjs)$/.test(file))throw Error('Only JavaScript syntax checks are supported');exe=process.execPath;argv=['--check',file];
 }else if(preset==='git.status'){exe='git';argv=['status','--short'];}
 else if(preset==='git.diff'){exe='git';argv=['diff','--stat'];}
 else if(preset==='npm.test'||preset==='npm.build'){
  const f=locate(cwd,'package.json',{kind:'file'}),obj=JSON.parse(fs.readFileSync(f,'utf8'));
  const name=preset==='npm.test'?'test':'build';if(typeof obj.scripts?.[name]!=='string')throw Error('This project has no npm '+name+' script');
  exe=process.platform==='win32'?'cmd.exe':'npm';argv=process.platform==='win32'?['/d','/c','npm','run',name]:['run',name];
 }else throw Error('Unknown terminal preset');
 return runner(exe,argv,cwd,{timeout:30000});
}
module.exports={PRESETS,validate,execute,run};
