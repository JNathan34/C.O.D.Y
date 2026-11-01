'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isProofreadCommand}=require('../src/proofread-command');
const {IslandUtilities}=require('../src/island-utilities');
const {ComputerController}=require('../src/control/controller');
test('minimal proofreading phrases route locally without swallowing larger requests',()=>{
  for(const text of ['Proof read this.','proofread this','spell check this','spellcheck this','check my spelling','fix the spelling','could you proofread my text please','correct my spelling'])assert.equal(isProofreadCommand(text),true,text);
  for(const text of ['proofread this and send it','what does spell check mean','proofread this: hello','rewrite this to sound professional'])assert.equal(isProofreadCommand(text),false,text);
});
test('proofreading uses the voice-captured target and reports only a short acknowledgement',async()=>{
  const calls=[],cards=[],target='1988199e-7d3f-407a-b34c-14b27fe81234';
  const utilities=new IslandUtilities({controller:{execute:async(...args)=>{calls.push(args);return {ok:true,result:{changed:true,app:'firefox'}};}},showCard:card=>cards.push(card),showCompact(){}});
  const result=await utilities.run('spell check this','one',{proofreadTarget:target});assert.equal(result.reply,'Spelling fixed.');assert.deepEqual(calls[0],['text.proofread',{target},{origin:'chat'}]);assert.equal(cards.at(-1).text,'Spelling fixed');
});
test('proofreading respects input and accessibility permissions, and approval denial',async()=>{
  let ran=false;
  for(const permission of ['keyboardMouse','uiAutomation']){const controller=new ComputerController({readPermissions:()=>({enabled:true,level:'approve-safe',keyboardMouse:true,uiAutomation:true,[permission]:false})});controller.proofread=()=>ran=true;await assert.rejects(controller.execute('text.proofread',{}, {origin:'chat'}),new RegExp(permission));}
  const controller=new ComputerController({readPermissions:()=>({enabled:true,level:'ask',keyboardMouse:true,uiAutomation:true}),confirm:async()=>false});controller.proofread=()=>ran=true;assert.equal((await controller.execute('text.proofread',{}, {origin:'chat'})).cancelled,true);assert.equal(ran,false);
});
