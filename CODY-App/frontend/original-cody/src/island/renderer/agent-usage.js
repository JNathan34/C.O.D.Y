'use strict';
(()=>{
 const api=window.assistant?.agents,page=document.querySelector('[data-content="agents"]');if(!api?.usage||!page)return;
 const $=id=>document.getElementById(id),button=$('agent-usage-refresh'),status=$('agent-usage-status'),details=$('agent-usage-details');
 let pending=false,wasVisible=false;
 const visible=()=>!page.hidden&&document.body.classList.contains('settings-open')&&!document.hidden;
 const number=value=>Number.isFinite(value)?Math.max(0,value).toLocaleString():'Unavailable';
 const brand=value=>String(value||'').replace(/\b(?:hey\s*)?clicky\b/gi,'C.O.D.Y');
 function meter(id,bucket){
  const value=$(id+'-value'),remaining=$(id+'-remaining'),bar=$(id+'-meter');
  value.textContent=bucket.unlimited?'Unlimited':number(bucket.used)+' / '+number(bucket.cap)+' used';
  remaining.textContent=bucket.unlimited?'Unlimited conversations':number(bucket.remaining)+' remaining';
  bar.hidden=bucket.unlimited;bar.max=Math.max(1,bucket.cap);bar.value=Math.max(0,Math.min(bucket.used,bucket.cap));
 }
 function date(value){const result=value&&new Date(value);return result&&Number.isFinite(result.getTime())?result.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):null;}
 async function refresh(){
  if(pending)return;pending=true;button.disabled=true;status.textContent='Refreshing C.O.D.Y usage…';
  try{
   const data=await api.usage();details.hidden=!data.available;
   if(!data.available){status.textContent=brand(data.error)||'C.O.D.Y usage is unavailable.';return;}
   $('agent-usage-plan').textContent=brand(data.plan);
   meter('agent-usage-agents',data.agents);meter('agent-usage-messages',data.messages);
   const resets=date(data.resetsAt),updated=date(data.updatedAt);
   $('agent-usage-reset').textContent=resets?'Usage resets '+resets:'Reset date unavailable';
   status.textContent=data.stale?brand(data.error):updated?'Updated '+updated:'Usage loaded from your C.O.D.Y account.';
  }catch(error){details.hidden=true;status.textContent='C.O.D.Y usage is unavailable. '+brand(error.message);}
  finally{pending=false;button.disabled=false;}
 }
 button.addEventListener('click',()=>void refresh());
 function visibility(){const current=visible();if(current&&!wasVisible)void refresh();wasVisible=current;}
 const observer=new MutationObserver(visibility);observer.observe(page,{attributes:true,attributeFilter:['hidden']});observer.observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',()=>{if(visible())void refresh();});
 window.assistant.on('busy',value=>{if(!value.busy&&visible())void refresh();});
 setInterval(()=>{if(visible())void refresh();},60000);visibility();
})();
