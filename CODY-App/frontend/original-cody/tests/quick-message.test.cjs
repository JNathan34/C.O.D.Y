'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const read=file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8');

test('AltGr dispatches the configured phrase only when enabled and nonempty',()=>{
 const source=read('island/main.js'),events=[];
 const context={settings:{quickMessageEnabled:true,quickMessagePhrase:'help'},emit:(...args)=>events.push(args)};
 vm.runInNewContext(source.slice(source.indexOf('function handleHotkey('),source.indexOf('module.exports=')),context);
 context.handleHotkey('quick-message');assert.equal(events[0][0],'island:command');assert.equal(events[0][1].text,'help');
 context.settings.quickMessageEnabled=false;context.handleHotkey('quick-message');
 context.settings.quickMessageEnabled=true;context.settings.quickMessagePhrase='   ';context.handleHotkey('quick-message');assert.equal(events.length,1);
});

function sender({busy=false,sendMessage=async()=>({}),ready=async()=>{}}={}){
 const source=read('island/renderer/assistant.js'),input={value:'Unfinished draft'},calls=[],notes=[];
 const context={app:{busy,data:{activeChatId:'current',chats:[]},mode:'heyclicky'},sendingMessage:false,
  $:()=>input,window:{CODYAttachments:{ready}},voice:{stopSpeech(){}},island:{updateInput(){}},note:text=>notes.push(text),
  api:{sendMessage:async args=>{calls.push(args);return sendMessage(args);}}};
 vm.runInNewContext(source.slice(source.indexOf('  let sendingMessage=false;'),source.indexOf('  island.onPrompt=')),context);
 return {context,input,calls,notes};
}
test('quick messages send to the current chat and preserve the composer draft',async()=>{
 const f=sender();await f.context.island.onQuickMessage('done');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].chatId,'current');assert.equal(f.calls[0].text,'done');assert.equal(f.input.value,'Unfinished draft');
 await f.context.send();assert.equal(f.calls[1].text,'Unfinished draft');assert.equal(f.input.value,'');
});
test('busy or concurrent quick messages do not queue or double send',async()=>{
 const busy=sender({busy:true});await busy.context.island.onQuickMessage('ok');assert.equal(busy.calls.length,0);assert.equal(busy.notes.length,1);
 let release;const f=sender({ready:()=>new Promise(resolve=>{release=resolve;})});
 const first=f.context.island.onQuickMessage('done');await f.context.island.onQuickMessage('done');release();await first;
 assert.equal(f.calls.length,1);assert.equal(f.notes.length,1);
});
test('send errors preserve the draft and allow another tap',async()=>{
 let fail=true;const f=sender({sendMessage:async()=>{if(fail)throw new Error('Offline');return {};}});
 await f.context.island.onQuickMessage('help');assert.equal(f.notes[0],'Offline');assert.equal(f.input.value,'Unfinished draft');
 fail=false;await f.context.island.onQuickMessage('help');assert.equal(f.calls.length,2);
});

test('Windows listener recognizes a physical AltGr tap, excludes chords, holds, repeats and injected input',{skip:process.platform!=='win32'},()=>{
 const listener=path.join(__dirname,'../windows/ctrl-alt-listener.ps1');
 const script=`$ErrorActionPreference='Stop'
$source=Get-Content -LiteralPath '${listener.replace(/'/g,"''")}' -Raw
$csharp=[regex]::Match($source,"(?s)@'\\r?\\n(.*?)\\r?\\n'@").Groups[1].Value
Add-Type -TypeDefinition $csharp
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$callback=[CodyModifierKeys].GetMethod('OnKeyboard',$flags)
$queue=[CodyModifierKeys].GetMethod('NextPointerPress')
$memory=[Runtime.InteropServices.Marshal]::AllocHGlobal(24)
function Key([int]$key,[bool]$down,[int]$time,[int]$injected=0) {
 [Runtime.InteropServices.Marshal]::WriteInt32($memory,0,$key)
 [Runtime.InteropServices.Marshal]::WriteInt32($memory,8,$injected)
 [Runtime.InteropServices.Marshal]::WriteInt32($memory,12,$time)
 $kind=if($down){0x100}else{0x101}
 $null=$callback.Invoke($null,@(0,[IntPtr]$kind,$memory))
}
function Expect($value) {
 $actual=[CodyModifierKeys]::NextPointerPress()
 if($actual -ne $value){throw "Expected '$value', got '$actual'"}
}
try {
 Key 165 $true 100; Key 165 $true 150; Expect $null; Key 165 $false 200; Expect 'ALTGR_TAP'; Expect $null
 Key 165 $true 300; Key 81 $true 350; Key 81 $false 400; Key 165 $false 450; Expect $null
 Key 165 $true 500; Key 165 $false 1300; Expect $null
 Key 165 $true 1400 16; Key 165 $false 1500 16; Expect $null
 Key 165 $true 1600; Key 165 $false 1700; Expect 'ALTGR_TAP'
} finally {[Runtime.InteropServices.Marshal]::FreeHGlobal($memory)}
Write-Output 'AltGr listener passed'
`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/AltGr listener passed/);
});
