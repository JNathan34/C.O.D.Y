'use strict';
(()=>{
  const api=window.assistant?.monitorAccess;
  if(!api)return;
  const $=id=>document.getElementById(`monitor-access${id?'-'+id:''}`);
  const form=$(''),main=$('main'),limit=$('limit'),list=$('list'),status=$('status'),save=$('save');
  let state,draft,busy=false,dirty=false;

  function useState(next){
    state=next;
    if(!dirty)draft={mainId:next.mainId||'',restricted:next.allowedIds!==null,allowed:new Set(next.allowedIds||[])};
    render();
  }

  function monitorLabel(monitor,index){
    const name=monitor.label===`Display ${index+1}`?monitor.label:`${index+1}. ${monitor.label}`;
    return `${name} · ${monitor.width} × ${monitor.height}${monitor.primary?' · Windows primary':` · (${monitor.x}, ${monitor.y})`}`;
  }

  function render(){
    const {displays}=state;
    const defaultOption=new Option('Windows primary display','');
    defaultOption.disabled=draft.restricted;
    const options=displays.map((monitor,index)=>{
      const option=new Option(monitorLabel(monitor,index),monitor.id);
      option.disabled=draft.restricted&&!monitor.identified;
      return option;
    });
    if(draft.mainId&&!displays.some(monitor=>monitor.id===draft.mainId)){
      const missing=new Option('Saved main monitor (disconnected)',draft.mainId);
      missing.disabled=true;options.push(missing);
    }
    main.replaceChildren(defaultOption,...options);main.value=draft.mainId;
    main.disabled=busy;limit.disabled=busy||(!draft.restricted&&!displays.some(monitor=>monitor.identified));
    limit.checked=draft.restricted;
    list.hidden=!draft.restricted;
    const focused=document.activeElement.dataset.monitorId;
    const checkboxes=displays.map((monitor,index)=>{
      const row=document.createElement('label');row.className='setting-row';
      const names=document.createElement('span');
      const title=document.createElement('strong');title.textContent=monitorLabel(monitor,index);names.append(title);
      const isMain=monitor.id===draft.mainId;
      if(isMain||!monitor.identified){
        const note=document.createElement('small');note.textContent=isMain?'Main monitor':"Windows couldn’t identify this monitor for restricted access.";names.append(note);
      }
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.monitorId=monitor.id;
      checkbox.checked=isMain||draft.allowed.has(monitor.id);checkbox.disabled=busy||isMain||!monitor.identified;
      checkbox.addEventListener('change',()=>{if(checkbox.checked)draft.allowed.add(monitor.id);else draft.allowed.delete(monitor.id);dirty=true;save.disabled=false;});
      row.append(names,checkbox);return row;
    });
    list.replaceChildren(...checkboxes);
    if(focused)checkboxes.find(row=>row.lastElementChild.dataset.monitorId===focused)?.lastElementChild.focus({preventScroll:true});
    save.disabled=busy||!dirty||(draft.restricted&&!displays.some(monitor=>monitor.id===draft.mainId&&monitor.identified));
  }

  main.addEventListener('change',()=>{draft.mainId=main.value;dirty=true;render();});
  limit.addEventListener('change',()=>{
    draft.restricted=limit.checked;
    if(draft.restricted&&!state.displays.some(monitor=>monitor.id===draft.mainId&&monitor.identified))
      draft.mainId=(state.displays.find(monitor=>monitor.primary&&monitor.identified)||state.displays.find(monitor=>monitor.identified))?.id||'';
    dirty=true;render();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(save.disabled)return;
    busy=true;render();status.textContent='Saving monitor access…';
    const allowedIds=draft.restricted?state.displays.filter(monitor=>monitor.identified&&(monitor.id===draft.mainId||draft.allowed.has(monitor.id))).map(monitor=>monitor.id):null;
    try{const saved=await api.configure({mainId:draft.mainId||null,allowedIds});dirty=false;useState(saved);status.textContent='Monitor access saved.';}
    catch(error){status.textContent=error.message;}
    finally{busy=false;render();}
  });
  async function load(){
    try{useState(await api.state());if(!busy)status.textContent='';}
    catch(error){status.textContent=error.message;}
  }
  document.addEventListener('cody:settings-tab-changed',event=>{if(event.detail==='permissions')void load();});
  window.assistant.on('monitor-access-changed',useState);
})();
