'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {appPin}=require('../frontend/original-cody/src/control/app-layout');
module.exports=async({win,engine,controller})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let fixture;const pending=[];let buffer='';
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const command=value=>new Promise((resolve,reject)=>{pending.push({resolve,reject});fixture.stdin.write(JSON.stringify(value)+'\n');});
 try{
  await engine.start();await engine.refresh();await engine.request('text-client',{clientPid:process.pid});
  fixture=spawn(path.resolve(__dirname,'proofread-fixture/bin/Debug/net9.0-windows/Fixture.exe'),[],{windowsHide:false,stdio:['pipe','pipe','pipe']});
  fixture.stdout.setEncoding('utf8');const ready=new Promise((resolve,reject)=>pending.push({resolve,reject}));
  fixture.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{pending.shift()?.resolve(JSON.parse(line));}catch(error){pending.shift()?.reject(error);}}});
  fixture.on('error',error=>{for(const p of pending.splice(0))p.reject(error);});fixture.stderr.on('data',chunk=>results.push({name:'fixture stderr',passed:false,detail:String(chunk)}));
  await ready;await wait(300);
  const original='  Helo, this is a speling test.\r\nKeep my words!  ';
  let captured;for(let attempt=0;attempt<50;attempt++){const state=await command({command:'set',text:original});await wait(650);captured=await engine.request('text-capture',{clientPid:process.pid});if(captured.target)break;results.push({name:'capture focus retry',passed:true,detail:state});}check('captures real editable field',Boolean(captured.target),captured);
  const result=await controller.execute('text.proofread',{target:captured.target},{origin:'chat'});check('native HeyClicky spell check completes',result.ok,result);
  const field=await command({command:'get'});check('replaces typos and preserves all original formatting',field.text==='  Hello, this is a spelling test.\r\nKeep my words!  ',field);
  const selected='Helo outside. This speling inside.';
  await command({command:'set',text:selected,start:19,length:7});await wait(450);
  const selection=await engine.request('text-capture',{clientPid:process.pid});check('captures selected text',Boolean(selection.target));
  await controller.execute('text.proofread',{target:selection.target},{origin:'chat'});
  const selectedResult=await command({command:'get'});check('selected-text check leaves other spelling unchanged',selectedResult.text==='Helo outside. This spelling inside.',selectedResult);
  await command({command:'set',text:'Helo world'});await wait(400);
  const stale=await engine.request('text-capture',{clientPid:process.pid});await command({command:'set',text:'My newer text'});
  let refused;try{await controller.execute('text.proofread',{target:stale.target},{origin:'chat'});}catch(error){refused=error.message;}check('changed field is protected',/text box changed/.test(refused||''),refused);
  check('newer text survives unchanged',(await command({command:'get'})).text==='My newer text');
  await command({command:'set',text:'My favourite colour is blue.'});await wait(400);
  const correct=await engine.request('text-capture',{clientPid:process.pid});const checked=await controller.execute('text.proofread',{target:correct.target},{origin:'chat'});check('correct wording and British spelling stay unchanged',checked.ok&&!checked.result.changed&&(await command({command:'get'})).text==='My favourite colour is blue.',checked);
  await command({command:'set',text:'Helo world',readonly:true});await wait(400);
  check('read-only field is refused',!(await engine.request('text-capture',{clientPid:process.pid})).target);
  await command({command:'close'});fixture=null;
  const before=await appPin('firefox',false,{readOnly:true});
  try{const pinned=await controller.execute('window.pin',{app:'firefox',pinned:true},{origin:'chat'});check('real Firefox window pins above other apps',pinned.ok&&pinned.result.pinned,pinned);check('Windows reports topmost flag',(await appPin('firefox',false,{readOnly:true})).pinned);const unpinned=await controller.execute('window.pin',{app:'firefox',pinned:false},{origin:'chat'});check('real Firefox window unpins',unpinned.ok&&!unpinned.result.pinned,unpinned);}finally{await appPin('firefox',before.pinned);}
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{if(fixture)fixture.kill();fs.writeFileSync(path.resolve(__dirname,'../reports/proofread-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
