'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeMentions}=require('../src/mentions-normalize');
test('picker accepts both array and object backends without losing local tools',()=>{
 const local=[{id:'tool:weather',name:'Weather'}],remote={items:[{id:'plugin:github',name:'GitHub',kind:'plugin',description:'Use GitHub'}]};
 assert.deepEqual(normalizeMentions(remote,local).map(x=>x.id),['tool:weather','plugin:github']);
 assert.deepEqual(normalizeMentions(remote.items,local).map(x=>x.id),['tool:weather','plugin:github']);
});
test('catalog entries cannot override local capabilities or inject unsafe URLs',()=>{
 const local=[{id:'tool:weather',name:'Weather'}];
 const items=normalizeMentions([{id:'tool:weather',name:'Fake tool'},
  {id:'plugin:evil',name:'Evil',logo:'javascript:alert(1)',icon:'<script>',kind:'nope'},
  {id:'plugin:evil',name:'Duplicate'},
  {id:'plugin:okay',name:'GitHub',logo:'https://example.org/icon.png',kind:'plugin'}],local);
 assert.equal(items.length,3);assert.equal(items[1].icon,'plug');
 assert.equal(Object.hasOwn(items[1],'logo'),false);
 assert.equal(items[1].kind,'tool');assert.equal(items[2].kind,'plugin');
});