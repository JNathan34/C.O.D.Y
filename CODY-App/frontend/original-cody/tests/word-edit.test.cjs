'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseWordCommand,validateWordArgs,wordScript,editWord}=require('../src/control/word-edit');
const {ComputerController}=require('../src/control/controller');
const {IslandUtilities}=require('../src/island-utilities');
test('direct Word commands match only well-scoped operations',()=>{
 const cases={'make this paragraph a heading':'heading1','make selected text into a subheading':'heading2',
  'bold this selection':'bold','italicise selected text':'italic','insert a page break here':'page-break','save this Word document':'save'};
 for(const [input,operation]of Object.entries(cases))assert.equal(parseWordCommand(input)?.args.operation,operation,input);
 for(const input of ['change the Word document however you like','delete all text','format Word and send an email','run macro'])assert.equal(parseWordCommand(input),null);
});
test('Word command verifies foreground Word selection and avoids launching a new instance',()=>{
 const script=wordScript({operation:'heading1'});
 assert.match(script,/GetForegroundWindow/);assert.match(script,/ProcessName -ne 'WINWORD'/);
 assert.match(script,/ActiveWindow.Hwnd/);assert.match(script,/GetActiveObject/);
 assert.doesNotMatch(script,/\$pid\s*=/i,'PowerShell PID is read-only');
 assert.doesNotMatch(script,/Start-Process|New-Object -ComObject Word/);
 assert.throws(()=>validateWordArgs({operation:'bold',path:'C:\\temp\\file.docx'}),/supported/);
});
test('Word result must verify the exact action before claiming success',async()=>{
 const runner=async()=>JSON.stringify({ok:true,operation:'heading1',message:'Heading applied.',document:'Notes.docx'});
 assert.equal((await editWord({operation:'heading1'},{runner})).document,'Notes.docx');
 await assert.rejects(editWord({operation:'heading1'},{runner:async()=>JSON.stringify({ok:false,operation:'heading1',message:'Done'})}),/verify/);
});
test('editing Word requires permissions and approval; no fallback to arbitrary commands',async()=>{
 const disabled=new ComputerController({readPermissions:()=>({enabled:true,level:'approve-safe',keyboardMouse:false,uiAutomation:true,applications:true})});
 await assert.rejects(disabled.execute('word.edit',{operation:'heading1'},{origin:'chat'}),/keyboardMouse/);
 const denied=new ComputerController({readPermissions:()=>({enabled:true,level:'ask',keyboardMouse:true,uiAutomation:true,applications:true}),confirm:async()=>false});
 assert.equal((await denied.execute('word.edit',{operation:'heading1'},{origin:'chat'})).cancelled,true);
 const utility=new IslandUtilities({controller:{execute:async()=>({ok:true,result:{message:'Heading 1 applied.',document:'Notes.docx'}})},showCard(){}});
 assert.equal((await utility.run('make this paragraph a heading')).reply,'Heading 1 applied.');
});
