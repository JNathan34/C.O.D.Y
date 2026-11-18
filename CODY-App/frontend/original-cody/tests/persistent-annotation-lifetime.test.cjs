'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AnnotationManager}=require('../src/annotations/manager');
function fixture(){
 let now=10000;const rendered=[];
 const overlay={on(){},render:async shapes=>{rendered.push(shapes.map(x=>x.id));},reset(){},close(){}};
 const screen={getAllDisplays:()=>[{id:1,bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:1}]};
 const manager=new AnnotationManager({overlay,screen,now:()=>now});
 return {manager,rendered,step:n=>now+=n};
}
test('new shapes persist through clicks, speech completion, and turn transitions by default',async()=>{
 const f=fixture();
 const result=await f.manager.execute('draw.circle',{x:500,y:400,radius:90});
 assert.equal(result.accepted,true);assert.equal(f.manager.status().active[0].mode,'persistent');
 f.manager.beginScope('next',{speechExpected:true});f.manager.speech('playing','next');f.manager.speech('finished','next');
 f.step(1000000);await f.manager.tick();
 assert.equal(f.manager.status().active.length,1);
 f.manager.clearImmediate('Ctrl+Alt+X');assert.equal(f.manager.status().active.length,0);
 f.manager.close();
});
test('explicit temporary drawings still expire and do not remove unrelated persistent ink',async()=>{
 const f=fixture();
 await f.manager.execute('draw.circle',{x:500,y:400,radius:40});
 await f.manager.execute('draw.circle',{x:600,y:400,radius:40,mode:'temporary',durationMs:500});
 f.step(800);await f.manager.tick();f.step(350);await f.manager.tick();
 assert.equal(f.manager.status().active.length,1);
 f.manager.close();
});
