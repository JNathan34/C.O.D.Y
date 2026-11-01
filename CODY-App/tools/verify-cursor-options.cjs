'use strict';
const fs=require('node:fs'),path=require('node:path'),{app}=require('electron');
module.exports=async({win,island,overlay,engine,screen})=>{
 const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code),emit=engine.emit,original=island.preferences(),check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async predicate=>{const end=Date.now()+30000;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Cursor options verification timed out');};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="cursor"]').click()`);await wait(600);
  check('Cursor offers eight coloured previews and Match appearance',await evaluate(`document.querySelectorAll('[data-content="cursor"] [data-cursor-color]').length===9&&document.querySelectorAll('.cursor-option-preview').length===9`));
  check('behaviour controls have their own sidebar section',await evaluate(`Boolean(document.querySelector('[data-tab="behaviour"]'))&&['cursorTracking','reactiveExpressions','funReactions','idleReactions'].every(name=>document.querySelector('[data-content="behaviour"] [data-pref="'+name+'"]'))&&!document.querySelector('[data-content="cursor"] [data-pref]')`));
  await evaluate(`document.querySelector('[data-cursor-color="#4ADE80"]').click()`);await until(()=>island.preferences().cursorColor==='#4ADE80');
  check('cursor colour is persisted without changing the interface accent',JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'island-settings.json'),'utf8')).cursorColor==='#4ADE80'&&island.preferences().accentColor===original.accentColor);
  check('the chosen card exposes its selected state',await evaluate(`document.querySelector('[data-cursor-color="#4ADE80"]').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('[data-cursor-color][aria-pressed="true"]').length===1`));
  const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/cursor-options.png'),(await win.webContents.capturePage(clip)).toPNG());
  await evaluate(`document.querySelector('[data-tab="behaviour"]').click()`);check('Behaviour opens with the existing controls',await evaluate(`!document.querySelector('[data-content="behaviour"]').hidden&&document.querySelector('[data-content="cursor"]').hidden`));
  const drive=await engine.request('drive-state');
  if(!drive.active){
   engine.emit=function(event,value,...args){if(event==='cursor-state'&&!value.testFixture)return false;return emit.call(this,event,value,...args);};
   const display=screen.getPrimaryDisplay(),p=screen.dipToScreenPoint({x:display.bounds.x+display.bounds.width/2,y:display.bounds.y+display.bounds.height/2});engine.emit('cursor-state',{testFixture:true,visible:true,phase:'Listening',level:.5,x:p.x,y:p.y});await until(()=>overlay.windows.get(display.id)?.controlReady);await wait(400);
   const layer=overlay.windows.get(display.id),pixel=()=>layer.webContents.executeJavaScript(`(()=>{const c=document.getElementById('ai-cursor'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<data.length;i+=4)if(data[i+3]>220)return Array.from(data.slice(i,i+3));return null;})()`);
   const green=await pixel();check('the real listening cursor uses the selected green colour',green&&[74,222,128].every((v,i)=>Math.abs(v-green[i])<3),green);
   await evaluate(`document.querySelector('[data-cursor-color="#F377BC"]').click()`);await until(()=>island.preferences().cursorColor==='#F377BC');await wait(350);const pink=await pixel();check('changing colour updates the live animation immediately',pink&&[243,119,188].every((v,i)=>Math.abs(v-pink[i])<3),pink);
   await evaluate(`document.querySelector('[data-cursor-color="accent"]').click()`);await until(()=>island.preferences().cursorColor==='accent');await wait(350);const theme=await pixel(),expected=[1,3,5].map(i=>parseInt(original.accentColor.slice(i,i+2),16));check('Match appearance follows the existing theme colour',theme&&expected.every((v,i)=>Math.abs(v-theme[i])<3),theme);
  }
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{engine.emit=emit;await evaluate(`window.cody.updateSettings({cursorColor:${JSON.stringify(original.cursorColor||'accent')}})`).catch(()=>{});overlay.onCursor({visible:false});overlay.update(await engine.request('drive-state').catch(()=>({active:false})));island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/cursor-options-live.json'),JSON.stringify({passed:results.every(result=>result.passed),results},null,2));}
};
