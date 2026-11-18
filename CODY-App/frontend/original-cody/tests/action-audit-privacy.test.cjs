'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {ActionAudit,safeEntry}=require('../src/control/action-audit');
test('audit never records passwords, typed text, file paths, raw errors or tokens',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cody-audit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'actions.jsonl'),audit=new ActionAudit(file);
 audit.append({action:'browser.type',status:'failed',origin:'ai-chat',args:{text:'password: super-secret'},error:'Bearer token-12345678901234567890',destination:'C:\\Users\\alice'});
 const raw=fs.readFileSync(file,'utf8');assert.match(raw,/browser\.type/);
 for(const secret of ['super-secret','Bearer','token-123','alice','destination','args','error'])assert.equal(raw.includes(secret),false);
 assert.deepEqual(audit.recent().map(x=>[x.action,x.status,x.origin]),[['browser.type','failed','ai-chat']]);
});
test('legacy audit rows are redacted on reading and malformed rows ignored',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cody-audit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'old.jsonl');fs.writeFileSync(file,'{bad json}\n'+JSON.stringify({action:'file.read',status:'completed',origin:'chat',args:{password:'private'},error:'API_KEY=secret'})+'\n');
 assert.equal(new ActionAudit(file).recent().length,1);
 assert.equal(Object.hasOwn(new ActionAudit(file).recent()[0],'args'),false);
 assert.equal(Object.hasOwn(safeEntry({action:'file.read',error:'secret'}),'error'),false);
});
test('local memories reject GitHub and bearer credentials',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cody-memory-private-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {MemoryService}=require('../src/memory/service');const cipher={isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()};
 const memory=new MemoryService({directory:dir,cipher});
 try{
  assert.throws(()=>memory.saveLocal('ghp_'+'A'.repeat(40)),/credential/);
  assert.throws(()=>memory.saveLocal('Bearer '+'A'.repeat(40)),/credential/);
  assert.equal(memory.localNotes().length,0);
 }finally{memory.close();}
});