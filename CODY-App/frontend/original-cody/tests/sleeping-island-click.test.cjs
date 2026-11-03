'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {shouldRecoverPointer}=require('../src/island/pointer-open');
const pointer={visible:true,expanded:false,hit:true,sleeping:true,wakeUntil:0,now:100,button:'left'};
test('the first left press opens awake and sleeping islands without prior hover',()=>{
 assert.equal(shouldRecoverPointer(pointer),true);assert.equal(shouldRecoverPointer({...pointer,sleeping:false,wakeUntil:1500}),true);
 assert.equal(shouldRecoverPointer({...pointer,sleeping:false,wakeUntil:0}),true);
});
test('recovery ignores hidden islands, transparent shoulders, right clicks and expanded panels',()=>{
 for(const patch of [{visible:false},{hit:false},{expanded:true},{button:'right'},{button:'middle'}])assert.equal(shouldRecoverPointer({...pointer,...patch}),false);
});
