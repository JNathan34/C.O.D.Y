'use strict';
(()=>{
 const api=window.assistant?.control;
 const button=document.getElementById('action-history-toggle');
 const container=document.getElementById('action-history-results');
 if(!api?.audit||!button||!container)return;
 let busy=false;
 const labels={started:'Started',completed:'Completed',failed:'Failed',denied:'Denied',cancelled:'Cancelled'};
 button.addEventListener('click',async()=>{
  if(busy)return;
  if(!container.hidden){container.hidden=true;button.setAttribute('aria-expanded','false');button.textContent='View history';return;}
  busy=true;button.disabled=true;container.hidden=false;
  try{
   const records=await api.audit();
   if(!Array.isArray(records))throw Error('Action history is unavailable.');
   container.replaceChildren();
   if(records.length===0){
    const empty=document.createElement('p');empty.className='setting-help';empty.textContent='No computer actions have been recorded.';container.append(empty);
   }
   for(const record of records.slice(-80).reverse()){
    const row=document.createElement('div');row.className='setting-row';
    const description=document.createElement('span'),name=document.createElement('strong'),time=document.createElement('small');
    name.textContent=String(record.action||'Action');
    const date=new Date(record.at),when=Number.isNaN(date.getTime())?'Unknown time':date.toLocaleString();
    time.textContent=when+' · '+(labels[record.status]||'Unknown status')+' · '+String(record.origin||'local');
    description.append(name,time);row.append(description);container.append(row);
   }
   button.setAttribute('aria-expanded','true');button.textContent='Hide history';
  }catch(error){container.textContent='Could not read action history: '+error.message;}
  finally{busy=false;button.disabled=false;}
 });
})();