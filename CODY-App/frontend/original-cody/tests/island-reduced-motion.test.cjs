'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('in-app reduced-motion setting suppresses extra animations and there is no note glow',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../src/island/renderer/assistant.css'),'utf8');
 assert.match(css,/body\[data-motion="off"\]\.timer-finished/);
 assert.match(css,/body\[data-motion="off"\]\[data-expression="squint"\]/);
 const line=css.split('\n').find(x=>x.startsWith('.music-note{'));
 assert.ok(line&&!line.includes('drop-shadow('),'music notes should be glow-free');
});
