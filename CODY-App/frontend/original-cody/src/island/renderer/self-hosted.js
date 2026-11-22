'use strict';
(()=>{
 const api=window.assistant?.selfHosted,area=document.querySelector('[data-content="integrations"]');
 const status=document.getElementById('self-hosted-status'),overseerrStatus=document.getElementById('overseerr-status');
 if(!api||!area||!status||!overseerrStatus)return;
 let state,busy=false,plexState=null,plexTimer,plexLoading=false,plexFeedback='',plexRevision=0;
 const plexApi=api.plexSignIn;
 const plexButton=document.getElementById('plex-sign-in');
 const plexTest=document.getElementById('plex-test');
 const plexViewers=document.getElementById('plex-viewers');
 const plexDisconnect=area.querySelector('[data-self-hosted-disconnect="plex"]');
 const plexPanel=area.querySelector('[data-media-panel="plex"]');
 const plexCancel=document.getElementById('plex-sign-in-cancel');
 const plexStatus=document.getElementById('plex-sign-in-status');
 const plexServers=document.getElementById('plex-server');
 const plexServerForm=document.getElementById('plex-server-form');
 const plexAddressOptions=document.getElementById('plex-server-address-options');
 const plexAddress=document.getElementById('plex-server-address');
 const overseerrTest=document.getElementById('overseerr-test');
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
 function showOverseerrStatus(message){
  overseerrStatus.textContent=message;
  overseerrStatus.hidden=!message;
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
  }
  overseerrTest.disabled=busy||!state.services?.overseerr?.connected;
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
  if(plexViewers){plexViewers.hidden=!connected;plexViewers.disabled=busy||pending||!connected;}
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
  plexAddressOptions.hidden=!plexState?.canEnterAddress;
  if(plexAddressOptions.hidden){plexAddressOptions.open=false;plexAddress.value='';}
  plexAddress.disabled=plexAddressOptions.hidden||!plexAddressOptions.open||busy;
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
   status.textContent=state.available?'':'Windows encrypted credential storage is unavailable. Connections cannot be saved.';
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
  plexFeedback='Viewing activity verified'+(result.name?' · '+text(result.name):'')+'.';
 },'plex',false));
 plexViewers?.addEventListener('click',()=>{
  const island=window.CODYIsland;
  if(!island?.onQuickMessage||island.backendBusy){plexFeedback='Finish the current request, then check Plex viewers.';renderPlex();return;}
  island.setActiveView('chat');
  void island.onQuickMessage('Who’s watching Plex?');
 });
 overseerrTest.addEventListener('click',()=>void work(async()=>{
  const result=await api.read('overseerr','test');
  if(result?.ok!==true)throw Error('Overseerr did not confirm the connection.');
  showOverseerrStatus('Connection verified.');
 },'overseerr',false));
 plexCancel?.addEventListener('click',async()=>{
  try{plexFeedback='';await invokePlex('cancel');}
  catch(error){plexFeedback=error.message;renderPlex();}
 });
 plexAddressOptions.addEventListener('toggle',renderPlex);
 plexServers.addEventListener('change',()=>{plexAddress.value='';plexAddressOptions.open=false;});
 plexServerForm?.addEventListener('submit',event=>{
  event.preventDefault();
  void work(async()=>{
   const id=plexServers.value;
   const address=plexAddressOptions.open?plexAddress.value.trim():undefined;
   const server=plexState.servers.find(server=>server.id===id);
   if(!server)return;
   plexState={...plexState,phase:'connecting',message:'Connecting to '+server.name+'…'};
   renderPlex();
   try{await invokePlex('select',id,address);}
   catch(error){await load();throw error;}
  },'plex');
 });
 async function work(action,service,reload=true){
  if(busy)return;busy=true;const buttons=[...area.querySelectorAll('[data-media-panel] button,#plex-connection-actions button,#overseerr-test')].map(button=>({button,disabled:button.disabled}));buttons.forEach(({button})=>button.disabled=true);
  if(service==='plex'){plexFeedback='';renderPlex();}
  else showOverseerrStatus('Working…');
  try{await action();if(reload)await load();}
  catch(error){const message=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');if(service==='plex')plexFeedback=message;else showOverseerrStatus(message);}
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
    showOverseerrStatus('Connection verified. Your API key is saved securely.');
   },service);
  });
 }
 for(const button of area.querySelectorAll('[data-self-hosted-disconnect]')){
  button.addEventListener('click',()=>{
   const service=button.dataset.selfHostedDisconnect;
   if(!window.confirm('Disconnect your '+service+' server and delete its stored token?'))return;
   void work(async()=>{state=await api.disconnect(service);const form=area.querySelector('[data-self-hosted="'+service+'"]');if(form){form.elements.namedItem('key').value='';delete form.dataset.dirty;}if(service==='plex'){plexFeedback='';plexState=await plexApi.state();}else showOverseerrStatus('Overseerr disconnected.');},service);
  });
 }
 document.addEventListener('cody:settings-tab-changed',event=>{if(event.detail==='integrations')void load();});
 document.addEventListener('cody:plex-server-ready',async()=>{
  await load();
  if(plexState?.phase==='servers'&&plexServers.isConnected&&!area.hidden&&document.body.classList.contains('settings-open')){
   plexServerForm.scrollIntoView({block:'nearest'});
   plexServers.focus({preventScroll:true});
  }
 });
 window.addEventListener('focus',()=>{if(plexState&&plexApi)void syncPlex();});
 window.addEventListener('beforeunload',()=>clearTimeout(plexTimer));
})();
