'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {StateStore} = require('../src/store');

const renderer = path.join(__dirname,'../src/island/renderer');

test('rich inline editor is initialised before chat UI and replaces the detached chip', () => {
  const html=fs.readFileSync(path.join(renderer,'index.html'),'utf8');
  assert.match(html,/id="quick-input" contenteditable="true"/);
  assert.doesNotMatch(html,/id="mention-chip"/);
  assert.ok(html.indexOf('src="inline-editor.js"') < html.indexOf('src="ui.js"'));
  assert.ok(html.includes('src="mentions.js"'));
});

test('outgoing bubble puts the chosen icon/label between the surrounding text spans', () => {
  const source=fs.readFileSync(path.join(renderer,'chat-format.js'),'utf8');
  const nodes=[];
  const target={
    replaceChildren(...items) {nodes.length=0;nodes.push(...items);},
    append(...items) {nodes.push(...items);},
    set textContent(text) {nodes.length=0;nodes.push({text});}
  };
  const context={
    module:{exports:{}},
    document:{createTextNode:text=>({text})},
    window:{CODYInlineComposer:{badge:mention=>({badge:mention.id,name:mention.name})}}
  };
  vm.runInNewContext(source,context,{filename:'chat-format.js'});
  context.module.exports.render(target,'hello this is a test  hello again','user',
    {id:'computer:use',name:'Computer Use',icon:'mouse-pointer-2',offset:21});
  assert.equal(nodes.length,3);
  assert.equal(nodes[0].text,'hello this is a test ');
  assert.equal(nodes[1].badge,'computer:use');
  assert.equal(nodes[1].name,'Computer Use');
  assert.equal(nodes[2].text,' hello again');
});

test('existing plain outgoing messages are not changed', () => {
  const source=fs.readFileSync(path.join(renderer,'chat-format.js'),'utf8');
  const target={textContent:null,replaceChildren(){this.textContent=null;}};
  const context={module:{exports:{}},window:{},document:{}};
  vm.runInNewContext(source,context);
  context.module.exports.render(target,'older message','user');
  assert.equal(target.textContent,'older message');
});

test('mention ID, label and inline location survive store save and reload', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cody-inline-mentions-'));
  try{
    const store=new StateStore(directory);
    const chat=store.newChat();
    const mention={id:'plugin:higgsfield',name:'Higgsfield',icon:'plug',offset:4};
    const message=store.addMessage(chat.id,'user','one two','heyclicky',{mention});
    assert.deepEqual(message.mention,mention);
    const recovered=new StateStore(directory).chat(chat.id);
    assert.deepEqual(recovered.messages[0].mention,mention);
    assert.equal(recovered.messages[0].text,'one two');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
