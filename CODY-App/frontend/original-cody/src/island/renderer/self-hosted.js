'use strict';
(()=>{
 const api=window.assistant?.selfHosted,area=document.querySelector('[data-content="integrations"]');
 const status=document.getElementById('self-hosted-status'),results=document.getElementById('self-hosted-results');
 if(!api||!area||!status||!results)return;
 let state,busy=false,plexState=null,plexTimer,plexLoading=false,lastSearch=[],plexFeedback='',plexRevision=0;
 const plexApi=api.plexSignIn;
 const plexButton=document.getElementById('plex-sign-in');
 const plexTest=document.getElementById('plex-test');
 const plexDisconnect=area.querySelector('[data-self-hosted-disconnect="plex"]');
 const plexPanel=area.querySelector('[data-media-panel="plex"]');
 const plexCancel=document.getElementById('plex-sign-in-cancel');
 const plexStatus=document.getElementById('plex-sign-in-status');
 const plexServers=document.getElementById('plex-server');
 const plexServerForm=document.getElementById('plex-server-form');
 function text(value){return String(value==null?'':value).slice(0,200);}
 function credentialState(form,service){
  const saved=state?.services?.[service];
  const same=saved?.connected&&form.elements.namedItem('url').value.trim().replace(/\/+$/,'')===saved.url;
  const key=form.elements.namedItem('key');
  key.required=!same;
  key.placeholder=same?'•••••••• (saved — leave blank to keep)':service==='plex'?'Your Plex token':'Your Overseerr API key';
  key.setAttribute('aria-description',same?'Your key is saved securely. Enter a new key only to replace it.':'Enter the key for this server.');
  form.querySelector('button[type="submit"]').textContent=saved?.connected?'Save connection':'Connect';
 }
 function entries(items,transform){
  results.replaceChildren();
  if(!items.length){const line=document.createElement('p');line.className='setting-help';line.textContent='Nothing to show.';results.append(line);return;}
  for(const item of items.slice(0,20)){const line=document.createElement('div');line.className='setting-row';line.textContent=transform(item);results.append(line);}
 }
 function action(label,callback){
  const button=document.createElement('button');button.type='button';button.className='light-action';button.textContent=label;button.addEventListener('click',callback);return button;
 }
 function searchEntries(items){
  lastSearch=items;results.replaceChildren();
  if(!items.length){entries([],()=>{});return;}
  for(const item of items){
   const row=document.createElement('div');row.className='overseerr-search-result';
   const label=document.createElement('p');label.textContent=text(item.title)+' ('+text(item.type)+(item.year?', '+text(item.year):'')+')';
   row.append(label,action('Review request',()=>void work(async()=>requestPreview(await api.requestPreview({id:item.id,type:item.type})),'overseerr',false)));
   results.append(row);
  }
 }
 function requestPreview(detail){
  results.replaceChildren();
  const form=document.createElement('form');form.className='overseerr-request-preview';
  const title=document.createElement('h4');title.textContent=text(detail.title)+(detail.year?' ('+text(detail.year)+')':'');
  const help=document.createElement('p');help.className='setting-help';help.textContent=detail.blocked?'This title is already available or requested.':'Requests use your server’s default quality settings and may be approved automatically.';
  form.append(title,help);
  const submit=document.createElement('button');submit.type='submit';submit.className='light-action';submit.textContent=detail.type==='tv'?'Request selected seasons':'Confirm movie request';submit.disabled=detail.blocked||detail.type==='tv';
  if(detail.type==='tv'&&!detail.blocked){
   const seasons=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='Choose seasons';seasons.append(legend);
   for(const season of detail.seasons){
    const label=document.createElement('label');label.className='overseerr-season';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.name='season';checkbox.value=season.number;checkbox.disabled=season.blocked;
    label.append(checkbox,document.createTextNode(season.name+(season.blocked?' — available or requested':'')));seasons.append(label);
   }
   seasons.addEventListener('change',()=>{submit.disabled=!form.querySelector('input[name="season"]:checked');});form.append(seasons);
  }
  const buttons=document.createElement('div');buttons.className='plugin-card-actions';
  if(!detail.blocked)buttons.append(submit);
  buttons.append(action('Cancel',()=>{searchEntries(lastSearch);status.textContent='Request cancelled.';}));form.append(buttons);
  form.addEventListener('submit',event=>{
   event.preventDefault();if(busy||submit.disabled)return;
   const selected=[...form.querySelectorAll('input[name="season"]:checked')].map(input=>Number(input.value));
   void work(async()=>{
    const result=await api.requestSubmit({token:detail.token,...(detail.type==='tv'?{seasons:selected}:{})});
    status.textContent='Request #'+text(result.id)+' — '+text(result.title)+' — '+({1:'Pending approval',2:'Approved',3:'Declined'}[result.status]||'Status unknown');
   },'overseerr',false);
  });
  status.textContent='Review your '+(detail.type==='tv'?'TV':'movie')+' request';results.append(form);form.querySelector('input:not(:disabled),button')?.focus();
 }
 function render(){
  if(!state)return;
  for(const service of ['plex','overseerr']){
   const connected=state.services?.[service]?.connected===true;
   const label=document.getElementById('self-hosted-'+service+'-state');
   if(label)label.textContent=connected?'Connected to '+text(state.services[service].name||state.services[service].url):'Not connected';
   const form=area.querySelector('form[data-self-hosted="'+service+'"]');
   if(form){if(connected&&!form.dataset.dirty)form.elements.namedItem('url').value=state.services[service].url;credentialState(form,service);}
   area.querySelector('[data-self-hosted-disconnect="'+service+'"]').disabled=busy||!connected;
   for(const button of area.querySelectorAll('[data-self-hosted-read^="'+service+':"]'))button.disabled=busy||!connected;
  }
  area.querySelector('#self-hosted-search-form button').disabled=busy||!state.services?.overseerr?.connected;
  renderPlex();
  document.dispatchEvent(new CustomEvent('cody:self-hosted', {detail:state}));
 }
 function renderPlex(){
  if(!plexButton)return;
  const phase=plexState?.phase;
  const pending=['starting','waiting','discovering','servers','connecting'].includes(phase);
  const connected=state?.services?.plex?.connected===true;
  plexButton.hidden=connected&&!pending;
  plexButton.disabled=busy||!plexApi||pending||state?.available===false;
  plexButton.textContent='Sign in with Plex';
  plexTest.hidden=!connected;
  plexTest.disabled=busy||pending||!connected;
  plexDisconnect.hidden=!connected;
  plexCancel.hidden=!pending;
  plexCancel.disabled=false;
  const message=plexFeedback||(pending||['error','expired'].includes(phase)?plexState?.message:'')||'';
  if(plexStatus.textContent!==message)plexStatus.textContent=message;
  plexStatus.hidden=!message;
  const servers=(plexState?.servers||[]).map(server=>({value:server.id,label:server.name+(server.owned?'':' (shared)')}));
  const options=[...plexServers.options];
  // Replacing the options closes an open native dropdown even if the list is unchanged.
  if(servers.length!==options.length||servers.some((server,i)=>server.value!==options[i].value||server.label!==options[i].text)){
   const selected=plexServers.value;
   plexServers.replaceChildren(...servers.map(server=>new Option(server.label,server.value)));
   if(servers.some(server=>server.value===selected))plexServers.value=selected;
  }
  plexServerForm.hidden=phase!=='servers'||!plexServers.options.length;
  plexServerForm.querySelector('button').disabled=busy||phase!=='servers';
  plexPanel.hidden=!pending&&!plexStatus.textContent;
  clearTimeout(plexTimer);
  if(pending)plexTimer=setTimeout(()=>void syncPlex(),1500);
 }
 async function syncPlex(){
  if(!plexApi||plexLoading||busy)return;
  plexLoading=true;
  const revision=plexRevision;
  try{
   const previous=plexState?.phase;
   const next=await plexApi.state();
   if(revision!==plexRevision)return;
   if(next.phase==='connected'&&previous!=='connected'){
    const saved=await api.status();
    if(revision!==plexRevision)return;
    state=saved;
    plexState=next;
    plexFeedback='';
    render();
   }else{plexState=next;renderPlex();}
  }catch(error){if(revision===plexRevision){plexFeedback=error.message;renderPlex();}}
  finally{plexLoading=false;}
 }
 async function load(){
  const revision=plexRevision;
  try{
   const [saved,next]=await Promise.all([api.status(),plexApi?.state()]);
   if(revision!==plexRevision)return;
   state=saved;
   if(next)plexState=next;
   render();
   if(!state.available)status.textContent='Windows encrypted credential storage is unavailable. Connections cannot be saved.';
  }
  catch(error){status.textContent='Cannot load media connections: '+error.message;}
 }
 async function invokePlex(method,...args){
  const revision=++plexRevision;
  try{
   const next=await plexApi[method](...args);
   if(revision===plexRevision){plexState=next;renderPlex();}
  }catch(error){if(revision===plexRevision)throw error;}
 }
 plexButton?.addEventListener('click',()=>void work(async()=>{
  plexFeedback='';
  await invokePlex('start');
 },'plex'));
 plexTest?.addEventListener('click',()=>void work(async()=>{
  const result=await api.read('plex','test');
  if(result?.ok!==true)throw Error('Plex did not confirm the connection.');
  plexFeedback='Connection verified'+(result.name?' — '+text(result.name):'')+'.';
 },'plex',false));
 plexCancel?.addEventListener('click',async()=>{
  try{plexFeedback='';await invokePlex('cancel');}
  catch(error){plexFeedback=error.message;renderPlex();}
 });
 plexServerForm?.addEventListener('submit',event=>{
  event.preventDefault();
  void work(async()=>{
   const id=plexServers.value;
   const server=plexState.servers.find(server=>server.id===id);
   if(!server)return;
   plexState={...plexState,phase:'connecting',message:'Connecting to '+server.name+'…'};
   renderPlex();
   try{await invokePlex('select',id);}
   catch(error){await load();throw error;}
  },'plex');
 });
 async function work(action,service,reload=true){
  if(busy)return;busy=true;const buttons=[...area.querySelectorAll('[data-media-panel] button,#plex-connection-actions button')].map(button=>({button,disabled:button.disabled}));buttons.forEach(({button})=>button.disabled=true);
  if(service==='plex'){plexFeedback='';renderPlex();}
  else if(service){area.querySelector('[data-media-panel="'+service+'"]').append(status,results);results.replaceChildren();status.textContent='Working…';}
  try{await action();if(reload)await load();}
  catch(error){if(service==='plex')plexFeedback=error.message;else status.textContent=error.message;}
  finally{busy=false;buttons.forEach(({button,disabled})=>{if(button.isConnected)button.disabled=disabled;});render();}
 }
 for(const form of area.querySelectorAll('[data-self-hosted]')){
  form.addEventListener('input',()=>{form.dataset.dirty='true';credentialState(form,form.dataset.selfHosted);});
  form.addEventListener('submit',event=>{
   event.preventDefault();
   const service=form.dataset.selfHosted;
   const url=form.elements.namedItem('url').value,key=form.elements.namedItem('key').value;
   void work(async()=>{
    state=await api.connect(service,{url,key});
    form.elements.namedItem('key').value='';
    delete form.dataset.dirty;
    results.replaceChildren();status.textContent='Connection verified. Your '+service+' key is saved securely and stays saved when you close or minimise this window.';
   },service);
  });
 }
 for(const button of area.querySelectorAll('[data-self-hosted-disconnect]')){
  button.addEventListener('click',()=>{
   const service=button.dataset.selfHostedDisconnect;
   if(!window.confirm('Disconnect your '+service+' server and delete its stored token?'))return;
   void work(async()=>{state=await api.disconnect(service);const form=area.querySelector('[data-self-hosted="'+service+'"]');if(form){form.elements.namedItem('key').value='';delete form.dataset.dirty;}if(service==='plex'){plexFeedback='';plexState=await plexApi.state();}else{results.replaceChildren();status.textContent=service+' disconnected.';}},service);
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
     entries(data,item=>'#'+text(item.id)+' — '+text(item.title)+' ('+text(item.type)+') — '+({1:'Pending approval',2:'Approved',3:'Declined'}[item.status]||'Unknown status'));
    }
   },service,false);
  });
 }
 document.getElementById('self-hosted-search-form').addEventListener('submit',event=>{
  event.preventDefault();const query=document.getElementById('self-hosted-search-query').value.trim();
  void work(async()=>{
   const data=await api.read('overseerr','search',query);
   status.textContent='Overseerr search for '+text(query);
   searchEntries(data);
  },'overseerr',false);
 });
 document.querySelector('[data-tab="integrations"]')?.addEventListener('click',()=>void load());
 window.addEventListener('focus',()=>{if(plexState&&plexApi)void syncPlex();});
 window.addEventListener('beforeunload',()=>clearTimeout(plexTimer));
})();
