'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAppCommand}=require('../src/app-commands');
const {appPin}=require('../src/control/app-layout');
const {ComputerController}=require('../src/control/controller');
test('pin and unpin aliases are local, including Plex to Plezy',()=>{
  for(const text of ['pin Firefox on top','keep Firefox always on top','make Firefox on top'])assert.deepEqual(parseAppCommand(text),{action:'window.pin',args:{app:'firefox',pinned:true}});
  for(const text of ['unpin Firefox','stop keeping Firefox on top','turn off always on top for Firefox'])assert.deepEqual(parseAppCommand(text),{action:'window.pin',args:{app:'firefox',pinned:false}});
  assert.equal(parseAppCommand('pin Plex on top').args.app,'plezy');
  for(const text of ['pin Firefox on top and delete files','pin unknown on top'])assert.equal(parseAppCommand(text),null);
});
test('pin status must confirm the requested state; invalid input never reaches Windows',async()=>{
  const result={app:'firefox',pinned:true,wasOpen:true};assert.deepEqual(await appPin('firefox',true,{runner:async()=>JSON.stringify(result)}),result);
  await assert.rejects(appPin('firefox',true,{runner:async()=>JSON.stringify({...result,pinned:false})}),/confirm/);
  await assert.rejects(appPin('firefox',true,{runner:async()=>JSON.stringify({...result,wasOpen:false})}),/confirm/);
  let ran=false;await assert.rejects(appPin('badapp',true,{runner:async()=>ran=true}));assert.equal(ran,false);
  assert.equal((await appPin('firefox',false,{readOnly:true,runner:async()=>result})).pinned,true);
});
test('pin enforces both window and app permissions',async()=>{
  for(const permission of ['applications','windows']){const controller=new ComputerController({readPermissions:()=>({enabled:true,level:'approve-safe',applications:true,windows:true,[permission]:false})});await assert.rejects(controller.execute('window.pin',{app:'firefox',pinned:true},{origin:'chat'}),new RegExp(permission));}
});
