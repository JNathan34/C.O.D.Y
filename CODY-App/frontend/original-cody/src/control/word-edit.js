'use strict';
const {psQuote,runPowerShell}=require('./windows');
const wordDocument=require('./word-document');
const OPERATIONS=new Set(['heading1','heading2','bold','italic','page-break','save']);
const WORD_TARGET='(?:(?:the|my|this)\\s+)?(?:(?:current|open|active)\\s+)?(?:(?:Microsoft\\s+)?Word(?:\\s+doc(?:ument)?)?|doc(?:ument)?)';
const DESTINATION='(?:in|into|to)\\s+'+WORD_TARGET;
const BEFORE_TEXT=new RegExp('^('+DESTINATION+')\\s*:\\s*([\\s\\S]+)$','i');
const AFTER_TEXT=new RegExp('^([\\s\\S]+?)\\s+('+DESTINATION+')(?:,?\\s+please)?[.!?]*$','i');
const NO_LITERAL_TEXT=new RegExp('^(?:'+DESTINATION+')[.!?]*$','i');
const DRAFT_REQUEST=/^(?:(?:a|an|one|two|three|\d+)\s+(?:(?:new|short|brief|long|detailed)\s+)*(?:sentences?|paragraphs?|introduction|report|summary|overview|letter|email|message|essay|story|note|poem|list|document)\b|something\b|some\s+(?:stuff|text|words)\b|this(?:\s+text)?$|the following(?:\s+text)?$)/i;
function parseWordInsertion(input,{wordSelected=true}={}){
 const command=String(input||'').trim().replace(/^(?:(?:please|(?:can|could|would) you)\s+)+/i,'');
 const match=/^(type|insert|write|add)(?=\s|:)\s*([\s\S]+)$/i.exec(command);
 if(!match)return null;
 const verb=match[1].toLowerCase();
 const body=match[2];
 const prefixed=BEFORE_TEXT.exec(body);
 const suffixed=prefixed?null:AFTER_TEXT.exec(body);
 if(!wordSelected&&!prefixed&&!suffixed)return null;
 const content=prefixed?.[2]??suffixed?.[1]??body;
 const labeled=/^(?:(?:this|the following)(?:\s+text)?\s*)?:\s*([\s\S]+)$/i.exec(content);
 let text=labeled?.[1]??content;
 const quoted=/^(?:"([\s\S]*)"|“([\s\S]*)”)$/.exec(text);
 if(quoted)text=quoted[1]??quoted[2];
 else if(!prefixed&&!labeled&&(verb!=='type'||NO_LITERAL_TEXT.test(text)||DRAFT_REQUEST.test(text)))return null;
 if(!text.trim())return null;
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
async function editWord(args,{runner=runPowerShell,target,signal}={}){
 const clean=validateWordArgs(args);
 if(clean.operation==='insert'){
  if(!target?.fingerprint)throw Error('Select an open Word document first.');
  const result=await wordDocument.execute({steps:[{type:'insert',text:clean.text}]},target,{runner,signal});
  if(result.cancelled)return result;
  return {message:'Text inserted in Word.',document:result.document,operation:'insert'};
 }
 const raw=await runner(wordScript(clean,target),{timeout:18000});
 let data;try{data=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Word did not confirm editing operation.');}
 if(data?.ok!==true||data.operation!==clean.operation||typeof data.message!=='string'||!data.message.trim())throw Error('Word did not verify requested edit.');
 return {message:data.message,document:String(data.document||'').slice(0,180),operation:clean.operation};
}
module.exports={WORD_TARGET,parseWordCommand,parseWordInsertion,validateWordArgs,wordScript,captureWordTarget,editWord};
