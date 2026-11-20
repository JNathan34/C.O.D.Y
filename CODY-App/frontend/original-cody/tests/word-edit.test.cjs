'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseWordCommand,parseWordInsertion,validateWordArgs,wordScript,editWord}=require('../src/control/word-edit');
const {localMentionRoute}=require('../src/mentions');
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
 const denied=new ComputerController({readPermissions:()=>({enabled:true,level:'ask',keyboardMouse:true,uiAutomation:true,applications:true}),
  runner:async()=>({document:'Notes',fullName:'Notes',window:'123',start:0,end:0,story:1,length:1}),confirm:async()=>false});
 assert.equal((await denied.execute('word.edit',{operation:'heading1'},{origin:'chat'})).cancelled,true);
 const utility=new IslandUtilities({controller:{execute:async()=>({ok:true,result:{message:'Heading 1 applied.',document:'Notes.docx'}})},showCard(){}});
 assert.equal((await utility.run('make this paragraph a heading')).reply,'Heading 1 applied.');
});

test('Word mention preserves literal text and routes only explicit Word operations',()=>{
 const text='Hello, Jacob!\nKeep THIS punctuation.';
 assert.deepEqual(localMentionRoute('plugin:word','type '+text,{}).route,
  {action:'word.edit',args:{operation:'insert',text}});
 assert.equal(parseWordInsertion('insert into my Word document: “Hello world.”').args.text,'Hello world.');
 assert.equal(parseWordInsertion('write a draft about gardening'),null);
 assert.equal(parseWordInsertion('type a paragraph about gardening in Word'),null);
 assert.equal(parseWordInsertion('type two short sentences about gardening in Word'),null);
 assert.equal(parseWordInsertion('type into Word'),null);
 assert.equal(parseWordInsertion('type Hello there',{wordSelected:false}),null);
 assert.equal(localMentionRoute('plugin:word','add a page break',{}).route.args.operation,'page-break');
 assert.equal(localMentionRoute('plugin:word','2+2',{}).route,undefined);
 assert.equal(parseWordCommand('type '+text),null,'ordinary chat typing is not silently redirected to Word');
 for(const text of ['', ' '.repeat(2), 'x'.repeat(25001), 'hello\0world'])
  assert.throws(()=>validateWordArgs({operation:'insert',text}));
});

test('Word insertion captures the document before approval and validates the same document and cursor',async()=>{
 const target={document:'Notes.docx',fullName:'C:\\Docs\\Notes.docx',window:'1234',start:7,end:7,fingerprint:'contents-at-approval'};
 const scripts=[];let approved=false;
 const text="' ; Remove-Item C:\\ -Recurse; '#";
 const controller=new ComputerController({
  readPermissions:()=>({enabled:true,level:'ask',keyboardMouse:true,uiAutomation:true,applications:true}),
  runner:async (script,{input})=>{
   scripts.push(script);
   if(scripts.length===1)return JSON.stringify({ok:true,target});
   assert.ok(approved);
   const payload=JSON.parse(input);
   assert.deepEqual(payload.target,target);
   assert.deepEqual(payload.plan.steps,[{type:'insert',text}]);
   assert.doesNotMatch(script,/Remove-Item|SendKeys|Clipboard/);
   return JSON.stringify({ok:true,completed:1,document:target.document});
  },
  confirm:async({summary})=>{assert.equal(scripts.length,1);assert.match(summary,/Notes.docx/);assert.ok(summary.includes(text));approved=true;return true;}
 });
 assert.equal((await controller.execute('word.edit',{operation:'insert',text},{origin:'chat'})).result.document,'Notes.docx');
});

test('declining Word insertion never runs the write script',async()=>{
 let calls=0;
 const controller=new ComputerController({
  readPermissions:()=>({enabled:true,level:'ask',keyboardMouse:true,uiAutomation:true,applications:true}),
  runner:async()=>{calls++;return {ok:true,target:{document:'Notes',fullName:'Notes',window:'123',start:0,end:0,fingerprint:'original'}};},
  confirm:async()=>false
 });
 assert.equal((await controller.execute('word.edit',{operation:'insert',text:'Hello'},{origin:'chat'})).cancelled,true);
 assert.equal(calls,1);
});
