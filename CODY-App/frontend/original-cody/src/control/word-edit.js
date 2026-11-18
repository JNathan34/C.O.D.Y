'use strict';
const {psQuote,runPowerShell}=require('./windows');
const OPERATIONS=new Set(['heading1','heading2','bold','italic','page-break','save']);
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
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||!OPERATIONS.has(args.operation))throw Error('Choose a supported Word editing operation.');
 return {operation:args.operation};
}
function wordScript(args){
 const op=validateWordArgs(args).operation;
 return [
 "$ErrorActionPreference='Stop'",
 "Add-Type -TypeDefinition @'",
 "using System;using System.Runtime.InteropServices;",
 "public static class CodyWordForeground {",
 " [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
 " [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);",
 "}",
 "'@ -ErrorAction Stop",
 "$handle=[CodyWordForeground]::GetForegroundWindow();[uint32]$pid=0",
 "[CodyWordForeground]::GetWindowThreadProcessId($handle,[ref]$pid) | Out-Null",
 "if($pid -eq 0 -or (Get-Process -Id $pid -ErrorAction Stop).ProcessName -ne 'WINWORD'){throw 'Select a Word document first.'}",
 "$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')",
 "if(-not $word -or -not $word.ActiveDocument -or -not $word.ActiveWindow){throw 'No active Word document found.'}",
 "if([Int64]$word.ActiveWindow.Hwnd -ne $handle.ToInt64()){throw 'The Word document changed focus.'}",
 "$doc=$word.ActiveDocument;$selection=$word.Selection",
 "$operation="+psQuote(op),
 "switch($operation){",
 " 'heading1' {$selection.Paragraphs.Item(1).Range.Style=$doc.Styles.Item(-2);$message='Heading 1 applied.'}",
 " 'heading2' {$selection.Paragraphs.Item(1).Range.Style=$doc.Styles.Item(-3);$message='Heading 2 applied.'}",
 " 'bold' {if($selection.Range.Start -eq $selection.Range.End){throw 'Select text to bold first.'};$selection.Font.Bold=1;$message='Selected text made bold.'}",
 " 'italic' {if($selection.Range.Start -eq $selection.Range.End){throw 'Select text to italicise first.'};$selection.Font.Italic=1;$message='Selected text italicised.'}",
 " 'page-break' {$selection.InsertBreak(7);$message='Page break inserted at cursor.'}",
 " 'save' {if([string]::IsNullOrWhiteSpace($doc.Path)){throw 'Save As the document in Word first.'};$doc.Save();if(-not $doc.Saved){throw 'Word did not confirm save.'};$message='Document saved.'}",
 " default {throw 'Unsupported Word operation.'}",
 "}",
 "@{ok=$true;operation=$operation;message=$message;document=$doc.Name}|ConvertTo-Json -Compress"
 ].join('\n');
}
async function editWord(args,{runner=runPowerShell}={}){
 const clean=validateWordArgs(args);
 const raw=await runner(wordScript(clean),{timeout:18000});
 let data;try{data=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw Error('Word did not confirm editing operation.');}
 if(data?.ok!==true||data.operation!==clean.operation||typeof data.message!=='string'||!data.message.trim())throw Error('Word did not verify requested edit.');
 return {message:data.message,document:String(data.document||'').slice(0,180),operation:clean.operation};
}
module.exports={parseWordCommand,validateWordArgs,wordScript,editWord};
