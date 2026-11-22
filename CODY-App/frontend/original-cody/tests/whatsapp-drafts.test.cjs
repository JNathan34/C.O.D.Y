'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {WhatsAppDrafts,parseWhatsAppDraft}=require('../src/integrations/whatsapp-drafts');
const {IslandUtilities}=require('../src/island-utilities');
const {installNativeIpc}=require('../src/native-ipc');

function fixture(options={}){
  return new WhatsAppDrafts({open:()=>assert.fail('Opening WhatsApp requires a click'),...options});
}
test('WhatsApp drafts keep punctuation and line breaks and avoid intercepting questions about WhatsApp',()=>{
  assert.deepEqual(parseWhatsAppDraft('Could you message Mum on WhatsApp saying What’s for dinner?\nThanks!'),{recipient:'Mum',text:'What’s for dinner?\nThanks!'});
  assert.deepEqual(parseWhatsAppDraft('Draft a WhatsApp message to Mum: tea & biscuits?'),{recipient:'Mum',text:'tea & biscuits?',draftOnly:true});
  assert.equal(parseWhatsAppDraft('Tell me about messaging on WhatsApp'),null);
  assert.equal(parseWhatsAppDraft('Open WhatsApp and show recent messages'),null);
  assert.equal(parseWhatsAppDraft('Message Mum saying tea?'),null);
  assert.deepEqual(parseWhatsAppDraft('Message Mum saying tea?',{selected:true}),{recipient:'Mum',text:'tea?'});
});
test('named drafts open the WhatsApp contact picker with the exact text and expire locally',async()=>{
  let now=0;const opens=[];
  const drafts=fixture({now:()=>now,open:async url=>{opens.push(new URL(url));}});
  const text='Tea & biscuits? #1\nThanks!';
  const first=drafts.prepare({recipient:'Mum',text});
  assert.match(first.reply,/pick your contact in WhatsApp/);
  assert.equal(opens.length,0);
  assert.deepEqual(drafts.preview(first.draftId),{recipient:'Mum',phone:null,text,opening:false});
  assert.equal((await drafts.openDraft(first.draftId)).opened,true);
  assert.equal(opens[0].origin,'https://wa.me');assert.equal(opens[0].pathname,'/');
  assert.deepEqual([...opens[0].searchParams],[['text',text]]);
  assert.deepEqual(drafts.preview(first.draftId),{opened:true});
  await assert.rejects(drafts.openDraft(first.draftId),/already opened/);
  const second=drafts.prepare({recipient:'Someone else',text});
  now+=11*60*1000;
  assert.equal(drafts.preview(second.draftId),null);
  assert.equal(opens.length,1);
});
test('opening WhatsApp and opening a draft with a supplied international number use the official links',async()=>{
  const opens=[],drafts=fixture({open:async url=>{opens.push(new URL(url));}});
  await drafts.openApp();
  assert.equal(opens[0].href,'https://web.whatsapp.com/');
  const {draftId}=drafts.prepare({recipient:'+44 7700 900 001',text:'Hi again'});
  assert.equal(drafts.preview(draftId).phone,'+447700900001');
  await drafts.openDraft(draftId);
  assert.equal(opens[1].origin,'https://wa.me');assert.equal(opens[1].pathname,'/447700900001');
  assert.equal(opens[1].searchParams.get('text'),'Hi again');
  assert.match(drafts.prepare({recipient:'+12',text:'Hi'}).reply,/full international number/);
});
test('failed handoff is retryable and rapid double-clicks do not open a duplicate',async()=>{
  let resolve,reject;
  const drafts=fixture({open:()=>new Promise((ok,fail)=>{resolve=ok;reject=fail;})});
  const {draftId}=drafts.prepare({recipient:'+447700900001',text:'Hi'});
  const first=drafts.openDraft(draftId);
  await assert.rejects(drafts.openDraft(draftId),/already opening/);
  reject(Error('OS did not open the URL'));await assert.rejects(first,/Could not open WhatsApp/);
  const retry=drafts.openDraft(draftId);resolve();assert.deepEqual(await retry,{opened:true});
});
test('only an opted-in send command dispatches without a preview',async()=>{
  let enabled=false;const requests=[];
  const drafts=fixture({browser:{enabled:()=>enabled,send:async request=>{requests.push(request);return 'sent';}}});
  const command={recipient:'Mum',text:'Tea?'};
  assert.ok((await drafts.submit(command)).draftId);
  enabled=true;
  assert.ok((await drafts.submit({...command,draftOnly:true})).draftId);
  assert.deepEqual(requests,[]);
  const sent=await drafts.submit(command);
  assert.equal(sent.reply,'Message sent on WhatsApp.');
  assert.equal(sent.draftId,undefined);
  assert.deepEqual(requests,[{recipient:'Mum',phone:null,text:'Tea?'}]);
});
test('typed and voice WhatsApp commands retain only the private draft marker in chat history',async()=>{
  const text='Message Mum on WhatsApp saying private dinner plans';
  const drafts=fixture();
  const utilities=new IslandUtilities({whatsappDrafts:drafts});
  const engine=new EventEmitter(),calls=[],messages=[],handlers=new Map();
  engine.connected=true;
  engine.request=async(command,args)=>{calls.push({command,args});return command==='end'?{utilityText:text}:{};};
  engine.refresh=()=>assert.fail('The draft must stay local');
  const store={data:{settings:{},activeChatId:'chat'},chat:()=>({messages}),
    addMessage:(_id,role,text)=>{const message={id:String(messages.length),role,text};messages.push(message);return message;},
    updateMessage:(_id,id,text)=>{messages[Number(id)].text=text;},save(){},publicState:()=>({})};
  const webContents={mainFrame:{}};
  installNativeIpc({ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},engine,store,utilities,sendUI(){},getState:()=>({}),getWindow:()=>({webContents})});
  const invoke=(name,...args)=>handlers.get(name)({sender:webContents,senderFrame:webContents.mainFrame},...args);
  assert.equal((await invoke('send-message',{chatId:'chat',text})).utility,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages[0].text,'Private WhatsApp draft');
  assert.equal(drafts.preview(messages.at(-1).whatsappDraftId).text,'private dinner plans');
  await invoke('native-begin');
  const {turn}=calls.find(call=>call.command==='begin').args;
  engine.emit('transcript',{turn,text});engine.emit('classify-utility',{turn,text});
  await invoke('native-end');
  assert.equal(messages[2].text,'Private WhatsApp draft');
  assert.equal(drafts.preview(messages.at(-1).whatsappDraftId).text,'private dinner plans');
  assert.equal(calls.some(call=>call.command==='submit'||JSON.stringify(call.args||{}).includes('private dinner plans')),false);
  assert.equal((await invoke('mentions-list',true)).items.find(item=>item.name==='WhatsApp').id,'plugin:whatsapp-drafts');
  assert.match((await invoke('send-message',{chatId:'chat',text,capabilityId:'plugin:whatsapp_business'})).error,/Choose the WhatsApp plugin/);
  assert.equal((await invoke('send-message',{chatId:'chat',text:'Message Mum saying tea?',capabilityId:'plugin:whatsapp-drafts'})).local,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(drafts.preview(messages.at(-1).whatsappDraftId).text,'tea?');
  assert.equal(messages.filter(message=>message.role==='user').every(message=>message.text==='Private WhatsApp draft'),true);
});
