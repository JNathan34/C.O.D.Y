'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code);let state;
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name+' '+JSON.stringify(detail||{}));};
 const until=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Control check timed out');};
 const refresh=async()=>state=await engine.request('control-fixtures-state');
 const act=async(family,name,args={})=>{await engine.request('control-fixtures-focus',{family});await wait(200);await refresh();const box=state[family][name];const result=await engine.request('independent-input-probe',{handle:state[family].handle,x:box.x,y:box.y,...args});await wait(180);await refresh();check(family+' '+name+' keeps the physical pointer independent',result.before.x===result.after.x&&result.before.y===result.after.y,result);return result;};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.showCompact();state=await engine.request('control-fixtures-create');await until(async()=>{await refresh();return state.modern.button.width>0&&state.native.button.width>0;});await wait(700);await refresh();
  let result=await act('native','button');check('native Windows button invokes its actual action',state.native.clicks===1&&result.method?.startsWith('accessibility/'),result);
  result=await act('native','edit',{gesture:'select-type',text:'Repaired native text'});check('native Ctrl+A and typing replace the target text',state.native.text==='Repaired native text'&&result.selected==='Done',result);
  result=await act('native','check');check('native checkbox toggles',state.native.checkedValue===true,result);
  result=await act('native','item',{gesture:'double'});check('native list item opens on double click',state.native.opens>0,result);
  result=await act('modern','button');check('WinUI button invokes its actual action',state.modern.clicks===1&&result.method?.startsWith('accessibility/'),result);
  result=await act('modern','edit',{gesture:'select-type',text:'Repaired WinUI text'});check('WinUI Ctrl+A and typing replace the target text',state.modern.text==='Repaired WinUI text'&&result.selected==='Done',result);
  result=await act('modern','check');check('WinUI checkbox toggles',state.modern.checkedValue===true,result);
  result=await act('modern','item',{gesture:'double'});check('WinUI item opens through accessibility',state.modern.opens>0,result);
  result=await act('modern','button',{gesture:'key-only',key:'ctrl+l',text:'https://fixture.invalid/repaired'});check('Ctrl+L focuses and replaces the address field',state.modern.addressText==='https://fixture.invalid/repaired'&&result.key==='Done',result);
  result=await act('native','minimize');check('native title-bar minimize works',state.native.minimized===true,result);await engine.request('control-fixtures-restore');await refresh();
  check('stopped control refuses queued input',result.stoppedInputRefused===true);
  check('unsupported global chords are refused rather than sent to user apps',result.globalChordRefused===true);
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{await engine.request('control-fixtures-close').catch(()=>{});island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/control-polish-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
