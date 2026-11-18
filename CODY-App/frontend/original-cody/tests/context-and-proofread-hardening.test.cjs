'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {isProofreadCommand}=require('../src/proofread-command');
const {IslandUtilities}=require('../src/island-utilities');
const {ComputerController}=require('../src/control/controller');
test('new focused-field proofread phrases are narrow and do not swallow unsupported rewriting',()=>{
 for(const text of ['proofread this field','spell check the selected text','fix typos in this text','correct the spelling of this field'])
  assert.equal(isProofreadCommand(text),true,text);
 for(const text of ['rewrite this essay','proofread this and send to someone','fix typos across every window'])
  assert.equal(isProofreadCommand(text),false,text);
});
test('proofreading never reports success for unverified native engine response',async()=>{
 const controller=new ComputerController({readPermissions:()=>({enabled:true,level:'full'}),confirm:async()=>true});
 controller.proofread=async()=>({changed:'yes'});
 await assert.rejects(controller.execute('text.proofread',{}, {origin:'chat'}),/verified/);
});
test('text field suggestions only run on explicit request, do not disclose text or edit it',async()=>{
 let calls=0;const cards=[];const util=new IslandUtilities({textContext:async()=>{calls++;return {editable:true,text:'SENSITIVE CONTENT'};},showCard:card=>cards.push(card)});
 assert.equal(util.match('what can you do with this textbox').action,'text-context-help');
 assert.equal(util.match('my password is abc'),null);
 assert.equal(calls,0);
 const response=await util.run('what can you do with this textbox');
 assert.equal(calls,1);assert.match(response.reply,/editable field/);
 assert.equal(response.reply.includes('SENSITIVE CONTENT'),false);
 assert.equal(cards[0].text,'Text tools');
});
test('protected fields do not get suggestions or auto-fill',async()=>{
 const util=new IslandUtilities({textContext:async()=>({editable:true,protected:true}),showCard(){}});
 const response=await util.run('suggest edits for this field');
 assert.match(response.reply,/protected/);assert.doesNotMatch(response.reply,/proofread its spelling/);
});
