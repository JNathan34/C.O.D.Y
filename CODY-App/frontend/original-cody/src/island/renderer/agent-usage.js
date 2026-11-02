'use strict';
(()=>{
 const api=window.assistant?.agents,page=document.querySelector('[data-content="agents"]');if(!api?.usage||!page)return;
 const $=id=>document.getElementById(id),status=$('agent-usage-status'),details=$('agent-usage-details');
 let claudePending=false,codexPending=false,wasVisible=false;
 const visible=()=>!page.hidden&&document.body.classList.contains('settings-open')&&!document.hidden;
 const number=value=>Number.isFinite(value)?Math.max(0,value).toLocaleString():'Unavailable';
 const brand=value=>String(value||'').replace(/\b(?:hey\s*)?clicky\b/gi,'Claude Code');
 const date=value=>{const result=value&&new Date(value);return result&&Number.isFinite(result.getTime())?result.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):null;};
 function meter(id,bucket){
  $(id+'-value').textContent=bucket.unlimited?'Unlimited':number(bucket.used)+' / '+number(bucket.cap)+' used';
  $(id+'-remaining').textContent=bucket.unlimited?'Unlimited conversations':number(bucket.remaining)+' remaining';
  const bar=$(id+'-meter');bar.hidden=bucket.unlimited;bar.max=Number.isFinite(bucket.cap)?Math.max(1,bucket.cap):1;bar.value=Number.isFinite(bucket.used)?Math.max(0,Math.min(bucket.used,bar.max)):0;
 }
 function busyClaude(value){for(const id of ['agent-usage-refresh','claude-sign-in','claude-sign-out'])$(id).disabled=value;}
 function connection(signedIn){
  $('claude-sign-in').hidden=signedIn!==false;$('claude-sign-out').hidden=signedIn!==true;
  $('claude-account-state').textContent=signedIn===true?'Signed in':signedIn===false?'Signed out':'Connection unavailable';
 }
 async function refreshClaude(){
  if(claudePending)return;claudePending=true;busyClaude(true);status.textContent='Refreshing Claude Code usage…';
  try{
   const data=await api.usage();connection(data.signedIn);details.hidden=!data.available;
   if(!data.available){status.textContent=brand(data.error)||'Claude Code usage is unavailable.';return;}
   meter('agent-usage-agents',data.agents);meter('agent-usage-messages',data.messages);
   const resets=date(data.resetsAt),updated=date(data.updatedAt);
   $('agent-usage-reset').textContent=resets?'Usage resets '+resets:'Reset date unavailable';
   status.textContent=data.stale?brand(data.error):updated?'Updated '+updated:'Usage loaded from your Claude Code account.';
  }catch(error){details.hidden=true;status.textContent='Claude Code usage is unavailable. '+brand(error.message);}
  finally{claudePending=false;busyClaude(false);}
 }
 async function refreshCodex(){
  if(codexPending||!api.codexUsage)return;codexPending=true;$('codex-usage-refresh').disabled=true;
  const state=$('codex-usage-status'),container=$('codex-usage-details');state.textContent='Refreshing Codex usage…';
  try{
   const data=await api.codexUsage();container.replaceChildren();container.hidden=!data.available;
   $('codex-usage-plan').textContent=data.plan?'ChatGPT '+data.plan+' account allowance':'ChatGPT account allowance';
   if(!data.available){state.textContent=data.error||'Codex usage is unavailable.';return;}
   for(const window of data.windows){
    const row=document.createElement('div');row.className='agent-usage-bucket';
    const heading=document.createElement('div'),label=document.createElement('strong'),value=document.createElement('span');
    label.textContent=window.label;value.textContent=number(window.usedPercent)+'% used';heading.append(label,value);
    const progress=document.createElement('progress');progress.max=100;progress.value=Math.min(100,window.usedPercent);progress.setAttribute('aria-label',window.label+' used');
    const remaining=document.createElement('small');remaining.textContent=number(window.remainingPercent)+'% remaining';
    const reset=document.createElement('small');reset.textContent=date(window.resetsAt)?'Resets '+date(window.resetsAt):'Reset date unavailable';
    row.append(heading,progress,remaining,reset);container.append(row);
   }
   state.textContent=date(data.updatedAt)?'Updated '+date(data.updatedAt):'Usage loaded from your Codex account.';
  }catch(error){container.hidden=true;state.textContent='Codex usage is unavailable. '+error.message;}
  finally{codexPending=false;$('codex-usage-refresh').disabled=false;}
 }
 async function account(action){
  if(claudePending)return;claudePending=true;busyClaude(true);
  try{await api.claudeAccount(action);claudePending=false;await refreshClaude();if(action==='signIn')status.textContent='Finish signing in to Claude Code in your browser.';}
  catch(error){status.textContent=brand(error.message);}
  finally{claudePending=false;busyClaude(false);}
 }
 function refresh(){void refreshClaude();void refreshCodex();}
 $('agent-usage-refresh').addEventListener('click',()=>void refreshClaude());
 $('codex-usage-refresh').addEventListener('click',()=>void refreshCodex());
 $('claude-sign-in').addEventListener('click',()=>void account('signIn'));
 $('claude-sign-out').addEventListener('click',()=>void account('signOut'));
 function visibility(){const current=visible();if(current&&!wasVisible)refresh();wasVisible=current;}
 const observer=new MutationObserver(visibility);observer.observe(page,{attributes:true,attributeFilter:['hidden']});observer.observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',()=>{if(visible())refresh();});
 window.assistant.on('auth-changed',()=>{if(visible())refresh();});
 window.assistant.on('busy',value=>{if(!value.busy&&visible())refresh();});
 setInterval(()=>{if(visible())refresh();},60000);visibility();
})();
