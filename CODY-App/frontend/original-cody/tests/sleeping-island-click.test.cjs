'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {shouldRecoverPointer}=require('../src/island/pointer-open');
const pointer={visible:true,expanded:false,hit:true,sleeping:true,wakeUntil:0,now:100,button:'left'};
test('the first left press opens a sleeping island, including just after hover wakes it',()=>{
 assert.equal(shouldRecoverPointer(pointer),true);assert.equal(shouldRecoverPointer({...pointer,sleeping:false,wakeUntil:1500}),true);
});
test('recovery ignores hidden islands, transparent shoulders, right clicks and expanded panels',()=>{
 for(const patch of [{visible:false},{hit:false},{expanded:true},{button:'right'},{button:'middle'},{sleeping:false,wakeUntil:99}])assert.equal(shouldRecoverPointer({...pointer,...patch}),false);
});
