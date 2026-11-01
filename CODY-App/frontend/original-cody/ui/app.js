'use strict';
const $=id=>document.getElementById(id);
const preview=!window.cody;
const api=window.cody || {
  async state(){return {settings:{defaultReasoning:'medium',optimiseContext:true,confirmExpensiveTasks:true,localAI:false,model:'',workingFolder:''},chats:[],activeChatId:null,busy:false,connected:false}},
  async newChat(){throw Error('Open this application with Electron to create a conversation')},
  async connect(){throw Error('Preview only — run C.O.D.Y on Windows')},
  async saveSettings(){throw Error('Preview only')},
  async account(){return null},async signIn(){throw Error('Preview only')},async webStatus(){return {online:false,error:'Preview only'}},async webSignIn(){throw Error('Preview only')},async openChatGPT(){throw Error('Preview only')},async sendMessage(){throw Error('Preview only')},on:()=>()=>{},windowAction:()=>{},browseFolder:async()=>null,rateLimits:async()=>null
};
let voiceUI=null;
const app={data:null,page:'chat',mode:'chatgpt',busy:false,models:[],connected:false,connectingCodex:false,webOnline:false,webNeedsLogin:false,webStage:'loading',webDetail:'Starting ChatGPT browser…',pendingApproval:[],quota:null};
let toastTimer=null;
function toast(message){$('toast').textContent=String(message);$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4200);}
function nowChat(){return app.data?.chats?.find(c=>c.id===app.data.activeChatId)||null;}
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function setPage(page){app.page=page;$('chat-page').classList.toggle('hidden',page!=='chat');$('settings-page').classList.toggle('hidden',page!=='settings');document.querySelectorAll('[data-nav]').forEach(n=>n.classList.toggle('active',n.dataset.nav===page));}
function renderChats(){const list=$('chat-list');list.replaceChildren();const chats=app.data?.chats||[];$('chat-count').textContent=String(chats.length);for(const c of chats){const btn=el('button','chat-entry'+(c.id===app.data.activeChatId?' active':''));const g=el('span','chat-glyph','☷');const t=el('span','chat-text',c.title||'Conversation');const del=el('span','chat-delete','×');del.title='Delete conversation';del.addEventListener('click',async e=>{e.stopPropagation();if(!confirm('Delete this conversation from C.O.D.Y?'))return;try{await api.deleteChat(c.id);}catch(ex){toast(ex.message)}});btn.append(g,t,del);btn.addEventListener('click',async()=>{voiceUI?.stopSpeech();try{const result=await api.selectChat(c.id);app.data.activeChatId=c.id;renderChats();renderMessages();setPage('chat');}catch(ex){toast(ex.message)}});list.append(btn);}}
function addMessageNode(m){const box=el('article','message '+(m.role==='user'?'user':m.mode==='local'?'local':'assistant'));box.dataset.messageId=m.id;const avatar=el('div','message-avatar',m.role==='user'?'YOU':m.mode==='local'?'✓':'✦');const body=el('div','message-body');const meta=el('div','message-meta');meta.append(el('span','message-name',m.role==='user'?'You':'C.O.D.Y'),el('span','message-mode',m.mode==='agent'?'Agent':m.mode==='local'?'Windows utility':'Chat'));const text=el('div','message-content',m.text||'');if(m.role==='assistant'&&!m.text)box.classList.add('pending');body.append(meta,text);box.append(avatar,body);$('messages').append(box);return box;}
function renderMessages(){const chat=nowChat();$('messages').replaceChildren();$('empty-state').classList.toggle('hidden',Boolean(chat?.messages?.length));$('conversation-title').textContent=chat?.title||'C.O.D.Y';for(const m of chat?.messages||[])addMessageNode(m);scrollEnd();}
function scrollEnd(){$('chat-scroll').scrollTop=$('chat-scroll').scrollHeight;}
function renderSettings(){const s=app.data?.settings||{};const control=s.computerControl||{};const firefox=app.data?.firefoxConnection;if(firefox)$('firefox-bridge-status').textContent=firefox.connected?'Firefox connected':(firefox.error||'Firefox offline');
  $('control-enabled').checked=control.enabled===true;
  for(const el of document.querySelectorAll('input[name="control-level"]'))el.checked=el.value===(control.level==='full'?'advanced':control.level==='standard'?'approve-safe':control.level||'approve-safe');
  for(const el of document.querySelectorAll('[data-control-permission]'))el.checked=control[el.dataset.controlPermission]===true;$('reasoning-select').value=s.defaultReasoning||'medium';$('web-model-select').value=s.webModel||'website';$('web-model-quick').value=s.webModel||'website';$('reasoning-chip').textContent=capitalize(s.defaultReasoning||'medium');$('optimize-context').checked=s.optimiseContext!==false;$('confirm-cost').checked=s.confirmExpensiveTasks!==false;$('background-toggle').checked=s.runInBackground!==false;$('start-minimised').checked=s.startMinimized===true;$('folder-value').textContent=s.workingFolder||'Not selected';voiceUI?.render();$('model-select').replaceChildren(new Option('Codex default',''));for(const m of app.models){const id=m.model||m.id;if(id)$('model-select').add(new Option(m.displayName||id,id));}$('model-select').value=s.model||'';}
function capitalize(s){return s[0].toUpperCase()+s.slice(1).replace('xhigh','xtra high');}
function setMode(mode){
  app.mode=mode;const agent=mode==='agent';
  $('mode-agent').classList.toggle('selected',agent);
  $('mode-chat').classList.toggle('selected',!agent);
  $('mode-description').textContent=agent?'Folder-limited computer tasks':'ChatGPT · cloud chat';
  $('footer-provider').textContent=agent?'Cloud AI via official Codex':'ChatGPT in C.O.D.Y · cloud AI';
  $('footer-sandbox').textContent=agent?'Workspace-write + approvals':app.data?.settings?.computerControl?.enabled?'Windows control · '+({'ask':'Ask','approve-safe':'Approve safe','full':'Advanced','advanced':'Advanced','off':'Off','standard':'Standard'}[app.data?.settings?.computerControl?.level]||'Approve safe'):'Windows controls off';
  renderWebNotice();
  $('reasoning-chip').classList.toggle('hidden',!agent);$('web-model-quick').classList.toggle('hidden',agent);$('quota-banner').classList.toggle('hidden',!agent||!app.quota?.blocked);
  $('send').textContent='↑';
  $('send').title=agent?'Send to Codex Agent':'Send to ChatGPT in C.O.D.Y (Enter)';
  $('prompt').placeholder=agent?'Tell C.O.D.Y what to do in your working folder...':'Ask ChatGPT a question...';
  $('status-label').textContent=agent?(app.connected?'Codex online':'Codex standby'):webStatusLabel();
  $('status-indicator').classList.toggle('online',agent?app.connected:app.webOnline);
} 
function webStatusLabel(){
  return app.webOnline?'ChatGPT online':app.webStage==='auth'?'Sign in to ChatGPT':app.webStage==='challenge'?'Security check':app.webStage==='unrecognized'?'ChatGPT needs repair':app.webStage==='error'?'ChatGPT connection error':'Connecting ChatGPT…';
}
function applyWebStatus(h){
  app.webOnline=Boolean(h?.signedIn||h?.connected);
  app.webNeedsLogin=Boolean(h?.authRequired||h?.needsSignIn);
  app.webStage=h?.stage||(app.webOnline?'ready':app.webNeedsLogin?'auth':'loading');
  app.webDetail=h?.detail||'Checking ChatGPT…';
  $('web-connection-detail').textContent=app.webDetail;
  if(app.mode==='chatgpt')setMode('chatgpt');
}
function renderWebNotice(){
  const needsAttention=app.webNeedsLogin||['error','challenge','unrecognized'].includes(app.webStage);
  const show=app.mode==='chatgpt'&&needsAttention&&!app.webOnline;
  $('chatgpt-notice').classList.toggle('hidden',!show);
  if(show){
    $('web-notice-title').textContent=app.webNeedsLogin?'ChatGPT sign-in required':'ChatGPT connection needs attention';
    $('web-notice-text').textContent=app.webDetail;
    $('web-connect-inline').textContent=app.webNeedsLogin?'Sign in':'Inspect page';
  }
}

function ukDate(epoch){
  if(!epoch)return 'not reported';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(Number(epoch)*1000));
}
function quotaSnapshot(data){
  const r=data?.rateLimits || data?.rateLimitsByLimitId?.codex || data || {};
  const full=w=>Boolean(w&&Number(w.usedPercent)>=100&&Number(w.resetsAt)*1000>Date.now());
  const active=full(r.primary)?r.primary:full(r.secondary)?r.secondary:null;
  return {primary:r.primary||null,secondary:r.secondary||null,blocked:Boolean(active),resetsAt:active?.resetsAt||null,planType:r.planType||null};
}
function setQuota(input){
  // IPC may send a validated summary; the Usage button receives the full response.
  const q=input && Object.hasOwn(input,'blocked')?input:quotaSnapshot(input);
  app.quota=q;
  const blocked=Boolean(q?.blocked && q.resetsAt*1000>Date.now());
  $('quota-banner').classList.toggle('hidden',!blocked||app.mode!=='agent');
  if(blocked)$('quota-banner-text').textContent='Codex limit reached. Resets '+ukDate(q.resetsAt)+' (UK). Normal ChatGPT is still available.';
  $('status-label').textContent=app.mode==='chatgpt'?webStatusLabel():blocked?'Codex limit reached':app.connected?'Codex online':'Codex standby';
}
function quotaText(q){
  if(!q)return 'No rate-limit data available.';
  const line=(title,w)=>w?`${title}: ${Number(w.usedPercent).toFixed(0)}% used\nResets: ${ukDate(w.resetsAt)} (UK time)`:`${title}: not reported`;
  return [q.blocked?'Codex allowance temporarily exhausted.':'Codex allowance not currently shown as exhausted.',line('5-hour allowance',q.primary),line('Weekly allowance',q.secondary),'Normal ChatGPT Plus messages use a different allowance.','C.O.D.Y does not automatically purchase additional credits.'].join('\n\n');
}
function busy(value){app.busy=Boolean(value);$('send').classList.toggle('hidden',app.busy);$('stop').classList.toggle('hidden',!app.busy);$('prompt').disabled=app.busy;}
async function updateSettings(change){try{const s=await api.saveSettings(change);app.data.settings={...app.data.settings,...s};renderSettings();}catch(e){toast(e.message);renderSettings();}}
async function send({voice=false}={}){
  if(voice)setMode('chatgpt');
  if(app.busy)return;const text=$('prompt').value.trim();if(!text)return;voiceUI?.stopSpeech();
  if(preview){toast('Run C.O.D.Y with Start-CODY.bat to use ChatGPT or Codex.');return;}
  // ChatGPT Web and Agent now both create visible CODY conversations.
  if(!app.data.activeChatId){try{const c=await api.newChat();if(!app.data.chats.some(x=>x.id===c.id))app.data.chats.unshift(c);app.data.activeChatId=c.id;renderChats();}catch(e){toast(e.message);return;}}
  try{
    const res=await api.sendMessage({chatId:app.data.activeChatId,text,mode:app.mode});
    if(res?.cancelled)return;
    if(res?.blocked){setQuota(res.quota);toast(res.error||'Codex usage limit reached');return;}
    if(res?.error){toast(res.error);if(res.needsSignIn){applyWebStatus({stage:'auth',needsSignIn:true,detail:res.error});}if(app.mode==='chatgpt')void checkWeb();return;}
    $('prompt').value='';$('prompt').style.height='auto';
  }catch(e){toast(e.message);}
}
function registerHandlers(){
  $('min-window').addEventListener('click',()=>api.windowAction('minimize'));
  $('max-window').addEventListener('click',()=>api.windowAction('maximize'));
  $('close-window').addEventListener('click',()=>api.windowAction('close'));
  $('new-chat').addEventListener('click',async()=>{voiceUI?.stopSpeech();try{const c=await api.newChat();if(!app.data.chats.some(x=>x.id===c.id))app.data.chats.unshift(c);app.data.activeChatId=c.id;renderChats();renderMessages();setPage('chat');$('prompt').focus();}catch(e){toast(e.message)}});
  document.querySelectorAll('[data-nav]').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.nav)));
  $('show-settings').addEventListener('click',()=>setPage('settings'));
  $('back-chat').addEventListener('click',()=>setPage('chat'));
  $('account-btn').addEventListener('click',()=>setPage('settings'));
  $('mode-chat').addEventListener('click',()=>{setMode('chatgpt');checkWeb();});
  $('open-chatgpt').addEventListener('click',async()=>{try{await api.openChatGPT();await checkWeb();}catch(e){toast('Could not open ChatGPT: '+e.message);}});
  $('web-connect-inline').addEventListener('click',async()=>{try{await api.webSignIn();toast('Sign in once, then return to CODY.');}catch(e){toast(e.message);}});
  $('mode-agent').addEventListener('click',()=>{setMode('agent');connectCodex();if(!app.data.settings.workingFolder)toast('Choose a working folder in Settings before using Agent mode.');});
  $('send').addEventListener('click',send);
  $('stop').addEventListener('click',async()=>{try{await api.stop();toast('Stop requested.');}catch(e){toast(e.message)}});
  $('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  $('prompt').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(155,e.target.scrollHeight)+'px';});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();$('new-chat').click();}if(e.key==='Escape'){$('usage-overlay').classList.add('hidden');}});
  document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>{$('prompt').value=b.dataset.prompt;$('prompt').focus();}));
  $('reasoning-select').addEventListener('change',e=>updateSettings({defaultReasoning:e.target.value}));
  $('model-select').addEventListener('change',e=>updateSettings({model:e.target.value}));
  $('web-model-select').addEventListener('change',e=>updateSettings({webModel:e.target.value}));
  $('web-model-quick').addEventListener('change',e=>updateSettings({webModel:e.target.value}));
  $('optimize-context').addEventListener('change',e=>updateSettings({optimiseContext:e.target.checked}));
  $('confirm-cost').addEventListener('change',e=>updateSettings({confirmExpensiveTasks:e.target.checked}));
  $('background-toggle').addEventListener('change',e=>updateSettings({runInBackground:e.target.checked}));
  $('start-minimised').addEventListener('change',e=>updateSettings({startMinimized:e.target.checked}));
  const changeControl=async change=>{
    try{
      const response=await api.control.configure(change);
      if(response?.cancelled){toast('Full access was not enabled.');return;}
      const permissions=response?.permissions||response;
      app.data.settings.computerControl=permissions;
      renderSettings();
      toast('Computer control settings saved.');
    }catch(e){toast('Computer control: '+e.message);}finally{renderSettings();}
  };
  $('control-enabled').addEventListener('change',e=>{void changeControl({enabled:e.target.checked});});
  $('control-emergency-stop').addEventListener('click',async()=>{try{await api.control.emergencyStop();app.data.settings.computerControl.enabled=false;renderSettings();toast('Windows computer controls stopped and disabled.');}catch(e){toast(e.message)}});
  for(const el of document.querySelectorAll('input[name="control-level"]'))
    el.addEventListener('change',e=>{if(e.target.checked)void changeControl({level:e.target.value});});
  for(const el of document.querySelectorAll('[data-control-permission]'))
    el.addEventListener('change',e=>{void changeControl({[e.target.dataset.controlPermission]:e.target.checked});});

  $('firefox-bridge-check').addEventListener('click',async()=>{try{const info=await api.control.firefoxStatus();$('firefox-bridge-status').textContent=info.connected?'Firefox connected':info.error||'Firefox not connected';}catch(e){$('firefox-bridge-status').textContent='Bridge unavailable';toast(e.message)}});
  $('firefox-bridge-test').addEventListener('click',async()=>{
    try{const out=await api.control.firefoxTest();if(out.cancelled){toast('Firefox page test cancelled.');return;}
      if(out.kind==='extension-verified'){
        $('firefox-bridge-status').textContent='Tools connected · No C.O.D.Y tabs';toast(out.detail);return;
      }
      const page=out.result?.pageState||out.result?.data||{};
      const title=page.title||page.url||'Firefox returned a page response';
      $('firefox-bridge-status').textContent='Page test succeeded';toast('Firefox tool works: '+String(title).slice(0,120));
    }catch(e){$('firefox-bridge-status').textContent='Page test failed';toast('Firefox: '+e.message);}
  });
  $('check-web').addEventListener('click',checkWeb);
  $('web-sign-in').addEventListener('click',async()=>{try{const r=await api.webSignIn();toast('Sign in once; future conversations stay entirely in C.O.D.Y.');}catch(e){toast(e.message);}});
  $('choose-folder').addEventListener('click',async()=>{try{const folder=await api.browseFolder();if(folder){app.data.settings.workingFolder=folder;renderSettings();}}catch(e){toast(e.message)}});
  $('sign-in').addEventListener('click',async()=>{try{await api.signIn();toast('Finish signing in with ChatGPT in your browser.');}catch(e){toast(e.message)}});
  const openUsage=async()=>{$('usage-overlay').classList.remove('hidden');$('usage-text').textContent='Checking available usage data…';try{const data=await api.rateLimits();const q=quotaSnapshot(data);setQuota(q);$('usage-text').textContent=quotaText(q);}catch(e){$('usage-text').textContent='Could not read current usage: '+e.message;}};
  $('usage-btn').addEventListener('click',openUsage);
  $('quota-details').addEventListener('click',openUsage);
  $('close-usage').addEventListener('click',()=>$('usage-overlay').classList.add('hidden'));
  $('deny-approval').addEventListener('click',()=>approvalDecision('decline'));
  $('allow-approval').addEventListener('click',()=>approvalDecision('accept'));
}
async function approvalDecision(decision){const item=app.pendingApproval.shift();if(!item)return;try{await api.approve(item.id,decision);}catch(e){toast(e.message)}showApproval();}
function showApproval(){const item=app.pendingApproval[0];$('approval-overlay').classList.toggle('hidden',!item);if(!item)return;$('approval-reason').textContent=item.reason||'Codex wants to perform an action.';$('approval-command').textContent=item.command?String(item.command):item.network?'Network: '+JSON.stringify(item.network):item.method;}
function listen(){
  api.on('status',p=>{app.connected=Boolean(p.connected);$('status-indicator').classList.toggle('online',app.mode==='agent'&&app.connected);$('status-label').textContent=app.mode==='chatgpt'?webStatusLabel():app.connected?'Codex online':'Codex offline';if(!app.connected&&app.mode==='agent')toast(p.detail||'Codex disconnected');});
  api.on('diagnostic',x=>{console.warn('Codex diagnostic:',x)});
  api.on('auth-changed',()=>refreshAccount());
  api.on('chats-changed',data=>{app.data=data;renderChats();renderMessages();renderSettings();});
  api.on('settings-changed',s=>{app.data.settings={...app.data.settings,...s};renderSettings();setMode(app.mode);});
  api.on('message-added',({chatId,message})=>{const c=app.data.chats.find(c=>c.id===chatId);if(c&&!c.messages.find(m=>m.id===message.id)){c.messages.push(message);if(message.role==='user'&&c.title==='New chat')c.title=message.text.slice(0,54);renderChats();}if(chatId===app.data.activeChatId){$('empty-state').classList.add('hidden');addMessageNode(message);scrollEnd();}});
  api.on('message-delta',({chatId,messageId,delta})=>{const chat=app.data.chats.find(c=>c.id===chatId);const msg=chat?.messages.find(x=>x.id===messageId);if(msg)msg.text+=delta;if(chatId===app.data.activeChatId){const node=[...document.querySelectorAll('.message')].find(n=>n.dataset.messageId===messageId);if(node){node.querySelector('.message-content').textContent+=delta;node.classList.remove('pending');scrollEnd();}}});
  api.on('message-replace',({chatId,messageId,text})=>{const chat=app.data.chats.find(c=>c.id===chatId);const msg=chat?.messages.find(x=>x.id===messageId);if(msg)msg.text=text;if(chatId===app.data.activeChatId){const scroll=$('chat-scroll');const pinned=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<140;const node=[...document.querySelectorAll('.message')].find(n=>n.dataset.messageId===messageId);if(node){node.querySelector('.message-content').textContent=text;node.classList.remove('pending');if(pinned)scrollEnd();}}});
  api.on('busy',({busy:working})=>{busy(working);if(!working){$('activity').classList.add('hidden');document.querySelectorAll('.message.pending').forEach(m=>m.classList.remove('pending'));}});
  api.on('activity',p=>{$('activity').classList.remove('hidden');$('activity-text').textContent=String(p.text).slice(0,240);});
  api.on('approval',x=>{app.pendingApproval.push(x);showApproval();});
  api.on('usage',u=>{app.usage=u});
  api.on('quota',setQuota);
  api.on('firefox-status',info=>{if(app.data)app.data.firefoxConnection=info;const node=$('firefox-bridge-status');if(node)node.textContent=info.connected?'Firefox connected':(info.error||'Firefox offline');});
  api.on('web-status',h=>{applyWebStatus(h);if(!h.connected)console.info('ChatGPT background session:',h.detail);});
}
async function checkWeb(){
  if(preview)return;
  try{const h=await api.webStatus();applyWebStatus(h);return h;}
  catch(e){applyWebStatus({stage:'error',signedIn:false,detail:'ChatGPT status failed: '+e.message});return null;}
}
async function refreshAccount(){try{const acct=await api.account();const connected=acct?.type==='chatgpt';$('account-name').textContent=connected?acct.email||'ChatGPT':'ChatGPT account';$('account-sub').textContent=connected?(acct.planType||'Connected'):'Not signed in';$('auth-detail').textContent=connected?((acct.email||'ChatGPT')+' · '+(acct.planType||'Account')):'Not connected';$('sign-in').textContent=connected?'Reconnect':'Sign in with ChatGPT';}catch(e){$('auth-detail').textContent='Codex unavailable';}}
async function connectCodex(){
  if(preview||app.connectingCodex)return;
  app.connectingCodex=true;
  try{
    const result=await api.connect();app.models=result.models||[];
    app.connected=true;renderSettings();setMode(app.mode);
    await refreshAccount();
    try{setQuota(quotaSnapshot(await api.rateLimits()));}catch(e){console.warn('Codex quota unavailable:',e.message);}
  }catch(e){app.connected=false;setMode(app.mode);toast('Codex Agent unavailable: '+e.message);}
  finally{app.connectingCodex=false;}
}
async function boot(){
  try{
    app.data=await api.state();app.connected=app.data.connected;
    busy(app.data.busy);renderChats();renderMessages();renderSettings();
    setMode('chatgpt');registerHandlers();listen();voiceUI=window.CODYVoice.attach({api,$,toast,send,getApp:()=>app,preview,selectChatGPT:()=>setMode('chatgpt')});
    if(preview)$('status-label').textContent='UI preview';
    // Integrated website status check only. No Codex model, quota, or tokens used.
    if(!preview)void checkWeb();
  }catch(e){document.body.textContent='CODY failed to start: '+e.message;}
}
boot();
