'use strict';
(()=>{
  const assistant=window.assistant,api=assistant?.rgb;
  if(!api)return;
  const enabled=document.getElementById('rgb-enabled'),discover=document.getElementById('rgb-discover');
  const list=document.getElementById('rgb-devices'),feedback=document.getElementById('rgb-status');
  let current,busy=false;
  function render(){
    if(!current)return;
    const locked=busy||current.busy;
    enabled.checked=current.enabled;
    enabled.disabled=locked||(!current.enabled&&!current.devices.some(device=>device.selected));
    discover.disabled=locked||current.enabled;
    const focus=list.contains(document.activeElement)?document.activeElement.dataset.device:null;
    list.replaceChildren(...current.devices.map(device=>{
      const row=document.createElement('label');row.className='setting-row';
      const name=document.createElement('span');name.textContent=device.name;
      if(!device.direct){const note=document.createElement('small');note.textContent='Select Direct mode in OpenRGB to use this device.';name.append(note);}
      const input=document.createElement('input');input.type='checkbox';input.checked=device.selected;
      input.dataset.device=device.id;input.disabled=locked||current.enabled||!device.direct;
      input.addEventListener('change',()=>void run(()=>api.select(device.id,input.checked)));
      row.append(name,input);return row;
    }));
    if(focus)list.querySelector(`input[data-device="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  async function run(action){
    if(busy)return;
    busy=true;render();
    try{current=await action();feedback.textContent=current.message;}
    catch(error){feedback.textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
    finally{busy=false;render();}
  }
  const panel=document.querySelector('[data-plugin-panel="rgb-lighting"]');
  panel.addEventListener('toggle',()=>{if(panel.open)void run(api.state);});
  assistant.on('rgb-lighting-changed',state=>{current=state;feedback.textContent=state.message;render();});
  discover.addEventListener('click',()=>void run(api.discover));
  enabled.addEventListener('change',()=>{const value=enabled.checked;void run(()=>api.enable(value));});
})();
