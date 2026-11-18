'use strict';
(()=>{
 const api=window.assistant?.selfHosted,area=document.getElementById('self-hosted-settings');
 const status=document.getElementById('self-hosted-status'),results=document.getElementById('self-hosted-results');
 if(!api||!area||!status||!results)return;
 let state,busy=false;
 function text(value){return String(value==null?'':value).slice(0,200);}
 function entries(items,transform){
  results.replaceChildren();
  if(!items.length){const line=document.createElement('p');line.className='setting-help';line.textContent='Nothing to show.';results.append(line);return;}
  for(const item of items.slice(0,20)){const line=document.createElement('div');line.className='setting-row';line.textContent=transform(item);results.append(line);}
 }
 function render(){
  if(!state)return;
  for(const service of ['plex','overseerr']){
   const connected=state.services?.[service]?.connected===true;
   document.getElementById('self-hosted-'+service+'-state').textContent=connected?'Connected to '+text(state.services[service].url):'Not connected';
   const form=area.querySelector('form[data-self-hosted="'+service+'"]');
   if(connected)form.elements.namedItem('url').value=state.services[service].url;
   area.querySelector('[data-self-hosted-disconnect="'+service+'"]').disabled=busy||!connected;
   for(const button of area.querySelectorAll('[data-self-hosted-read^="'+service+':"]'))button.disabled=busy||!connected;
  }
 }
 async function load(){
  try{state=await api.status();render();if(!state.available)status.textContent='Windows encrypted credential storage is unavailable. Connections cannot be saved.';}
  catch(error){status.textContent='Cannot load media connections: '+error.message;}
 }
 async function work(action){
  if(busy)return;busy=true;area.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await action();await load();}
  catch(error){status.textContent=error.message;}
  finally{busy=false;area.querySelectorAll('button').forEach(button=>button.disabled=false);render();}
 }
 for(const form of area.querySelectorAll('[data-self-hosted]')){
  form.addEventListener('submit',event=>{
   event.preventDefault();
   const service=form.dataset.selfHosted;
   const url=form.elements.namedItem('url').value,key=form.elements.namedItem('key').value;
   void work(async()=>{
    state=await api.connect(service,{url,key});
    form.elements.namedItem('key').value='';
    results.replaceChildren();status.textContent='Connected to your '+service+' server. No library contents are loaded automatically.';
   });
  });
 }
 for(const button of area.querySelectorAll('[data-self-hosted-disconnect]')){
  button.addEventListener('click',()=>{
   const service=button.dataset.selfHostedDisconnect;
   if(!window.confirm('Disconnect your '+service+' server and delete its stored token?'))return;
   void work(async()=>{state=await api.disconnect(service);results.replaceChildren();status.textContent=service+' disconnected.';});
  });
 }
 for(const button of area.querySelectorAll('[data-self-hosted-read]')){
  button.addEventListener('click',()=>{
   const [service,method]=button.dataset.selfHostedRead.split(':');
   void work(async()=>{
    const data=await api.read(service,method);
    if(method==='sessions'){
     status.textContent='Plex sessions: '+data.count;
     entries(data.sessions||[],item=>text(item.viewer)+' — '+text(item.title)+' ('+text(item.state)+')');
    }else if(method==='recent'){
     status.textContent='Recently added to your Plex server';
     entries(data,item=>text(item.title)+' ('+text(item.type)+')');
    }else{
     status.textContent='Recent Overseerr requests';
     entries(data,item=>'#'+text(item.id)+' — '+text(item.title)+' ('+text(item.type)+')');
    }
   });
  });
 }
 document.getElementById('self-hosted-search-form').addEventListener('submit',event=>{
  event.preventDefault();const query=document.getElementById('self-hosted-search-query').value.trim();
  void work(async()=>{
   const data=await api.read('overseerr','search',query);
   status.textContent='Overseerr search for '+text(query);
   entries(data,item=>text(item.title)+' ('+text(item.type)+', '+text(item.year)+') — TMDB '+text(item.id));
  });
 });
 document.querySelector('[data-tab="integrations"]')?.addEventListener('click',()=>void load());
})();
