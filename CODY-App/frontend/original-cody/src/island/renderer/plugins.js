'use strict';
(()=>{
 const api=window.assistant?.plugins,page=document.querySelector('[data-content="integrations"]');if(!api||!page)return;
 const $=id=>document.getElementById(id),list=$('plugins-list'),status=$('plugins-status'),pending=new Map(),busy=new Set();let browserState={offline:true},catalog=null,loading=false,filter='all',confirmRemoval=null,lastLoaded=0;
 const visible=()=>!page.hidden&&document.body.classList.contains('settings-open');
 const element=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const signin=element('button','light-action','Sign in');signin.id='plugins-signin';signin.hidden=true;status.after(signin);
 function button(text,action,disabled=false){const node=element('button','light-action',text);node.type='button';node.disabled=disabled;node.addEventListener('click',action);return node;}
 function all(){return [...['Chrome','Edge'].map(name=>({id:'browser-'+name.toLowerCase(),name,description:'Connect '+name+' so Cody can work with its websites and tabs.',browser:name,connected:browserState.connectedBrowsers?.includes(name)===true,kind:'browser',status:'available'})),...(catalog?.plugins||[]),...(catalog?.custom||[])].sort((a,b)=>Number(b.connected)-Number(a.connected)||a.name.localeCompare(b.name));}
 function render(){
  if(!catalog)return;
  $('plugins-signin').hidden=catalog.signedIn;
  const query=$('plugins-search').value.trim().toLocaleLowerCase(),items=all().filter(p=>(filter!=='connected'||p.connected)&&(!query||(p.name+' '+p.description).toLocaleLowerCase().includes(query)));
  $('plugins-count').textContent=items.length+' '+(items.length===1?'plugin':'plugins');list.replaceChildren();
  if(!items.length){list.append(element('p','setting-help',query?'No plugins match your search.':filter==='connected'?'No plugins connected yet.':'No plugins are available yet.'));return;}
  for(const plugin of items){
   if(plugin.connected)pending.delete(plugin.id);const working=busy.has(plugin.id),waiting=pending.has(plugin.id)||plugin.status==='AwaitingBrowser';
   const card=element('article','plugin-card');card.dataset.pluginId=plugin.id;const heading=element('div','plugin-card-heading'),fallback=element('span','plugin-logo-fallback',plugin.name.slice(0,1).toUpperCase());
   if(typeof plugin.logo==='string'&&plugin.logo.startsWith('https://')){const icon=document.createElement('img');icon.src=plugin.logo;icon.alt='';icon.loading='lazy';icon.width=32;icon.height=32;icon.addEventListener('error',()=>icon.replaceWith(fallback),{once:true});heading.append(icon);}else{if(plugin.kind==='browser')window.CODYIcons?.set(fallback,'globe');heading.append(fallback);}
   const title=element('div');title.append(element('h3','',plugin.name),element('small',plugin.connected?'plugin-connected':'',plugin.connected?'Connected':waiting?'Finish sign-in in your browser':plugin.kind==='custom'?'MCP plugin · '+plugin.status:plugin.status==='needs_reconnect'?'Needs reconnection':plugin.kind==='local'?'Local plugin':'Available'));heading.append(title);card.append(heading,element('p','plugin-description',plugin.description));
   const actions=element('div','plugin-card-actions');
   const remove=(accountId)=>{confirmRemoval={id:plugin.id,accountId};render();};
   if(plugin.kind==='browser'){actions.append(button(plugin.connected?'Manage':'Install',()=>window.CODYBrowserSetup?.open(plugin.browser),browserState.busy===true));}else if(confirmRemoval?.id===plugin.id){
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
   card.append(actions);
   if(plugin.accounts?.length){const details=document.createElement('details');details.className='plugin-accounts';details.append(element('summary','',plugin.accounts.length+' connected '+(plugin.accounts.length===1?'account':'accounts')));for(const account of plugin.accounts){const row=element('div','plugin-account-row');row.append(element('span','',account.name),button('Disconnect',()=>remove(account.id),working));details.append(row);}card.append(details);}
   list.append(card);
  }
 }
 async function refresh(){
  if(loading)return;loading=true;$('plugins-refresh').disabled=true;status.textContent=catalog?'Refreshing plugins…':'Loading plugins…';
  try{[catalog,browserState]=await Promise.all([api.list(),window.assistant.browserSetup.state()]);lastLoaded=Date.now();for(const [id,at]of pending)if(Date.now()-at>180000)pending.delete(id);render();status.textContent=catalog.message||'';}
  catch(error){status.textContent='Could not load plugins: '+error.message;}
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
 document.querySelectorAll('[data-plugin-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.pluginFilter;document.querySelectorAll('[data-plugin-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();}));
 $('plugins-signin').addEventListener('click',()=>void window.assistant.webSignIn().then(()=>{status.textContent='Finish signing in through your browser, then refresh plugins.';}).catch(error=>status.textContent=error.message));
 $('plugins-add-form').addEventListener('submit',async event=>{
  event.preventDefault();const submit=$('plugins-add-submit');submit.disabled=true;
  try{await api.add({name:$('plugins-add-name').value,url:$('plugins-add-url').value,apiKey:$('plugins-add-key').value});$('plugins-add-form').reset();await refresh();status.textContent='MCP plugin added. Use Connect if the server needs browser sign-in.';}
  catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
 });
 const observe=new MutationObserver(()=>{if(visible()&&(!catalog||Date.now()-lastLoaded>30000))void refresh();});observe.observe(page,{attributes:true,attributeFilter:['hidden']});observe.observe(document.body,{attributes:true,attributeFilter:['class']});
 document.addEventListener('cody:browser-setup',event=>{browserState=event.detail||{offline:true};if(catalog)render();});
 window.addEventListener('focus',()=>{if(visible())void refresh();});const timer=setInterval(()=>{if(visible()&&pending.size)void refresh();},3000);
 window.addEventListener('beforeunload',()=>{clearInterval(timer);observe.disconnect();$('plugins-add-key').value='';});
 window.CODYPlugins=Object.freeze({snapshot:()=>({loading,total:all().length,connected:all().filter(x=>x.connected).length,pending:pending.size})});
})();
