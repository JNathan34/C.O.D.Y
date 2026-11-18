'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const api=import('../../../tools/browser-keyboard-entry.mjs');

function browserFixture({loseFocus=false,protectedField=false}={}){
  const entered=[];
  const command=async(method,{functionDeclaration}={})=>{
    if(method==='Runtime.evaluate')return {result:{objectId:'field'}};
    if(method==='Runtime.releaseObject')return {};
    if(protectedField)return {result:{value:null}};
    if(functionDeclaration.includes('const end=field.selectionEnd'))return {result:{value:{verify:true,value:'keep ',end:5}}};
    if(functionDeclaration.includes('return field.value;'))return {result:{value:'keep '+entered.join('')}};
    return {result:{value:loseFocus&&entered.length?null:true}};
  };
  return {entered,command,send:async segment=>{entered.push(segment);}};
}

test('browser text entry sends graphemes incrementally and verifies existing text was preserved',async()=>{
  const {enterBrowserText}=await api;
  const f=browserFixture();
  await enterBrowserText(f.command,f.send,'Hi 👋🏽');
  assert.deepEqual(f.entered,['H','i',' ','👋🏽']);
});

test('browser typing stops on changed focus and refuses protected fields',async()=>{
  const {enterBrowserText}=await api;
  const f=browserFixture({loseFocus:true});
  await assert.rejects(enterBrowserText(f.command,f.send,'ab'),/lost focus/);
  assert.deepEqual(f.entered,['a']);
  const protectedField=browserFixture({protectedField:true});
  await assert.rejects(enterBrowserText(protectedField.command,protectedField.send,'abc'),/protected/);
  assert.deepEqual(protectedField.entered,[]);
});
