'use strict';
(() => {
  const memory=window.assistant?.localMemory;
  if(!memory)return;
  const byId=id=>document.getElementById(id);
  const toggle=byId('local-memory-only');
  const modeStatus=byId('memory-mode-status');
  const noteStatus=byId('local-memory-status');
  const editor=byId('memory-editor');
  const query=byId('local-memory-query');
  const list=byId('local-memory-notes');
  const saveForm=byId('memory-save-form');
  const searchForm=byId('memory-search-form');
  const errorText=error=>error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
  let modeBusy=false,notesBusy=false;

  function showMode({localOnly}){
    toggle.checked=localOnly;
    modeStatus.textContent=localOnly
      ? 'Claude through HeyClicky is paused. Your sign-in stays connected.'
      : 'Claude through HeyClicky can use the signed-in account’s memories.';
  }
  async function changeMode(configure){
    if(modeBusy)return;
    const enabled=toggle.checked;
    modeBusy=toggle.disabled=true;
    try{showMode(await (configure?memory.configure(enabled):memory.mode()));}
    catch(error){
      if(configure){
        toggle.checked=!enabled;
        try{showMode(await memory.mode());}catch{}
      }
      modeStatus.textContent=errorText(error);
    }finally{modeBusy=toggle.disabled=false;}
  }

  async function showNotes(){
    const notes=await memory.notes(query.value);
    list.replaceChildren();
    for(const note of notes){
      const row=document.createElement('div');
      row.className='setting-row';
      const text=document.createElement('span');
      text.textContent=note.text;
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='light-action';
      remove.textContent='Delete';
      remove.setAttribute('aria-label','Delete this memory');
      remove.addEventListener('click',()=>void updateNotes(async()=>{
        await memory.remove(note.id);
        return 'Memory deleted.';
      }));
      row.append(text,remove);
      list.append(row);
    }
    return notes.length;
  }

  async function updateNotes(change){
    if(notesBusy)return;
    notesBusy=true;
    const controls=[...saveForm.elements,...searchForm.elements];
    for(const control of controls)control.disabled=true;
    try{
      const message=await change?.();
      const count=await showNotes();
      noteStatus.textContent=message||(count?'':query.value.trim()?'No matching memories.':'No local memories yet.');
    }catch(error){noteStatus.textContent=errorText(error);}
    finally{
      for(const control of controls)control.disabled=false;
      notesBusy=false;
    }
  }

  toggle.addEventListener('change',()=>void changeMode(true));
  document.querySelector('[data-tab="memory"]').addEventListener('click',()=>{
    void changeMode(false);
    void updateNotes();
  });
  searchForm.addEventListener('submit',event=>{event.preventDefault();void updateNotes();});
  saveForm.addEventListener('submit',event=>{
    event.preventDefault();
    void updateNotes(async()=>{
      const {added}=await memory.save(editor.value);
      editor.value=query.value='';
      return added?'Memory saved on this PC.':'This memory is already saved on this PC.';
    });
  });
})();
