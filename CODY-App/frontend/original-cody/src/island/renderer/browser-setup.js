'use strict';
(()=>{
 const api=window.assistant?.browserSetup,island=window.CODYIsland;if(!api||!island)return;
 const card=document.createElement('section');card.id='browser-setup';card.className='core-approval';card.hidden=true;card.setAttribute('role','dialog');card.setAttribute('aria-labelledby','browser-setup-title');
 card.innerHTML='<header class="browser-setup-header"><div class="browser-setup-mark" aria-hidden="true"><img src="../../../assets/brand/cody-256.png" alt=""></div><h3 id="browser-setup-title">CODY’s browser extension</h3><button id="browser-setup-close" type="button" aria-label="Close browser setup">×</button></header><div class="browser-setup-body"><p id="browser-setup-description"></p><p id="browser-setup-help"></p><ol id="browser-setup-steps" hidden><li>Turn on <strong>Developer mode</strong>.</li><li>Choose <strong>Load unpacked</strong>.</li><li>Select the folder opened by <strong>Extension folder</strong>.</li></ol><p id="browser-setup-error" role="status"></p></div><div class="core-approval-actions"><button id="browser-setup-guide" class="light-action" type="button">Open extensions</button><button id="browser-setup-folder" class="light-action" type="button">Extension folder</button><button id="browser-setup-install" class="light-action" type="button">Install for me</button><button id="browser-setup-later" type="button">Not now</button></div>';

 document.getElementById('core-approval').after(card);
 const $=id=>document.getElementById(id);let state={offline:true},manual=false,hiddenTarget=null,submitting=false,selectedBrowser=null,browserGuide=false;
 function paint(){
  const connected=selectedBrowser?state.connectedBrowsers?.includes(selectedBrowser)===true:state.connected;
  const needed=state.pending&&!state.connected;
  card.hidden=!(manual||needed&&hiddenTarget!==state.targetId||state.busy);
  $('browser-setup-title').textContent='CODY’s '+(selectedBrowser||'browser')+' extension';
  $('browser-setup-description').textContent=state.offline?'CODY is reconnecting. Try again in a moment.':connected?(selectedBrowser||'Your browser')+' is connected. CODY can work with your websites.':state.busy?'Complete the steps in your browser to connect.':'Connect '+(selectedBrowser||'your browser')+' so CODY can help with websites and tabs.';
  $('browser-setup-help').textContent=connected||browserGuide||state.showingHow?'':state.fromStore?'Confirm the extension in your browser when asked.':'Open the extensions page, then use Extension folder to add CODY.';
  $('browser-setup-steps').hidden=Boolean(connected||state.fromStore||state.offline||!(browserGuide||state.showingHow));
  for(const id of ['install','guide','later'])$('browser-setup-'+id).disabled=submitting||Boolean(state.offline||(!selectedBrowser&&(state.connected||state.busy)));
  if(state.showingHow&&!selectedBrowser)$('browser-setup-later').disabled=submitting||Boolean(state.offline||state.connected);
  $('browser-setup-guide').textContent=selectedBrowser?'Open '+selectedBrowser:'Show me how';
  $('browser-setup-install').hidden=Boolean(selectedBrowser)||!state.canInstall;
  $('browser-setup-folder').hidden=Boolean(state.fromStore||connected);
  $('browser-setup-folder').disabled=submitting||Boolean(state.offline);
 }
 function update(value){const previous=state;state=value||{offline:true};document.dispatchEvent(new CustomEvent('cody:browser-setup',{detail:state}));if(state.pending&&state.targetId!==previous.targetId){if(!manual){selectedBrowser=null;browserGuide=false;}hiddenTarget=null;$('browser-setup-error').textContent='';if(!state.connected&&!state.busy){island.togglePanel(true);island.setActiveView('chat');}}paint();}
 async function refresh(){update(await api.state());}
 async function choose(choice){if(submitting)return;submitting=true;$('browser-setup-error').textContent='';paint();try{update(await api.choose({choice,targetId:state.targetId||'',...(selectedBrowser?{browser:selectedBrowser}:{})}));if(selectedBrowser&&choice==='show_me_how'){browserGuide=true;paint();}if(choice==='not_now'){manual=false;hiddenTarget=state.targetId;paint();}}catch(error){$('browser-setup-error').textContent=error.message;try{await refresh();}catch{}}finally{submitting=false;paint();}}
 $('browser-setup-install').onclick=()=>void choose('do_it_for_me');$('browser-setup-guide').onclick=()=>void choose('show_me_how');$('browser-setup-later').onclick=()=>void choose('not_now');
 $('browser-setup-folder').onclick=async()=>{try{await api.folder();}catch(error){$('browser-setup-error').textContent=error.message;}};
 $('browser-setup-close').onclick=()=>{manual=false;hiddenTarget=state.targetId;card.hidden=true;};
 const button=document.createElement('button');button.id='browser-setup-open';button.type='button';button.className='light-action';button.textContent='Set up';const anchor=$('plugins-browser-tools')||$('backend-native')?.closest('.setting-row');anchor?.append(button);
 button.onclick=async()=>{manual=true;try{await refresh();island.togglePanel(true);island.setActiveView('chat');}catch(error){paint();$('browser-setup-error').textContent=error.message;}};
 const pluginStatus=value=>{const label=$('plugins-browser-status');if(label)label.textContent=value?.connected?'Connected to CODY':value?.busy?'Setting up the browser extension…':'Install or connect CODY’s browser extension.';};window.assistant.on('browser-setup-open',value=>window.CODYBrowserSetup.open(value?.browser));window.assistant.on('browser-setup',value=>{update(value);pluginStatus(value);});void refresh().then(()=>pluginStatus(state)).catch(()=>{});
 window.CODYBrowserSetup={open:browser=>{selectedBrowser=['Chrome','Edge'].includes(browser)?browser:null;browserGuide=false;button.click();}};
})();
