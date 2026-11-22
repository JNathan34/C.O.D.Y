'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WhatsAppWeb}=require('../src/integrations/whatsapp-web');

const draft={recipient:'Mum',phone:null,text:'Tea & biscuits?'};
function setup(overrides={},enabled=()=>true){
  const commands=[];
  const service=new WhatsAppWeb({enabled});
  const defaults={status:{ready:true},'new-chat':true,'search-ready':true,query:true,matches:{count:1},choose:{name:'Mum'},
    composer:true,fill:{status:'filled',seen:['old-message']},send:true,receipt:{sent:true},'clear-draft':true};
  service.ensure=async()=>({isVisible:()=>false,isDestroyed:()=>false});
  service.page=async(_window,command,args)=>{
    commands.push({command,args});
    const result=Object.hasOwn(overrides,command)?overrides[command]:defaults[command];
    return typeof result==='function'?result(args):result;
  };
  return {service,commands};
}

test('WhatsApp verifies a named contact and sends once per verified command',async()=>{
  const {service,commands}=setup();
  assert.equal(await service.send(draft),'sent');
  assert.deepEqual(commands.filter(entry=>entry.command==='send'),[{command:'send',args:{name:'Mum',text:draft.text}}]);
  assert.deepEqual(commands.find(entry=>entry.command==='receipt').args.seen,['old-message']);
  assert.equal(await service.send(draft),'already-sent');
  assert.equal(commands.filter(entry=>entry.command==='send').length,1);
});

test('disabled, signed-out and ambiguous WhatsApp sessions never enter the composer',async()=>{
  const disabled=setup({},()=>false);
  assert.equal(await disabled.service.send(draft),'disabled');
  assert.equal(disabled.commands.length,0);
  const loggedOut=setup({status:{login:true}});
  assert.equal(await loggedOut.service.send(draft),'not-linked');
  const duplicate=setup({matches:{count:2}});
  assert.equal(await duplicate.service.send(draft),'ambiguous');
  assert.equal(duplicate.commands.some(entry=>['choose','fill','send'].includes(entry.command)),false);
});

test('an interrupted send has uncertain status and is never automatically retried',async()=>{
  const {service,commands}=setup({send:()=>{throw Error('Browser disconnected during send');}});
  assert.equal(await service.send(draft),'uncertain');
  assert.equal(await service.send(draft),'uncertain');
  assert.equal(commands.filter(entry=>entry.command==='send').length,1);
  assert.equal(commands.some(entry=>entry.command==='clear-draft'),false);
});

test('stopping before submission clears only Cody’s draft and does not send',async()=>{
  const stop=new AbortController();
  const {service,commands}=setup({fill:()=>{stop.abort();return {status:'filled',seen:[]};}});
  assert.equal(await service.send(draft,{signal:stop.signal}),'cancelled');
  assert.equal(commands.some(entry=>entry.command==='send'),false);
  assert.deepEqual(commands.at(-1),{command:'clear-draft',args:{name:'Mum',text:draft.text}});
});
