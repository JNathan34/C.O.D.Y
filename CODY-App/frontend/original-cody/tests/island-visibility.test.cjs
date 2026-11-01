'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/island/renderer/ui.js'),'utf8');
const reveal=source.slice(source.indexOf('  function showIsland(show){'),source.indexOf('  function stopMicrophone('));
function fixture(initial='hidden'){
 const timers=new Map();let next=0,concealed=0;
 const context=vm.createContext({body:{dataset:{reveal:initial}},revealTimer:null,settings:{revealStyle:'liquid'},normalMotion:()=>true,motionFactor:()=>1,api:{concealComplete:()=>concealed++},setTimeout:callback=>{timers.set(++next,callback);return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(reveal,context);
 return {show:context.showIsland,state:()=>context.body.dataset.reveal,concealed:()=>concealed,finish:()=>{const pending=[...timers.values()];timers.clear();pending.forEach(callback=>callback());}};
}
test('repeated visibility notifications do not strand the reveal animation',()=>{
 const f=fixture();f.show(true);f.show(true);f.show(true);f.finish();assert.equal(f.state(),'visible');assert.equal(f.concealed(),0);
});
test('repeated conceal notifications finish hiding exactly once',()=>{
 const f=fixture('visible');f.show(false);f.show(false);f.finish();assert.equal(f.state(),'hidden');assert.equal(f.concealed(),1);
});
test('reversing a conceal cancels its stale completion',()=>{
 const f=fixture('visible');f.show(false);f.show(true);f.show(true);f.finish();assert.equal(f.state(),'visible');assert.equal(f.concealed(),0);
});
test('reversing a reveal still completes the requested conceal',()=>{
 const f=fixture();f.show(true);f.show(false);f.show(false);f.finish();assert.equal(f.state(),'hidden');assert.equal(f.concealed(),1);
});
