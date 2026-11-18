'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {summary,statusLabel}=require('../src/island/renderer/task-card-state');

test('failed tasks retain the error instead of showing a generic success preview',()=>{
 assert.equal(summary({status:'Failed',error:'Permission denied'}),'Permission denied');
 assert.match(summary({status:'Failed'}),/Task failed/);
 assert.equal(statusLabel({status:'Failed'}),'Failed');
});
test('background tasks have readable completion, waiting and offline states',()=>{
 assert.match(summary({status:'Finished'}),/completed/i);
 assert.match(summary({status:'Stopped'}),/stopped/i);
 assert.match(summary({status:'Running'}),/working/i);
 assert.equal(statusLabel({status:'WaitingForUser'}),'Needs your input');
 assert.equal(statusLabel({status:'Running',statusLabel:'Installing files'}),'Installing files');
 assert.equal(statusLabel({status:'Running'},false),'Offline');
});
test('task previews are collapsed to a safe short summary',()=>{
 assert.equal(summary({status:'Finished',preview:'  Result\n   completed  '}),'Result completed');
 assert.ok(summary({status:'Failed',error:'x'.repeat(400)}).length<=160);
});