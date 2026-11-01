'use strict';
(()=>{
  const api=window.assistant;if(!api?.files)return;
  const list=document.getElementById('attachment-list'),hint=document.getElementById('file-drop-hint'),note=document.getElementById('integration-note');
  let currentChat=null,items=[],dragDepth=0,pending=Promise.resolve();
  function setState(state){
    if(currentChat===null)currentChat=state.chatId;if(state.chatId!==currentChat)return;
    items=state.items||[];list.replaceChildren();list.hidden=!items.length;
    for(const file of items){
      const chip=document.createElement('div');chip.className='attachment-chip';chip.classList.toggle('missing',Boolean(file.missing));chip.title=file.missing?file.name+' — file no longer available':file.name;
      if(file.preview){const image=document.createElement('img');image.src=file.preview;image.alt='';image.draggable=false;chip.append(image);}else{const icon=document.createElement('span');icon.className='attachment-type';icon.textContent=file.missing?'!':file.name.split('.').at(-1).slice(0,5).toUpperCase();chip.append(icon);}
      const name=document.createElement('span');name.className='attachment-name';name.textContent=file.name;chip.append(name);
      const remove=document.createElement('button');remove.type='button';remove.className='attachment-remove';remove.textContent='×';remove.title='Remove '+file.name;remove.setAttribute('aria-label',remove.title);
      remove.addEventListener('click',()=>void perform(()=>api.files.remove(file.id)));chip.append(remove);list.append(chip);
    }
    document.getElementById('quick-input').placeholder=items.length?'Ask about the attached '+(items.length===1?'file…':'files…'):'Message C.O.D.Y.';
    if(state.notice)note.textContent=state.notice;
  }
  function refresh(){return api.files.state().then(setState).catch(error=>{note.textContent=error.message;});}
  async function perform(action){
    const operation=pending.catch(()=>{}).then(async()=>{try{setState(await action());}catch(error){note.textContent=error.message;}});pending=operation;await operation;
  }
  function dragging(value){hint.hidden=!value;document.body.classList.toggle('file-dragging',value);void api.files.dragging(value).catch(()=>{});}
  const hasFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  document.addEventListener('dragenter',event=>{if(!hasFiles(event))return;event.preventDefault();dragDepth++;dragging(true);});
  document.addEventListener('dragover',event=>{if(!hasFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';if(hint.hidden)dragging(true);});
  document.addEventListener('dragleave',event=>{if(!hasFiles(event))return;if(--dragDepth<=0){dragDepth=0;dragging(false);}});
  document.addEventListener('drop',event=>{
    event.preventDefault();dragDepth=0;dragging(false);const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;
    void perform(async()=>{const state=await api.files.add(files);dragDepth=0;dragging(false);window.CODYIsland.togglePanel(true);window.CODYIsland.setActiveView('chat');document.getElementById('quick-input').focus();return state;});
  });
  document.getElementById('attach-files').addEventListener('click',()=>void perform(()=>api.files.pick()));
  api.on('attachments-state',setState);api.on('chats-changed',data=>{currentChat=data.activeChatId;void refresh();});
  function decorateMessage(node,message){
    if(!message.attachments?.length)return;
    const files=document.createElement('div');files.className='message-file-list';
    for(const file of message.attachments){const name=document.createElement('span');name.textContent=file.name;files.append(name);}node.append(files);
  }
  window.CODYAttachments={ready:()=>pending,refresh,decorateMessage,state:()=>({chatId:currentChat,items})};void refresh();
})();
