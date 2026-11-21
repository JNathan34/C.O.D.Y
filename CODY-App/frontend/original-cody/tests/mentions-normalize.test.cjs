'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeMentions}=require('../src/mentions-normalize');
test('picker accepts both array and object backends and retains Computer Use alongside plugins and skills',()=>{
 const local=[{id:'tool:weather',name:'Weather',kind:'tool'},{id:'plugin:word',name:'Word (Desktop)',kind:'plugin'}];
 const remote={items:[{id:'plugin:github',name:'GitHub',kind:'plugin'},
  {id:'tool:timer',name:'Timer',kind:'tool'},{id:'tool:computer-use',name:'Computer Use',kind:'tool'},
  {id:'skill:browser',name:'Browser Control',kind:'skill'}]};
 const ids=['plugin:word','plugin:github','tool:computer-use','skill:browser'];
 assert.deepEqual(normalizeMentions(remote,local).map(x=>x.id),ids);
 assert.deepEqual(normalizeMentions(remote.items,local).map(x=>x.id),ids);
 const computerUse=normalizeMentions(remote,local).find(item=>item.id==='tool:computer-use');
 assert.equal(computerUse.kind,'plugin');
 assert.equal(computerUse.icon,'mouse-pointer-2');
});
test('catalog entries cannot override local capabilities or inject unsafe URLs',()=>{
 const local=[{id:'plugin:word',name:'Word (Desktop)',kind:'plugin'}];
 const items=normalizeMentions([{id:'plugin:word',name:'Fake Word',kind:'plugin'},
  {id:'plugin:other',name:'Other',kind:'nope'},
  {id:'plugin:evil',name:'Evil',logo:'javascript:alert(1)',icon:'<script>',kind:'plugin'},
  {id:'plugin:evil',name:'Duplicate'},
  {id:'plugin:okay',name:'GitHub',logo:'https://example.org/icon.png',kind:'plugin'}],local);
 assert.equal(items.length,3);assert.equal(items[0].name,'Word (Desktop)');assert.equal(items[1].icon,'plug');
 assert.equal(Object.hasOwn(items[1],'logo'),false);
 assert.equal(items[2].logo,'https://example.org/icon.png');
});
