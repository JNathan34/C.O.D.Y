'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {screenMarkState}=require('../../../tools/drawing-mark-state.cjs');
test('native marks retain their ID across missing render frames and disappear only when the model removes them',()=>{
 const node={},mark={id:9,role:'ring',bounds:[10,20,90,100],nodes:[node]};
 let marks=[mark],unit;
 const session={codyScreenMarks:()=>marks};
 assert.deepEqual(screenMarkState(session,()=>unit),[{id:9,role:'ring',bounds:mark.bounds,units:[]}]);
 mark.nodes=undefined;
 assert.deepEqual(screenMarkState(session,()=>unit),[{id:9,role:'ring',bounds:mark.bounds,units:[]}]);
 mark.nodes=[node];
 unit={__sent:true,__n:7,parentNode:{tagName:'svg'}};
 assert.deepEqual(screenMarkState(session,()=>unit)[0].units,[7]);
 unit=undefined;assert.equal(screenMarkState(session,()=>unit)[0].id,9);
 marks=[];assert.deepEqual(screenMarkState(session,()=>unit),[]);
});
test('native tracking collects each visible unit once and excludes definitions and unsent units',()=>{
 const units=[{__sent:true,__n:4,parentNode:{tagName:'svg'}},{__sent:true,__n:4,parentNode:{tagName:'svg'}},{__sent:false,__n:5,parentNode:{tagName:'svg'}},{__sent:true,__n:6,parentNode:{tagName:'defs'}}];
 assert.deepEqual(screenMarkState({codyScreenMarks:()=>[{id:1,role:'ring',bounds:[],nodes:units}]},unit=>unit)[0].units,[4]);
});
