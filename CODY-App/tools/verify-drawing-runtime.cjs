'use strict';
// Exercise the patched shipping runtime, including the real ring() pieces,
// while its revealed DOM geometry contains only a small arc of the outline.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assets=path.resolve(__dirname,'../run/current/Assets/Engine');
const source=fs.readFileSync(path.join(assets,'clicky-draw-engine.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source,context);
const api=context.ClickyDraw;
const pieces=fs.readFileSync(path.join(assets,'clicky-draw-pieces.js'),'utf8');
const marks=api.runCode(pieces+'\nring(1040,450,270,120);',2880,1800);
assert.equal(marks.error,null);
assert.equal(marks[0].role,'ring');
const intended=Array.from(api.markBox(marks[0]));
const begin=source.indexOf('      codyScreenMarks() {');
const end=source.indexOf('      keepNotesOnly() {',begin);
assert.ok(begin>=0&&end>begin,'the shipping runtime exposes retained screen marks');
let rendered=[1080,530,1290,580];
const nodes=[{}];
Object.assign(context,{
  visibleMarkIndexes:()=>[0],cardTest:()=>null,mark:()=>marks[0],
  markBox:api.markBox,box:()=>rendered,pointsAtScreen:api.pointsAtScreen,
  isCardMark:api.isCardMark,E:{NODES:[nodes]},
});
const editor=vm.runInContext('({'+source.slice(begin,end)+'})',context);
const first=editor.codyScreenMarks()[0];
assert.deepEqual(Array.from(first.bounds),intended);
assert.equal(first.nodes,nodes);
rendered=[1040,450,1310,570];
assert.deepEqual(Array.from(editor.codyScreenMarks()[0].bounds),intended,
  'finishing the pen reveal must not change the anchor geometry');
context.cardTest=()=>()=>true;
assert.equal(editor.codyScreenMarks().length,0,'paper/card ink is not attached to desktop content');
console.log('PASS: shipping ring geometry stays complete during pen reveal and excludes card ink.');
