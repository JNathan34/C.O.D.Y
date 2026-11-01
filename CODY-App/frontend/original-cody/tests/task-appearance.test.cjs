'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{describe}=require('../src/island/renderer/task-appearance');
test('task app identity follows the actual task rather than a generic document fallback',()=>{
 assert.equal(describe({title:'Preparing WhatsApp message'},{kind:'document'}).app,'whatsapp');
 assert.equal(describe({title:'Messaging Steve'},{kind:'document'}).kind,'message');
 assert.equal(describe({title:'Messaging Steve',preview:'Preparing the WhatsApp draft.'},{kind:'document'}).app,'whatsapp');
 assert.equal(describe({title:'Making a brief'},{files:['Project.docx']}).app,'word');
 assert.equal(describe({title:'Calculate totals'},{outputs:[{name:'Budget.xlsx'}]}).app,'excel');
 assert.equal(describe({title:'Create slides'},{files:['Deck.pptx']}).app,'powerpoint');
 assert.equal(describe({title:'Building a website'},{kind:'website'}).app,'browser');
 assert.equal(describe({title:'Research options'},{kind:'document'}).app,'task');
});
