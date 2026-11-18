'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {runPowerShell}=require('../src/control/windows');

test('PowerShell failures show decoded errors without serialized progress',async()=>{
  const spawn=()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    process.nextTick(()=>{
      child.stderr.emit('data',Buffer.from('#< CLIXML\r\n<Objs><Obj S="progress"><AV>Preparing modules for first use.</AV></Obj><S S="Error">Cannot open &apos;Notes &amp; Plans.docx&apos;._x000D__x000A_</S><S S="Error">Try again.</S></Objs>'));
      child.emit('close',1);
    });
    return child;
  };
  await assert.rejects(runPowerShell('throw "failed"',{spawn,allowNonWindows:true}),error=>{
    assert.equal(error.message,"Cannot open 'Notes & Plans.docx'.\r\nTry again.");return true;
  });
});

test('real Windows PowerShell errors remain readable',{skip:process.platform!=='win32'},async()=>{
  await assert.rejects(runPowerShell("throw 'Choose an open Word document.'"),error=>{
    assert.match(error.message,/Choose an open Word document\./);
    assert.doesNotMatch(error.message,/CLIXML|<Objs|_x000D_|<S /);return true;
  });
  assert.equal(await runPowerShell("Write-Progress -Activity 'Preparing modules' -Status 'Test'; 'ready'"),'ready');
});
