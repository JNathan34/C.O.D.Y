'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AssistantModes}=require('../src/assistant-modes'),{IslandUtilities}=require('../src/island-utilities');
function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-modes-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const prefs={visibility:'always',idleReactions:'playful',funReactions:true,reactiveExpressions:true,wifiReactions:true,animationSpeed:'normal',islandSize:'medium',speechSubtitles:true};
 const settings={voiceAutoSpeak:true,computerControl:{enabled:true}};
 const island={preferences:()=>({...prefs}),updatePreferences:patch=>Object.assign(prefs,patch)};
 const store={data:{settings},settings:patch=>Object.assign(settings,patch)};
 return {folder,prefs,settings,island,store,service:new AssistantModes({file:path.join(folder,'modes.json'),island,store})};
}
test('focus mode quiets the island without expanding computer permissions',t=>{
 const f=fixture(t);const before=f.settings.computerControl;
 const result=f.service.activate('focus');
 assert.match(result.message,/Focus mode/);assert.equal(f.prefs.visibility,'activity');
 assert.equal(f.prefs.funReactions,false);assert.equal(f.settings.voiceAutoSpeak,false);
 assert.strictEqual(f.settings.computerControl,before);
});
test('custom modes save locally, survive restart and can be removed',t=>{
 const f=fixture(t);f.service.save('My Desktop');
 const service=new AssistantModes({file:path.join(f.folder,'modes.json'),island:f.island,store:f.store});
 assert.equal(service.list().items.find(x=>x.name==='My Desktop').custom,true);
 service.activate('custom:my-desktop');assert.equal(service.list().active,'custom:my-desktop');
 service.remove('custom:my-desktop');assert.equal(service.list().active,'normal');
 assert.throws(()=>service.activate('custom:my-desktop'),/Unknown/);
});
test('mode chat commands dispatch locally and do not require a computer controller',async t=>{
 const f=fixture(t),cards=[];const utilities=new IslandUtilities({modes:f.service,showCard:x=>cards.push(x)});
 assert.equal(utilities.match('switch to gaming mode').id,'gaming');
 const done=await utilities.run('switch to gaming mode');
 assert.equal(done.handled,true);assert.equal(f.prefs.visibility,'hover');
 assert.equal(cards[0].kind,'utility');
});
