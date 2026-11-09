'use strict';
(()=>{
 const api=window.assistant?.agents,page=document.querySelector('[data-content="agents"]');if(!api||!page)return;
 const $=id=>document.getElementById(id),status=$('agents-status'),inputs=[...page.querySelectorAll('[data-agent-setting]')];let saved=null,busy=false;
 const visible=()=>!page.hidden&&document.body.classList.contains('settings-open');
 function render(){if(!saved)return;
  for(const input of inputs){input.checked=saved[input.dataset.agentSetting]===true;input.disabled=busy||(input.dataset.agentSetting==='extraUsage'&&saved.usageEnabled===false);}
  $('agents-folder-label').textContent=saved.folder||'C.O.D.Y. default · '+saved.defaultFolder;
  $('agents-default-folder').textContent=saved.defaultFolder;$('agents-reset-row').hidden=!saved.folder;
  for(const id of ['agents-folder','agents-reset'])$(id).disabled=busy;
  const rows=saved.privacy.map(value=>{const row=document.createElement('button');row.type='button';row.className='setting-row agent-privacy-row';row.dataset.capability=value.id;
   const label=document.createElement('span'),name=document.createElement('strong');name.textContent=value.name;label.className='agent-privacy-label';const icon=document.createElement('span');icon.className='agent-privacy-icon';icon.setAttribute('aria-hidden','true');window.CODYIcons.set(icon,({broadFileSystemAccess:'file-text',documentsLibrary:'file-text',picturesLibrary:'image',contacts:'users',appointments:'calendar-days',microphone:'mic',webcam:'camera',location:'globe'})[value.id]);label.append(icon,name);
   row.title=(value.id==='broadFileSystemAccess'?'Folders an agent opens or writes to. ':'')+'Review '+value.name+' access in Windows Settings';
   const badge=document.createElement('span');badge.className='agent-access '+(value.status==='Granted'?'granted':value.status==='Denied'?'denied':'');badge.textContent=value.status;
   row.append(label,badge);row.addEventListener('click',()=>void api.privacy(value.id).catch(error=>status.textContent=error.message));return row;});$('agents-privacy').replaceChildren(...rows);
 }
 async function run(operation,message){if(busy)return;busy=true;render();try{const next=await operation();if(next)saved=next;status.textContent=message;}catch(error){saved=await api.state().catch(()=>saved);status.textContent=error.message;}finally{busy=false;render();}}
 const provider=$('agents-provider'),providerStatus=$('agents-provider-status');let providerPending=false;
 function renderProvider(value){provider.value=value.provider;$('agents-model-row').hidden=value.provider==='heyclicky';providerStatus.textContent=value.provider==='heyclicky'?'Claude Code uses the account connection below.':value.label+' · GPT 6.1 Sol · Medium reasoning';}
 async function loadProvider(){try{renderProvider(await api.provider());}catch(error){providerStatus.textContent=error.message;}}
 provider.addEventListener('change',async()=>{if(providerPending)return;providerPending=true;provider.disabled=true;try{renderProvider(await api.selectProvider(provider.value));}catch(error){await loadProvider();providerStatus.textContent=error.message;}finally{providerPending=false;provider.disabled=false;}});
 $('agents-provider-connect').addEventListener('click',async()=>{const button=$('agents-provider-connect');button.disabled=true;provider.disabled=true;try{const result=await api.connectProvider();providerStatus.textContent=result.message;}catch(error){providerStatus.textContent=error.message;}finally{button.disabled=false;provider.disabled=false;}});
 window.assistant.on('settings-changed',()=>void loadProvider());
 const refresh=()=>{void loadProvider();return run(()=>api.state(),'');};
 void loadProvider();
 for(const input of inputs)input.addEventListener('change',()=>{
  const key=input.dataset.agentSetting,value=input.checked;
  const message=key==='usageEnabled'?(value?'Agent usage is on.':'Agent usage is off.'):'Agent settings saved.';
  void run(()=>api.configure({[key]:value}),message);
 });
 $('agents-folder').addEventListener('click',()=>void run(()=>api.folder(),''));$('agents-reset').addEventListener('click',()=>void run(()=>api.configure({folder:null}),'Default agent folder restored.'));
 const observer=new MutationObserver(()=>{if(visible())void refresh();});observer.observe(page,{attributes:true,attributeFilter:['hidden']});observer.observe(document.body,{attributes:true,attributeFilter:['class']});
 window.addEventListener('focus',()=>{if(visible())void refresh();});window.CODYAgents=Object.freeze({snapshot:()=>({loaded:!!saved,busy})});
})();
