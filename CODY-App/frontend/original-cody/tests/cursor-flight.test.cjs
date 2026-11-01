'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{CursorFlight}=require('../src/cursor-flight');
test('launch waits for the renderer then grows out of the notch along a curved path',()=>{
 const f=new CursorFlight({kind:'launch',from:{x:500,y:16},to:{x:800,y:400}});assert.deepEqual(f.sample(900).point,{x:500,y:16});assert.equal(f.sample(900).opacity,0);
 f.begin(1000);f.begin(1100);const mid=f.sample(1350);assert.ok(mid.scale>.18&&mid.scale<1);assert.ok(Math.abs(mid.point.x-650)>10);assert.equal(mid.done,false);assert.deepEqual(f.sample(1700),{point:{x:800,y:400},scale:1,opacity:1,done:true});
});
test('return shrinks and fades into the notch and completes on time',()=>{
 const f=new CursorFlight({kind:'return',from:{x:800,y:400},to:{x:500,y:16}});f.begin(1000);const start=f.sample(1000),mid=f.sample(1300),end=f.sample(1550);assert.equal(start.scale,1);assert.ok(mid.scale<start.scale);assert.deepEqual(end.point,{x:500,y:16});assert.equal(end.opacity,0);assert.equal(end.done,true);
});
test('launch can follow a moving destination without invalid coordinates',()=>{
 const f=new CursorFlight({kind:'launch',from:{x:500,y:16},to:{x:500,y:16}});f.begin(0);assert.ok(Object.values(f.sample(100).point).every(Number.isFinite));assert.deepEqual(f.sample(700,{x:-200,y:100}).point,{x:-200,y:100});
});
test('reversing a flight preserves its current position, size and opacity',()=>{
 const launch=new CursorFlight({kind:'launch',from:{x:500,y:16},to:{x:800,y:400}});launch.begin(0);const pose=launch.sample(100);
 const back=new CursorFlight({kind:'return',from:pose.point,to:{x:500,y:16},startScale:pose.scale,startOpacity:pose.opacity});back.begin(100);const reversed=back.sample(100);assert.deepEqual(reversed.point,pose.point);assert.equal(reversed.scale,pose.scale);assert.equal(reversed.opacity,pose.opacity);
});
