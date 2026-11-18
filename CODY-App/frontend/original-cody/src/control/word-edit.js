'use strict';
const {psQuote,runPowerShell}=require('./windows');
const OPERATIONS=new Set(['heading1','heading2','bold','italic','page-break','save']);
function parseWordInsertion(input){
 const match=/^\s*(?:please\s+)?(?:type|insert|write|add)(?:\s+(?:this|the following)(?:\s+text)?)?(?:\s+(?:in|into|to)\s+(?:(?:the|my|this)\s+)?(?:word(?:\s+document)?|document))?(?:\s*:\s*|\s+)([\s\S]+)$/i.exec(String(input||''));
 if(!match)return null;
 let text=match[1];
 if(text.length>=2&&((text.startsWith('"')&&text.endsWith('"'))||(text.startsWith('“')&&text.endsWith('”'))))text=text.slice(1,-1);
 return {action:'word.edit',args:{operation:'insert',text}};
}
function parseWordCommand(input){
 const text=String(input||'').trim().replace(/^(?:(?:hey[,\s]+)?cody[,\s]+|(?:could|can|would) you\s+|please\s+)/i,'').replace(/[.!?]+$/,'').toLowerCase();
 if(/^(?:make|turn|format|set) (?:this|the|selected|current) (?:paragraph|text|line)(?: (?:as|into|to))? (?:a )?(?:heading(?:\s*1)?|title)$/.test(text))return {action:'word.edit',args:{operation:'heading1'}};
 if(/^(?:make|turn|format|set) (?:this|the|selected|current) (?:paragraph|text|line)(?: (?:as|into|to))? (?:a )?(?:subheading|heading\s*2)$/.test(text))return {action:'word.edit',args:{operation:'heading2'}};
 if(/^(?:bold|make bold) (?:this|the|selected|current) (?:text|selection|paragraph)$/.test(text))return {action:'word.edit',args:{operation:'bold'}};
 if(/^(?:italicise|italicize|make italic) (?:this|the|selected|current) (?:text|selection|paragraph)$/.test(text))return {action:'word.edit',args:{operation:'italic'}};
 if(/^(?:insert|add|make) (?:a )?page break(?: here| in word)?$|^move (?:this|the|selected) (?:paragraph|text) (?:to|onto) (?:a )?new page$/.test(text))return {action:'word.edit',args:{operation:'page-break'}};
 if(/^(?:save|save this|save the) (?:word )?document$/.test(text))return {action:'word.edit',args:{operation:'save'}};
 return null;
}
function validateWordArgs(args){
 if(args?.operation==='insert'){
  if(Object.keys(args).length!==2||typeof args.text!=='string'||!args.text.trim()||args.text.length>25000||args.text.includes('\0'))throw Error('Enter up to 25,000 characters to type in Word.');
  return {operation:'insert',text:args.text};
 }
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||!OPERATIONS.has(args.operation))throw Error('Choose a supported Word editing operation.');
 return {operation:args.operation};
}
const WORD_CONNECTION=[
 "$ErrorActionPreference='Stop'",
 "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
 "$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')",
 "if(-not $word -or -not $word.ActiveDocument -or -not $word.ActiveWindow){throw 'Open a document in Microsoft Word first.'}",
 "$doc=$word.ActiveDocument"
];
async function captureWordTarget({runner=runPowerShell}={}){
 const raw=await runner([...WORD_CONNECTION,
  "if($doc.ReadOnly -or $doc.ProtectionType -ne -1){throw 'Choose an editable Word document.'}",
  "$range=$word.Selection.Range",
  "@{document=$doc.Name;fullName=$doc.FullName;window=[string]$word.ActiveWindow.Hwnd;start=[int]$range.Start;end=[int]$range.End;story=[int]$range.StoryType;length=[int]$doc.Content.End}|ConvertTo-Json -Compress"
 ].join('\n'),{timeout:18000});
 let target;try{target=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Could not identify the open Word document.');}
 if(!target||typeof target.document!=='string'||typeof target.fullName!=='string'||!/^-?\d+$/.test(target.window)||
    !Number.isInteger(target.start)||target.start<0||!Number.isInteger(target.length)||target.length<1||target.story!==1)
  throw Error('Place the cursor in the main text of an editable Word document.');
 return target;
}
function wordInsertionScript(args,target){
 if(!target)throw Error('Select an open Word document first.');
 return [...WORD_CONNECTION,
  "[Console]::InputEncoding=[Text.Encoding]::UTF8",
  "$payload=[Console]::In.ReadToEnd()|ConvertFrom-Json",
  "$target=$payload.target",
  "if($doc.FullName -cne $target.fullName -or [string]$word.ActiveWindow.Hwnd -ne $target.window -or $doc.Content.End -ne $target.length){throw 'The Word document changed. Place the cursor and send the request again.'}",
  "if($doc.ReadOnly -or $doc.ProtectionType -ne -1){throw 'The Word document is not editable.'}",
  "$selection=$word.Selection.Range",
  "if($selection.StoryType -ne 1 -or $selection.Start -ne $target.start){throw 'The Word cursor moved. Send the request again.'}",
  "$range=$doc.Range([int]$target.start,[int]$target.start)",
  "$range.Text=[string]$payload.text",
  "if($range.Text -cne [string]$payload.text){throw 'Word could not verify the inserted text. Check the document before trying again.'}",
  "$range.Collapse(0);$range.Select()",
  "@{ok=$true;operation='insert';message='Text inserted in Word.';document=$doc.Name}|ConvertTo-Json -Compress"
 ].join('\n');
}
function wordOperations(){
 return [
 "switch($operation){",
 " 'heading1' {$selection.Paragraphs.Item(1).Range.Style=$doc.Styles.Item(-2);$message='Heading 1 applied.'}",
 " 'heading2' {$selection.Paragraphs.Item(1).Range.Style=$doc.Styles.Item(-3);$message='Heading 2 applied.'}",
 " 'bold' {if($selection.Range.Start -eq $selection.Range.End){throw 'Select text to bold first.'};$selection.Font.Bold=1;$message='Selected text made bold.'}",
 " 'italic' {if($selection.Range.Start -eq $selection.Range.End){throw 'Select text to italicise first.'};$selection.Font.Italic=1;$message='Selected text italicised.'}",
 " 'page-break' {$selection.InsertBreak(7);$message='Page break inserted at cursor.'}",
 " 'save' {if([string]::IsNullOrWhiteSpace($doc.Path)){throw 'Save As the document in Word first.'};Copy-Item -LiteralPath $doc.FullName -Destination ($doc.FullName+'.cody-backup-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')) -ErrorAction Stop;$doc.Save();if(-not $doc.Saved){throw 'Word did not confirm save.'};$message='Document saved.'}",
 " default {throw 'Unsupported Word operation.'}",
 "}",
 "@{ok=$true;operation=$operation;message=$message;document=$doc.Name}|ConvertTo-Json -Compress"
 ].join('\n');
}
function wordScript(args,target){
 const op=validateWordArgs(args).operation;
 if(target){
  const payload=Buffer.from(JSON.stringify(target),'utf8').toString('base64');
  return [...WORD_CONNECTION,
   "$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("+psQuote(payload)+"))|ConvertFrom-Json",
   "if($doc.FullName -cne $target.fullName -or [string]$word.ActiveWindow.Hwnd -ne $target.window -or $doc.Content.End -ne $target.length){throw 'The active Word document changed. Send the request again.'}",
   "$selection=$word.Selection",
   "if($selection.Range.StoryType -ne 1 -or $selection.Range.Start -ne $target.start -or ($null -ne $target.end -and $selection.Range.End -ne $target.end)){throw 'The Word selection changed. Send the request again.'}",
   "if($doc.ReadOnly -or $doc.ProtectionType -ne -1){throw 'Choose an editable Word document.'}",
   "$operation="+psQuote(op),
   wordOperations()
  ].join('\n');
 }
 return [
 "$ErrorActionPreference='Stop'",
 "Add-Type -TypeDefinition @'",
 "using System;using System.Runtime.InteropServices;",
 "public static class CodyWordForeground {",
 " [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
 " [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);",
 "}",
 "'@ -ErrorAction Stop",
 "$handle=[CodyWordForeground]::GetForegroundWindow();[uint32]$foregroundPid=0",
 "[CodyWordForeground]::GetWindowThreadProcessId($handle,[ref]$foregroundPid) | Out-Null",
 "if($foregroundPid -eq 0 -or (Get-Process -Id $foregroundPid -ErrorAction Stop).ProcessName -ne 'WINWORD'){throw 'Select a Word document first.'}",
 "$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')",
 "if(-not $word -or -not $word.ActiveDocument -or -not $word.ActiveWindow){throw 'No active Word document found.'}",
 "if(([Int64]$word.ActiveWindow.Hwnd -band 0xFFFFFFFF) -ne ($handle.ToInt64() -band 0xFFFFFFFF)){throw 'The Word document changed focus.'}",
 "$doc=$word.ActiveDocument;$selection=$word.Selection",
 "$operation="+psQuote(op),
 wordOperations()
 ].join('\n');
}
async function editWord(args,{runner=runPowerShell,target}={}){
 const clean=validateWordArgs(args);
 const input=clean.operation==='insert'?JSON.stringify({text:clean.text.replace(/\r\n|\n/g,'\r'),target}):undefined;
 const raw=await runner(clean.operation==='insert'?wordInsertionScript(clean,target):wordScript(clean,target),{timeout:18000,input});
 let data;try{data=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Word did not confirm editing operation.');}
 if(data?.ok!==true||data.operation!==clean.operation||typeof data.message!=='string'||!data.message.trim())throw Error('Word did not verify requested edit.');
 return {message:data.message,document:String(data.document||'').slice(0,180),operation:clean.operation};
}
module.exports={parseWordCommand,parseWordInsertion,validateWordArgs,wordScript,wordInsertionScript,captureWordTarget,editWord};
