'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {UpdateIslandStatus}=require('../src/island/renderer/update-island');
const value={supported:true,currentVersion:'0.15.6',availableVersion:'0.15.7'};
test('update island stays quiet for idle and development copies',()=>{
  const model=new UpdateIslandStatus();
  for(const state of [{status:'idle',supported:true},{status:'development',supported:false},{status:'available',supported:false}]){model.set(state);assert.equal(model.card(),null);}
});
test('update island follows checking, availability, progress and restart readiness',()=>{
  const model=new UpdateIslandStatus();
  for(const status of ['checking','available','downloading','ready','installing']){
    model.set({...value,status,progress:42.7});const card=model.card();
    assert.equal(card.status,status);assert.ok(card.text&&card.detail);
    if(status==='downloading'){assert.equal(card.progress,43);assert.match(card.text,/43%/);}
    else assert.equal(card.progress,undefined);
  }
  assert.match(model.card().text,/Installing/);
});
test('download percentage is bounded and unavailable progress is safe',()=>{
  const model=new UpdateIslandStatus();
  for(const [progress,expected] of [[-10,0],[110,100],[undefined,0],['oops',0]]){model.set({...value,status:'downloading',progress});assert.equal(model.card().progress,expected);}
});
test('completion and error notices expire and restore the ordinary island',()=>{
  let now=1000;const model=new UpdateIslandStatus(()=>now);
  model.set({...value,status:'current'});assert.equal(model.card().text,'Up to date');now+=8000;assert.equal(model.card(),null);
  model.set({...value,status:'error',error:'Connection failed'});assert.equal(model.card().tooltip,'Connection failed');
  now+=29000;model.set({...value,status:'error',error:'Still offline'});assert.equal(model.card().tooltip,'Still offline');now+=1000;assert.equal(model.card(),null);
  model.set({...value,status:'checking'});assert.equal(model.card().status,'checking');
});
test('available and ready notices remain until the next update state',()=>{
  let now=0;const model=new UpdateIslandStatus(()=>now);
  for(const status of ['available','ready']){model.set({...value,status});now+=86400000;assert.equal(model.card().status,status);}
  model.set({...value,status:'idle'});assert.equal(model.card(),null);
});
