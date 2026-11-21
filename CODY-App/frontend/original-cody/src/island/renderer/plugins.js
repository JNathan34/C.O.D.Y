'use strict';
(()=>{
 const api=window.assistant?.plugins,page=document.querySelector('[data-content="integrations"]');if(!api||!page)return;
 const $=id=>document.getElementById(id),list=$('plugins-list'),status=$('plugins-status'),pending=new Map(),busy=new Set();let browserState={offline:true},catalog=null,loading=false,filter='all',confirmRemoval=null,lastLoaded=0;
 let mediaState={services:{}};
 let computerUse=null,masterControlEnabled=false,savingComputerUse=false;
 const mediaPanels=[...document.querySelectorAll('[data-media-panel]')];
 const plexActions=$('plex-connection-actions');
 const overseerrTest=$('overseerr-test'),overseerrStatus=$('overseerr-status');
 const visible=()=>!page.hidden&&document.body.classList.contains('settings-open');
 const element=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const signin=element('button','light-action','Sign in to Claude Code');signin.id='plugins-signin';signin.hidden=true;status.after(signin);
 const computerUseSwitch=element('input');computerUseSwitch.type='checkbox';computerUseSwitch.role='switch';
 const computerUseLabel=element('label','setting-row plugin-switch');
 computerUseLabel.append(element('span','','Allow Computer Use'),computerUseSwitch);
 const computerUseStatus=element('p','setting-help plugin-switch-status');
 computerUseStatus.role='status';computerUseStatus.hidden=true;
 function button(text,action,disabled=false){const node=element('button','light-action',text);node.type='button';node.disabled=disabled;node.addEventListener('click',action);return node;}
 function updateComputerUse(native,local){
  masterControlEnabled=(native?.enabled??local?.enabled)===true;
  const enabled=masterControlEnabled&&native?.computerUse!==false;
  if(computerUse===enabled)return;
  computerUse=enabled;render();
 }
 computerUseSwitch.addEventListener('change',async()=>{
  const requested=computerUseSwitch.checked;
  const change={computerUse:requested};
  if(requested&&!masterControlEnabled)change.enabled=true;
  computerUseStatus.textContent='';computerUseStatus.hidden=true;
  savingComputerUse=true;computerUseSwitch.disabled=true;
  try{
   const result=await window.assistant.control.configure(change);
   updateComputerUse(result.native,result.permissions);
  }catch(error){computerUseStatus.hidden=false;computerUseStatus.textContent='Could not update Computer Use. '+error.message;}
  finally{savingComputerUse=false;render();}
 });
 function all(){return [
  {id:'local-word',name:'Word (Desktop)',description:'Draft and format the Word document open on this PC, or insert pictures with text wrapping. Built into C.O.D.Y.',kind:'word',icon:'file-text',connected:false},
  {id:'computer-use',name:'Computer Use',description:'Let Cody use the mouse and keyboard in Windows apps.',kind:'computer-use',connected:computerUse===true},
  ...['plex','overseerr'].map(id=>({id:'media-'+id,service:id,name:id==='plex'?'Plex':'Overseerr',kind:'media',
    connected:mediaState.services?.[id]?.connected===true,
    description:id==='plex'?'Connect your Plex account to use your media server.':'Find movies and TV shows, request titles and check your Overseerr requests.'})),
  ...['Chrome','Edge'].map(name=>({id:'browser-'+name.toLowerCase(),name,description:'Connect '+name+' so Cody can work with its websites and tabs.',browser:name,connected:browserState.connectedBrowsers?.includes(name)===true,kind:'browser',status:'available'})),
  ...(catalog?.plugins||[]),...(catalog?.custom||[])
 ].sort((a,b)=>Number(b.connected)-Number(a.connected)||a.name.localeCompare(b.name));}
 function render(){
  $('plugins-signin').hidden=catalog?.signedIn!==false;
  const query=$('plugins-search').value.trim().toLocaleLowerCase(),items=all().filter(p=>(filter!=='connected'||p.connected)&&(!query||(p.name+' '+p.description).toLocaleLowerCase().includes(query)));
  const focused=document.activeElement;
  const restoreFocus=focused===computerUseSwitch||focused===overseerrTest||plexActions.contains(focused)||mediaPanels.some(panel=>panel.contains(focused));
  $('plugins-count').textContent=items.length+' '+(items.length===1?'plugin':'plugins');
  $('self-hosted-settings').append(...mediaPanels,plexActions,overseerrTest,overseerrStatus);
  list.replaceChildren();
  if(!items.length){list.append(element('p','setting-help',query?'No plugins match your search.':filter==='connected'?'No plugins connected yet.':'No plugins are available yet.'));return;}
  for(const plugin of items){
   if(plugin.connected)pending.delete(plugin.id);const working=busy.has(plugin.id),waiting=pending.has(plugin.id)||plugin.status==='AwaitingBrowser';
   const card=element('article','plugin-card');card.dataset.pluginId=plugin.id;const heading=element('div','plugin-card-heading'),fallback=element('span','plugin-logo-fallback',plugin.name.slice(0,1).toUpperCase());
   const bundledLogo=plugin.kind==='word'?'assets/task-apps/word.png':
    plugin.kind==='media'?'assets/media/'+plugin.service+'.svg':
    plugin.kind==='computer-use'?window.CODYIcons?.computerUseLogo:
    plugin.kind==='browser'?window.CODYIcons?.browserLogo(plugin.browser):null;
   const logo=bundledLogo||(typeof plugin.logo==='string'&&plugin.logo.startsWith('https://')?plugin.logo:null);
   if(plugin.kind==='browser')window.CODYIcons?.set(fallback,'globe');
   if(plugin.kind==='computer-use')window.CODYIcons?.set(fallback,'mouse-pointer-2');
   if(logo){
    const icon=element('img');icon.alt='';icon.width=32;icon.height=32;
    if(!bundledLogo)icon.loading='lazy';
    icon.addEventListener('error',()=>icon.replaceWith(fallback),{once:true});
    icon.src=logo;heading.append(icon);
   }else heading.append(fallback);
   const connectedLabel=plugin.service==='plex'&&mediaState.services.plex?.name?'Connected · '+mediaState.services.plex.name:'Connected';
   const label=plugin.kind==='computer-use'?(computerUse===null?'Loading…':plugin.connected?'On':'Off'):
    plugin.connected?connectedLabel:waiting?'Finish sign-in in your browser':plugin.kind==='word'?'Built-in plugin':plugin.kind==='custom'?'MCP plugin · '+plugin.status:plugin.status==='needs_reconnect'?'Needs reconnection':plugin.kind==='local'?'Local plugin':'Available';
   const title=element('div');title.append(element('h3','',plugin.name),element('small',plugin.connected?'plugin-connected':'',label));heading.append(title);card.append(heading,element('p','plugin-description',plugin.description));
   const actions=element('div','plugin-card-actions');
   const remove=(accountId)=>{confirmRemoval={id:plugin.id,accountId};render();};
   if(plugin.kind==='media'&&plugin.service!=='plex'){
    const panel=mediaPanels.find(item=>item.dataset.mediaPanel===plugin.service);
    const toggle=button(plugin.connected?'Manage':'Connect',()=>{
      panel.hidden=!panel.hidden;if(!panel.hidden)panel.querySelector('button,input')?.focus();
      toggle.setAttribute('aria-expanded',String(!panel.hidden));
    });
    if(plugin.connected)actions.append(overseerrTest);
    toggle.setAttribute('aria-expanded',String(!panel.hidden));actions.append(toggle);
   }else if(plugin.kind==='media'){
    // Reuse the real Plex controls; a second proxy sign-in button is confusing.
   }else if(plugin.kind==='computer-use'){
    computerUseSwitch.checked=plugin.connected;
    computerUseSwitch.disabled=savingComputerUse||computerUse===null;
    actions.append(computerUseLabel);
   }else if(plugin.kind==='word'){
    actions.append(button('Use in chat',()=>{window.CODYIsland?.setActiveView('chat');const composer=window.CODYInlineComposer;const offset=composer?.selectionOffsets()?.end??0;composer?.insertMention({id:'plugin:word',name:plugin.name,kind:'plugin',icon:'file-text'},offset,offset);document.getElementById('quick-input')?.focus();}));
   }else if(plugin.kind==='browser'){actions.append(button(plugin.connected?'Manage':'Install',()=>window.CODYBrowserSetup?.open(plugin.browser),browserState.busy===true));}else if(confirmRemoval?.id===plugin.id){
    card.append(element('p','plugin-removal-question',confirmRemoval.accountId?'Disconnect this account?':'Remove access for this plugin?'));
    actions.append(button('Remove access',()=>void act(plugin,'disconnect',confirmRemoval.accountId),working),button('Cancel',()=>{confirmRemoval=null;render();},working));
   }else if(plugin.connected){
    if(plugin.canAddAccount)actions.append(button('Add account',()=>void act(plugin,'connect'),working||waiting));
    if(plugin.kind==='local')actions.append(button('Change folder',()=>void act(plugin,'connect'),working));
    actions.append(button(plugin.kind==='custom'?'Remove':'Disconnect',()=>remove(),working));
   }else{
    if(plugin.kind!=='custom'||plugin.canConnect)actions.append(button(working?'Working…':waiting?'Waiting for sign-in…':plugin.kind==='local'?'Configure':plugin.status==='needs_reconnect'?'Reconnect':plugin.kind==='custom'?'Connect':'Install',()=>void act(plugin,'connect'),working||waiting));
    if(plugin.kind==='custom')actions.append(button('Remove',()=>remove(),working));
   }
   card.append(plugin.kind==='media'&&plugin.service==='plex'?plexActions:actions);
   if(plugin.kind==='computer-use')card.append(computerUseStatus);
   if(plugin.service==='overseerr')card.append(overseerrStatus);
   if(plugin.kind==='media')card.append(mediaPanels.find(item=>item.dataset.mediaPanel===plugin.service));
   if(plugin.accounts?.length){const details=document.createElement('details');details.className='plugin-accounts';details.append(element('summary','',plugin.accounts.length+' connected '+(plugin.accounts.length===1?'account':'accounts')));for(const account of plugin.accounts){const row=element('div','plugin-account-row');row.append(element('span','',account.name),button('Disconnect',()=>remove(account.id),working));details.append(row);}card.append(details);}
   list.append(card);
  }
  if(restoreFocus&&focused.isConnected&&focused!==document.activeElement)focused.focus({preventScroll:true});
 }
 async function refresh(){
  if(loading)return;loading=true;$('plugins-refresh').disabled=true;status.textContent=catalog?'Refreshing plugins…':'Loading plugins…';
  try{[catalog,browserState]=await Promise.all([api.list(),window.assistant.browserSetup.state()]);lastLoaded=Date.now();for(const [id,at]of pending)if(Date.now()-at>180000)pending.delete(id);render();status.textContent=catalog.message||'';}
  catch(error){if(!catalog)catalog={signedIn:false,plugins:[],custom:[]};render();status.textContent='Could not load plugins: '+error.message;}
  finally{loading=false;$('plugins-refresh').disabled=false;}
 }
 async function act(plugin,action,accountId){
  if(busy.has(plugin.id))return;busy.add(plugin.id);render();status.textContent=action==='connect'?'Connecting '+plugin.name+'…':'Removing access…';
  try{const result=await api.action({id:plugin.id,action,...(accountId?{accountId}:{})});confirmRemoval=null;if(result.awaiting)pending.set(plugin.id,Date.now());else pending.delete(plugin.id);await refresh();if(result.awaiting)status.textContent='Finish connecting '+plugin.name+' in your browser. This page will update when it is ready.';}
  catch(error){status.textContent=error.message;}
  finally{busy.delete(plugin.id);render();}
 }
 document.querySelector('[data-tab="integrations"]').addEventListener('click',()=>void refresh());
 $('plugins-refresh').addEventListener('click',()=>void refresh());$('plugins-search').addEventListener('input',render);
 const filters=[...document.querySelectorAll('[data-plugin-filter]')];
 function setFilter(value){filter=value;filters.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.pluginFilter===value)));render();}
 filters.forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.pluginFilter)));
 document.addEventListener('cody:plex-server-ready',()=>{$('plugins-search').value='';setFilter('all');});
 $('plugins-signin').addEventListener('click',()=>void window.assistant.webSignIn().then(()=>{status.textContent='Finish signing in to Claude Code in your browser, then refresh plugins.';}).catch(error=>status.textContent=error.message));
 $('plugins-add-form').addEventListener('submit',async event=>{
  event.preventDefault();const submit=$('plugins-add-submit');submit.disabled=true;
  try{await api.add({name:$('plugins-add-name').value,url:$('plugins-add-url').value,apiKey:$('plugins-add-key').value});$('plugins-add-form').reset();await refresh();status.textContent='MCP plugin added. Use Connect if the server needs browser sign-in.';}
  catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
 });
 const observe=new MutationObserver(()=>{if(visible()&&(!catalog||Date.now()-lastLoaded>30000))void refresh();});observe.observe(page,{attributes:true,attributeFilter:['hidden']});observe.observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('cody:browser-setup',event=>{browserState=event.detail||{offline:true};if(catalog)render();});
 document.addEventListener('cody:self-hosted',event=>{mediaState=event.detail;render();});
 window.assistant.on('settings-changed',settings=>updateComputerUse(settings.nativePermissions,settings.computerControl));
 void window.assistant.state().then(({settings})=>{
  if(computerUse===null)updateComputerUse(settings.nativePermissions,settings.computerControl);
 }).catch(error=>{status.textContent=error.message;});
 window.addEventListener('focus',()=>{if(visible())void refresh();});const timer=setInterval(()=>{if(visible()&&pending.size)void refresh();},3000);
 window.addEventListener('beforeunload',()=>{clearInterval(timer);observe.disconnect();$('plugins-add-key').value='';});
 window.CODYPlugins=Object.freeze({snapshot:()=>({loading,total:all().length,connected:all().filter(x=>x.connected).length,pending:pending.size})});
})();
