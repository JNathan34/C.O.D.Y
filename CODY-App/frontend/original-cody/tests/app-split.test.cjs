'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseAppCommand}=require('../src/app-commands');
const {splitApps,validateSplitApps}=require('../src/control/app-layout');
const {ComputerController}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
test('short app names and the reported Spotify dictation use concise local opening acknowledgements',async()=>{
  const actions=[],utilities=new IslandUtilities({controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true};}},showCard(){}});
  for(const text of ['Spotify.','Open spot of','Open Spotify','could you open Spotify please']){
    const result=await utilities.run(text);assert.equal(result.reply,'Opening Spotify.');assert.equal(result.confirmation,'Opening Spotify.');assert.deepEqual(actions.at(-1),{action:'app.open',args:{app:'spotify'}});
  }
  assert.equal((await utilities.run('open Firefox')).confirmation,'Opening Firefox.');
});
test('natural split-screen requests retain app order and map Plex to Plezy',()=>{
  for(const text of ['open Firefox and Plezy in split screen','Could you open Firefox and Plex side by side please?','launch Mozilla Firefox with the Plezy app in a split-screen','split screen with Firefox and Plezy','put Firefox and Plezy next to each other'])assert.deepEqual(parseAppCommand(text),{action:'app.split',args:{apps:['firefox','plezy']}},text);
  assert.deepEqual(parseAppCommand('open Plezy and Firefox in split screen').args.apps,['plezy','firefox']);
  for(const text of ['open Firefox and Plezy in split screen and send an email','open Firefox and delete files in split screen','open Firefox and Firefox in split screen','open Firefox and Plezy and Chrome in split screen','explain split screen','play Iron Man on Plezy'])assert.equal(parseAppCommand(text),null,text);
});
test('unsupported and repeated apps cannot reach the Windows layout runner',async()=>{
  let ran=false;for(const apps of [['firefox','unknown'],['plex','plezy'],['firefox'],['firefox','plezy','chrome'],['firefox',"plezy';Remove-Item"]])await assert.rejects(splitApps(apps,{runner:()=>{ran=true;}}));assert.equal(ran,false);
  assert.deepEqual(validateSplitApps(['Mozilla Firefox','Plex']),['firefox','plezy']);
});
test('split runner requires confirmed ordered windows before reporting success',async()=>{
  const result={arranged:true,windows:[{app:'firefox'},{app:'plezy'}]};
  assert.deepEqual(await splitApps(['firefox','plezy'],{runner:async()=>JSON.stringify(result)}),result);
  for(const invalid of [{arranged:false,windows:result.windows},{arranged:true,windows:[]},{arranged:true,windows:[{app:'plezy'},{app:'firefox'}]}])await assert.rejects(splitApps(['firefox','plezy'],{runner:async()=>JSON.stringify(invalid)}),/confirm/);
});
test('both app and window permissions apply, and a denied split cannot launch apps',async()=>{
  let ran=false;const runner=async()=>{ran=true;return '{}';};
  const disabled=new ComputerController({readPermissions:()=>({enabled:true,level:'approve-safe',applications:true,windows:false}),runner});
  await assert.rejects(disabled.execute('app.split',{apps:['firefox','plezy']},{origin:'chat'}),/windows/);assert.equal(ran,false);
  const denied=new ComputerController({readPermissions:()=>({enabled:true,level:'ask',applications:true,windows:true}),confirm:async()=>false,runner});
  assert.equal((await denied.execute('app.split',{apps:['firefox','plezy']},{origin:'chat'})).cancelled,true);assert.equal(ran,false);
});
test('split request collapses the chat and shows the Island card only after success',async()=>{
  const cards=[],actions=[];let collapsed=false;
  const utilities=new IslandUtilities({controller:{execute:async(action,args)=>{actions.push({action,args});return {ok:true};}},showCompact:()=>collapsed=true,showCard:card=>cards.push(card)});
  const result=await utilities.run('open Firefox and Plex in split screen');assert.equal(result.handled,true);assert.equal(collapsed,true);assert.deepEqual(actions,[{action:'app.split',args:{apps:['firefox','plezy']}}]);assert.equal(cards[0].text,'Split screen');assert.match(result.reply,/Firefox on the left.*Plezy on the right/);
  collapsed=false;cards.length=0;utilities.controller.execute=async()=>({ok:false,error:'Plezy did not open'});const failed=await utilities.run('open Firefox and Plezy in split screen');assert.equal(failed.error,true);assert.equal(collapsed,false);assert.equal(cards[0].text,'Unavailable');
});
