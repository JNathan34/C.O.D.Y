'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,answerText}=require('../src/island/renderer/chat-format');
const answer={outcome:'A business report comparing three methods across three IT projects is due 23 Nov 2026.',numbers:[{value:'23 Nov',label:'Due date'},{value:'17 Dec',label:'Assessment'}],list:[{text:'Explain methods and structures',detail:'P1–P2'},{text:'Compare methods and structures',detail:'M1'},{text:'Evaluate and recommend',detail:'D1'}]};
test('the screenshot reply becomes readable content without protocol tags or JSON',()=>{
 const result=normalize('<ANSWER>'+JSON.stringify(answer)+'</ANSWER>\n<NEXT_ACTIONS>\n- Turn the brief into a work checklist\n- Make a study schedule\n</NEXT_ACTIONS>\n<SUMMARY>Short spoken summary</SUMMARY><DONE_TITLE>Report</DONE_TITLE>');
 assert.match(result,/A business report/);assert.match(result,/Due date: 23 Nov/);assert.match(result,/Explain methods and structures — P1–P2/);assert.match(result,/### Next actions/);assert.doesNotMatch(result,/<ANSWER>|<NEXT_ACTIONS>|"outcome"|Short spoken summary|DONE_TITLE/);
});
test('streamed blocks and metadata never leak partially received JSON',()=>{
 for(const raw of ['<ANS','<ANSWER>{"outcome":"half','<SUMMARY>hidden','<NEXT_ACTIONS>\n- half'])assert.equal(normalize(raw),'');
 assert.equal(normalize('Visible reply\n<ANSWER>{"outcome":"half'),'Visible reply');
 assert.equal(normalize('Visible reply\n<LEARNED>private setup</LEARNED>'),'Visible reply');
 assert.equal(normalize('<SUMMARY>Summary only</SUMMARY>'),'Summary only');
});
test('normal Markdown, code examples and ordinary JSON are preserved',()=>{
 for(const raw of ['## Title\n\n**Bold**\n- First','{"key":"value"}','```xml\n<ANSWER>{"line":"literal"}</ANSWER>\n```'])assert.equal(normalize(raw),raw);
 assert.equal(normalize('<ANSWER>Not JSON, still readable</ANSWER>'),'Not JSON, still readable');
});
test('native line schema supports ranked rows, drafts and optional or malformed collections',()=>{
 const text=answerText({line:'Result',ranked:true,list:[null,{text:'First',detail:'Detail'}],draft:{text:'Hello\nWorld'},note:'Note'});
 assert.match(text,/Result/);assert.match(text,/1\. First — Detail/);assert.match(text,/> Hello\n> World/);assert.match(text,/Note/);
 assert.equal(answerText(null),'');assert.equal(answerText({numbers:{},list:'invalid'}),'');
});
