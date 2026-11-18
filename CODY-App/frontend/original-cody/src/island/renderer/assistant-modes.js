'use strict';
(()=>{
 const api=window.assistant?.modes;
 const select=document.getElementById('assistant-modes-select'),name=document.getElementById('assistant-mode-name');
 const save=document.getElementById('assistant-mode-save'),remove=document.getElementById('assistant-mode-remove');
 const status=document.getElementById('assistant-mode-status');
 if(!api||!select||!name||!save||!remove||!status)return;
 let current=null,busy=false;
 function paint(){
  if(!current)return;
  const previouslySelected=select.value;
  select.replaceChildren(...current.items.map(mode=>{
   const item=document.createElement('option');item.value=mode.id;item.textContent=mode.name;return item;
  }));
  select.value=current.active;
  remove.disabled=busy||!current.items.some(mode=>mode.id===select.value&&mode.custom);
  select.disabled=save.disabled=busy;
 }
 async function run(action,message){
  if(busy)return;
  busy=true;paint();
  try{const result=await action();if(result?.items)current=result;else current=await api.list();paint();status.textContent=result?.message||message||'';}
  catch(error){status.textContent='Could not change mode: '+error.message;}
  finally{busy=false;paint();}
 }
 async function refresh(){if(busy)return;try{current=await api.list();paint();}catch(error){status.textContent=error.message;}}
 select.addEventListener('change',()=>void run(()=>api.activate(select.value),'Mode changed.'));
 save.addEventListener('click',()=>{
  const value=name.value.trim();
  if(!value){status.textContent='Enter a mode name first.';return;}
  void run(()=>api.save(value),'Mode saved on this computer.');
 });
 remove.addEventListener('click',()=>void run(()=>api.remove(select.value),'Custom mode removed.'));
 document.querySelector('[data-tab="behaviour"]')?.addEventListener('click',()=>void refresh());
 void refresh();
})();