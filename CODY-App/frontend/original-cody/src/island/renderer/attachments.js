'use strict';
(()=>{
  const api=window.assistant;if(!api?.files)return;
  const list=document.getElementById('attachment-list'),hint=document.getElementById('file-drop-hint'),note=document.getElementById('integration-note'),input=document.getElementById('quick-input');
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
    input.placeholder=items.length?'Ask about the attached '+(items.length===1?'file…':'files…'):'Message C.O.D.Y.';
    window.CODYIsland.updateInput();
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
  input.addEventListener('paste',event=>{
    const images=Array.from(event.clipboardData?.files||[]).filter(file=>file.type.startsWith('image/'));
    if(!images.length)return;
    event.preventDefault();
    const chatId=currentChat;
    for(const image of images){
      void perform(async()=>{
        if(image.size>25*1024*1024)throw Error('Paste an image up to 25 MB.');
        return api.files.paste(chatId,new Uint8Array(await image.arrayBuffer()));
      });
    }
  });
  api.on('attachments-state',setState);api.on('chats-changed',data=>{
    if(currentChat!==data.activeChatId){currentChat=data.activeChatId;items=[];list.replaceChildren();list.hidden=true;window.CODYIsland.updateInput();}
    void refresh();
  });
  const formatLabels={pdf:'PDF',doc:'Word document',docx:'Word document',docm:'Word document',ppt:'PowerPoint',pptx:'PowerPoint',xls:'Spreadsheet',xlsx:'Spreadsheet',csv:'CSV',tsv:'TSV',txt:'Text file',md:'Markdown',zip:'Archive'};
  const imageSource=value=>/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value||'')?value:null;
  const extension=name=>/\.([a-z0-9]{1,12})$/i.exec(name)?.[1].toLowerCase();
  const fileSize=bytes=>bytes>=1048576?+(bytes/1048576).toFixed(1)+' MB':bytes>=1024?Math.round(bytes/1024)+' KB':bytes+' B';
  let previewDialog;
  function showPreview(name,image,text,panel){
    if(!previewDialog){
      previewDialog=document.createElement('dialog');
      previewDialog.className='attachment-preview-dialog';
      previewDialog.setAttribute('aria-labelledby','attachment-preview-name');
      document.body.append(previewDialog);
      previewDialog.addEventListener('click',event=>{if(event.target===previewDialog)previewDialog.close();});
      previewDialog.addEventListener('close',()=>{if(!previewDialog.open)previewDialog.replaceChildren();});
    }
    const bounds=(panel||document.documentElement).getBoundingClientRect();
    previewDialog.style.setProperty('--preview-x',bounds.left+bounds.width/2+'px');
    previewDialog.style.setProperty('--preview-y',bounds.top+bounds.height/2+'px');
    previewDialog.style.setProperty('--preview-width',Math.max(160,bounds.width-24)+'px');
    previewDialog.style.setProperty('--preview-height',Math.max(120,bounds.height-20)+'px');
    const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
    title.id='attachment-preview-name';title.textContent=name;
    close.type='button';close.className='light-action';close.textContent='Close';close.onclick=()=>previewDialog.close();
    header.append(title,close);
    const content=document.createElement(image?'img':'pre');
    if(image){content.src=image;content.alt=name;}else content.textContent=text;
    previewDialog.replaceChildren(header,content);
    if(!previewDialog.open)previewDialog.showModal();
    close.focus();
  }
  function renderCard(slot,file,detail={}){
    const name=file.name||'Attachment',format=extension(name)||extension(file.path||'');
    const image=imageSource(detail.image)||imageSource(file.preview);
    const text=typeof detail.text==='string'?detail.text.trim():'';
    const card=document.createElement(image||text?'button':'div');
    card.className='message-attachment';
    card.title=name;
    if(image||text){
      card.type='button';
      card.setAttribute('aria-label','Preview '+name);
      card.addEventListener('click',()=>showPreview(name,image,text,slot.closest('.panel-view')));
    }
    if(image){
      card.classList.add('message-attachment-photo');
      const picture=document.createElement('img');
      picture.src=image;picture.alt=name;picture.draggable=false;
      card.append(picture);
    }else{
      const icon=document.createElement('span'),summary=document.createElement('span');
      icon.className='message-attachment-icon';icon.textContent=format?.slice(0,5).toUpperCase()||'FILE';
      icon.setAttribute('aria-hidden','true');
      summary.className='message-attachment-summary';
      const title=document.createElement('strong'),meta=document.createElement('span');
      title.textContent=name;
      meta.className='message-attachment-meta';
      const formatLabel=Object.hasOwn(formatLabels,format)?formatLabels[format]:format?.toUpperCase()||'File';
      meta.textContent=detail.missing?'File unavailable':[formatLabel,Number.isFinite(detail.size)?fileSize(detail.size):null].filter(Boolean).join(' · ');
      summary.append(title,meta);
      if(text){
        const excerpt=document.createElement('span');
        excerpt.className='message-attachment-excerpt';excerpt.textContent=text;
        summary.append(excerpt);
      }
      card.append(icon,summary);
    }
    const wasFocused=slot.contains(document.activeElement);
    slot.replaceChildren(card);
    if(wasFocused&&card.type==='button')card.focus({preventScroll:true});
  }
  const loaders=new WeakMap();
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      observer.unobserve(entry.target);
      loaders.get(entry.target)?.();
      loaders.delete(entry.target);
    }
  },{rootMargin:'120px'});
  function decorateMessage(node,message,chatId){
    if(!message.attachments?.length)return;
    const files=document.createElement('div');files.className='message-file-list';
    node.append(files);
    message.attachments.forEach((file,index)=>{
      const slot=document.createElement('div');slot.className='message-attachment-slot';files.append(slot);
      renderCard(slot,file);
      if(!chatId||!message.id||!api.files.preview)return;
      loaders.set(slot,async()=>{
        try{
          const detail=await api.files.preview(chatId,message.id,index);
          if(slot.isConnected)renderCard(slot,file,detail);
        }catch{/* The existing card still identifies the attachment. */}
      });
      observer.observe(slot);
    });
  }
  window.CODYAttachments={ready:()=>pending,refresh,decorateMessage,resetPreviews:()=>observer.disconnect(),state:()=>({chatId:currentChat,items})};void refresh();
})();
