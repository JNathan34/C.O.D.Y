'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseImport,safeExportTime}=require('../src/memory/import');
test('ChatGPT history with invalid timestamps is imported without crashing or inventing a date',()=>{
 const message={id:'m1',author:{role:'user'},content:{parts:['My useful note.']},create_time:1e100};
 const exportData=[{id:'chat-1',title:'Test',current_node:'node',mapping:{node:{id:'node',message,parent:null}}}];
 const result=parseImport(JSON.stringify(exportData),'conversations.json');
 assert.equal(result.length,1);assert.equal(result[0].sourceTime,null);assert.equal(result[0].text,'My useful note.');
 assert.equal(safeExportTime(Infinity),null);assert.equal(safeExportTime('unknown'),null);
});
test('broken imported-memory records are rejected before any storage',()=>{
 for(const records of [[null],[{title:'missing text'}],[{text:42}]]){
  assert.throws(()=>parseImport(JSON.stringify({format:'cody-memory-v1',records}),'memories.json'),/invalid record/);
 }
});
test('imported records never inherit sharing permissions from exported metadata',()=>{
 const result=parseImport(JSON.stringify({format:'cody-memory-v1',records:[{text:'Test',title:'Project',permissions:{codex:true},sourceTime:'not a date'}]}),'memories.json');
 assert.equal(result[0].sourceTime,null);
 assert.equal(Object.hasOwn(result[0],'permissions'),false);
});