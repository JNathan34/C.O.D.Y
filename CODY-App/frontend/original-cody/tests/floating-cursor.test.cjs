'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FloatingCursor}=require('../src/floating-cursor');
function shake(cursor,start=1000){for(let i=0;i<8;i++)cursor.update({x:i%2?320:140,y:50},{},start+i*50);}
test('floating cursor follows by default with a small offset and hides immediately',()=>{
 const c=new FloatingCursor();assert.deepEqual(c.update({x:-200,y:50},{},0),{x:-186,y:66});const next=c.update({x:10,y:70},{},16);assert.ok(next.x>-186&&next.x<24);assert.equal(c.update({x:20,y:70},{hideFloatingCursor:true}),null);assert.equal(c.point,null);assert.deepEqual(c.update({x:30,y:70}),{x:44,y:86});
});
test('deliberate shake parks the cursor; ordinary movement cannot move it; another shake reattaches',()=>{
 const c=new FloatingCursor();shake(c);assert.equal(c.detached,true);const parked={...c.point};c.update({x:900,y:400},{},1500);assert.deepEqual(c.point,parked);shake(c,4000);assert.equal(c.detached,false);const before={...c.point};c.update({x:40,y:80},{},4500);assert.ok(Math.abs(c.point.x-54)<Math.abs(before.x-54));
});
test('slow reversals and straight mouse movement do not detach',()=>{
 const c=new FloatingCursor();for(let i=0;i<12;i++)c.update({x:i%2?200:140,y:50},{},i*800);assert.equal(c.detached,false);for(let i=0;i<12;i++)c.update({x:i*50,y:50},{},12000+i*30);assert.equal(c.detached,false);
});
test('small fast shakes and wide slow shakes do not detach',()=>{
 const small=new FloatingCursor();for(let i=0;i<16;i++)small.update({x:i%2?200:140,y:50},{},1000+i*50);assert.equal(small.detached,false);
 const slow=new FloatingCursor();for(let i=0;i<16;i++)slow.update({x:i%2?320:140,y:50},{},1000+i*150);assert.equal(slow.detached,false);
});
test('disabled shake never detaches and releases an already parked cursor',()=>{
 const c=new FloatingCursor();shake(c);assert.equal(c.detached,true);const before={...c.point};c.update({x:100,y:80},{shakeToDetach:false},2000);assert.notDeepEqual(c.point,before);assert.equal(c.detached,false);for(let i=0;i<12;i++)c.update({x:i%2?200:140,y:50},{shakeToDetach:false},3000+i*30);assert.equal(c.detached,false);
});
test('following glides without overshoot, settles, and is independent of polling frequency',()=>{
 function follow(step){const c=new FloatingCursor();c.update({x:0,y:0},{},0);let previous=c.point.x;for(let t=step;t<=480;t+=step){c.update({x:200,y:100},{},t);assert.ok(c.point.x>=previous&&c.point.x<214);previous=c.point.x;}return c;}
 const fast=follow(16),slow=follow(32);assert.ok(Math.abs(fast.point.x-slow.point.x)<.001);assert.ok(fast.point.x>190&&fast.point.x<210);
 for(let t=496;t<=3000;t+=16)fast.update({x:200,y:100},{},t);assert.deepEqual(fast.point,{x:214,y:116});
});
test('a fast long flick gives a brief, modest boost that fades and cannot repeatedly retrigger',()=>{
 const c=new FloatingCursor();c.update({x:0,y:0},{},0);c.update({x:900,y:0},{},16);assert.equal(c.boostUntil,496);const end=c.boostUntil;
 for(let t=32;t<=176;t+=16)c.update({x:900,y:0},{},t);assert.equal(c.boost,1);assert.ok(c.point.x>914-900*Math.exp(-176/200));assert.ok(c.point.x<914);
 c.update({x:1800,y:0},{},192);assert.equal(c.boostUntil,end);for(let t=208;t<=512;t+=16)c.update({x:1800,y:0},{},t);assert.equal(c.boost,0);
});
test('slow sweeps, small flicks and detached cursors do not get a boost',()=>{
 const slow=new FloatingCursor();slow.update({x:0,y:0},{},0);for(let t=16;t<=1000;t+=16)slow.update({x:t,y:0},{},t);assert.equal(slow.boostUntil,0);
 const small=new FloatingCursor();small.update({x:0,y:0},{},0);small.update({x:150,y:0},{},16);assert.equal(small.boostUntil,0);
 small.detached=true;small.update({x:1000,y:0},{},32);assert.equal(small.boost,0);assert.equal(small.boostUntil,0);
});
test('shake detection works with small per-frame steps on a 240 Hz monitor',()=>{
 const c=new FloatingCursor();for(let t=0;t<=400;t+=4){const leg=Math.floor(t/50),progress=(t%50)/50;c.update({x:leg%2?180*(1-progress):180*progress,y:50},{},1000+t);}assert.equal(c.detached,true);
});
