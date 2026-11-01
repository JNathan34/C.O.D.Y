'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,island,engine})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),evaluate=code=>win.webContents.executeJavaScript(code),request=engine.request;let mutations=0;
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 const until=async fn=>{const end=Date.now()+60000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Plugins verification timed out');};
 engine.request=function(command,...args){if(command==='plugins-action'||command==='plugins-add')mutations++;return request.call(this,command,...args);};
 try{
  await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));
  check('Memory is removed and the integrations sidebar item is now Plugins',await evaluate(`!document.querySelector('[data-tab="memory"],[data-content="memory"]')&&document.querySelector('[data-tab="integrations"]').textContent.trim()==='Plugins'`));
  island.show();await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="integrations"]').click()`);await until(()=>evaluate(`window.CODYPlugins?.snapshot().total>0&&!window.CODYPlugins.snapshot().loading`));
  const ui=await evaluate('window.CODYPlugins.snapshot()'),native=await engine.request('plugins-list');
  check('all native cloud, local and custom plugins appear in the catalog',ui.total===native.plugins.length+native.custom.length+2,{rendered:ui.total,cloud:native.plugins.filter(p=>p.kind==='cloud').length,custom:native.custom.length,signedIn:native.signedIn,available:native.available,message:native.message});
  check('plugin cards expose real connection or removal controls',await evaluate(`document.querySelectorAll('.plugin-card').length===window.CODYPlugins.snapshot().total&&[...document.querySelectorAll('.plugin-card')].every(card=>card.querySelector('button'))`));
  const sample=native.plugins.find(p=>p.kind==='cloud')||native.plugins[0];await evaluate(`document.getElementById('plugins-search').value=${JSON.stringify(sample.name)};document.getElementById('plugins-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  check('search filters the live catalog',await evaluate(`[...document.querySelectorAll('.plugin-card')].some(card=>card.dataset.pluginId===${JSON.stringify(sample.id)})`));
  await evaluate(`document.getElementById('plugins-search').value='';document.getElementById('plugins-search').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-plugin-filter="connected"]').click()`);check('Connected filter contains only connected plugins',await evaluate(`document.querySelectorAll('.plugin-card').length===window.CODYPlugins.snapshot().connected`));
  await evaluate(`document.querySelector('[data-plugin-filter="all"]').click()`);check('browser extension setup and custom MCP installation are available',await evaluate(`Boolean(document.querySelector('[data-plugin-id=browser-chrome]')&&document.querySelector('[data-plugin-id=browser-edge]')&&!document.querySelector('[data-plugin-id=browser-extension]')&&document.getElementById('plugins-add-form'))`));
  for(const browser of ['Chrome','Edge']){
   await evaluate(`document.querySelector('[data-plugin-id="browser-${browser.toLowerCase()}"] button').click()`);
   await until(()=>evaluate(`!document.getElementById('browser-setup').hidden&&document.getElementById('browser-setup-title').textContent.includes('${browser}')`));
   check(browser+' card opens its own setup dialog',await evaluate(`document.getElementById('browser-setup-guide').textContent==='Open ${browser}'`));
   await evaluate(`document.getElementById('browser-setup-close').click()`);
  }
  await evaluate(`document.dispatchEvent(new CustomEvent('cody:browser-setup',{detail:{connected:true,connectedBrowsers:['Chrome']}}))`);
  check('Chrome connection does not mark Edge connected',await evaluate(`document.querySelector('[data-plugin-id="browser-chrome"] .plugin-connected')!==null&&!document.querySelector('[data-plugin-id="browser-edge"] .plugin-connected')`));
  await evaluate(`document.getElementById('plugins-refresh').click()`);await until(()=>evaluate(`!window.CODYPlugins.snapshot().loading`));
  await require('node:assert/strict').rejects(engine.request('plugins-action',{pluginId:'__cody_unknown_plugin__',action:'connect',accountId:''}));mutations--;
  check('browsing and filtering never installs or disconnects real accounts',mutations===0);
  await evaluate(`window.CODYIsland.setActiveView('settings');document.querySelector('[data-tab="integrations"]').click();document.getElementById('plugins-search').focus()`);
  await wait(500);const clip=await evaluate(`(()=>{const r=document.getElementById('island').getBoundingClientRect();return{x:Math.floor(r.x),y:0,width:Math.ceil(r.width),height:Math.ceil(r.height+8)};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/plugins-page.png'),(await win.webContents.capturePage(clip)).toPNG());
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{engine.request=request;island.showCompact();fs.writeFileSync(path.resolve(__dirname,'../reports/plugins-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
