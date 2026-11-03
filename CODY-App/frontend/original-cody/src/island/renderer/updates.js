'use strict';
(()=>{
  const api=window.assistant?.updates,page=document.querySelector('[data-content="updates"]');if(!api||!page)return;
  const $=id=>document.getElementById(id);let state;
  function render(value){
    state=value;
    window.CODYUpdateStatus.set(value);
    document.dispatchEvent(new CustomEvent('cody:update-state'));
    $('settings-app-version').textContent='v'+value.currentVersion;
    $('update-version').textContent='Version '+value.currentVersion;
    $('update-automatic').checked=value.enabled;
    $('update-automatic').disabled=!value.supported;
    const text={idle:'Check for a new version of C.O.D.Y.',development:'Updates are available in the installed Windows app. This development copy stays separate.',checking:'Checking GitHub for updates…',available:'Version '+value.availableVersion+' is available.',current:'You’re up to date.',downloading:'Downloading update… '+Math.round(value.progress)+'%',ready:'Version '+value.availableVersion+' is ready to install.',installing:'Opening the installer…',error:value.error};
    $('update-status').textContent=text[value.status]||'';
    $('update-last-checked').textContent=value.lastChecked?'Last checked '+new Date(value.lastChecked).toLocaleString():'';
    $('update-check').disabled=!value.supported||['checking','downloading','ready','installing'].includes(value.status);
    $('update-download').hidden=value.status!=='available';
    $('update-install').hidden=value.status!=='ready';
    $('update-progress').hidden=value.status!=='downloading';$('update-progress').value=value.progress;
    const badge=document.getElementById('updates-badge');badge.hidden=!['available','ready'].includes(value.status);
  }
  async function run(action){try{const value=await action();if(value?.status)render(value);}catch(error){$('update-status').textContent=error.message;}}
  $('update-check').addEventListener('click',()=>void run(()=>api.check()));
  $('update-download').addEventListener('click',()=>void run(()=>api.download()));
  $('update-install').addEventListener('click',()=>void run(()=>api.install()));
  $('update-releases').addEventListener('click',()=>void run(()=>api.releases()));
  $('update-automatic').addEventListener('change',event=>void run(()=>api.configure(event.target.checked)));
  const info=$('island-info');
  function openUpdates(event){
    if(info.dataset.update!=='true')return;
    event.preventDefault();event.stopImmediatePropagation();
    window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView('settings');
    document.querySelector('[data-tab="updates"]').click();
    $(state.status==='ready'?'update-install':state.status==='available'?'update-download':'update-check').focus();
  }
  info.addEventListener('click',openUpdates,true);
  info.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))openUpdates(event);});
  window.assistant.on('updates-state',render);
  void run(()=>api.state());
})();
