'use strict';
(()=>{
 const api=window.assistant,island=window.CODYIsland;if(!api?.tasks||!island)return;
 const $=id=>document.getElementById(id),active=new Set(['Starting','Running','WaitingForUser']);
 const labels={Starting:'Starting',Running:'Working on it',WaitingForUser:'Needs your input',Finished:'Completed',Failed:'Failed',Stopped:'Stopped'};
 let state={connected:false,tasks:[],activeCount:0},selected=null,detail=null,pendingId=null,generation=0,actionPending=false,detailOpen=false;
 const drafts=new Map(),previews=new Map(),loading=new Map(),visible=new Set(),dismissed=new Set();
 const list=$('tasks-list'),detailPanel=document.querySelector('.task-detail'),heading=document.querySelector('.tasks-heading');
 $('island').append(heading);
 const tools=document.createElement('div');tools.className='tasks-tools';tools.innerHTML='<span>Saved until you clear them</span><button type="button" class="task-secondary" id="tasks-clear-finished">Clear finished</button>';document.querySelector('.tasks-content').before(tools);
 const empty=document.createElement('div');empty.className='tasks-empty';empty.innerHTML='<span class="tasks-empty-symbol">✦</span><strong>A little help in the background</strong><p>Ask Cody to build, write, or research something.<br>Your work and finished results will appear here.</p>';list.after(empty);
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=entry.target.dataset.taskId;if(entry.isIntersecting){visible.add(id);void loadPreview(id);}else visible.delete(id);}},{root:list,rootMargin:'100px'});
 function select(id){if(selected)drafts.set(selected,$('task-message').value);selected=id;$('task-message').value=drafts.get(id)||'';detail=null;generation++;pendingId=null;}
 function open(){island.togglePanel(true);island.setActiveView('tasks');showGrid();void refresh();}
 function expand(value){document.body.classList.toggle('task-detail-open',value);api.tasks.expand?.(value);}
 function showGrid(){detailOpen=false;expand(false);tools.hidden=false;detailPanel.hidden=true;list.hidden=false;empty.hidden=state.tasks.some(task=>!dismissed.has(task.id));}
 function openDetail(id){closeMenus();select(id);detailOpen=true;expand(true);tools.hidden=true;list.hidden=true;empty.hidden=true;detailPanel.hidden=false;$('task-error').textContent='';render();void loadDetail();void loadPreview(id);}
 const selectedTask=()=>state.tasks.find(task=>task.id===selected);
 function type(task,preview){if(preview?.kind)return preview.kind;const text=(task.title+' '+(preview?.files||[]).join(' ')).toLowerCase();return /\b(website|webpage|web page|landing page)\b|\.html?\b/.test(text)?'website':/\b(images?|photos?|pictures?|logo|poster)\b|\.(png|jpe?g|webp)\b/.test(text)?'images':/\b(download|archive)\b/.test(text)?'download':'document';}
 function outputLabel(output){if(!output)return 'View task';if(output.kind==='website')return 'Open website';if(/\.docx?$/i.test(output.name))return 'Open document';if(/\.xlsx?$/i.test(output.name))return 'Open spreadsheet';return 'Open result';}
 function paintDetail(){
  const task=selectedTask(),running=task&&active.has(task.status),canAct=state.connected&&running&&!actionPending,preview=previews.get(selected)?.value;
  $('task-title').textContent=task?.title||'Background task';$('task-status').textContent=task?(state.connected?(task.statusLabel||labels[task.status]||task.status):'Offline'):'';$('task-status').dataset.status=task?.status||'';
  $('task-progress').textContent=detail?.progress||task?.progress||'';$('task-progress').hidden=!running;
  const question=detail?.question||(task?.requiresApproval?'This task is waiting for extra usage approval.':'');$('task-question').textContent=question;$('task-question').hidden=!question;
  const response=detail?.failure||detail?.response||detail?.summary||(running?'Cody is working. Updates will appear here.':detail?'No written summary was provided.':'Loading task details…');
  if($('task-response')._source!==response){window.CODYTaskFormat.render($('task-response'),response);$('task-response')._source=response;}
  $('task-open-chat').disabled=!task?.turn||actionPending;$('task-stop').hidden=!running;$('task-stop').disabled=!canAct;$('task-message-form').hidden=!running;$('task-message').disabled=$('task-message-send').disabled=!canAct||task?.requiresApproval;
  const primary=preview?.outputs?.[0];$('task-open-result').hidden=!primary;$('task-open-result').textContent=outputLabel(primary)+' ↗';$('task-open-result').disabled=actionPending;
  const outputs=$('task-outputs');outputs.replaceChildren();for(const output of preview?.outputs||[]){const button=document.createElement('button');button.type='button';button.className='task-output';const name=document.createElement('span'),hint=document.createElement('small');name.textContent=output.name;hint.textContent=output.kind==='website'?'Open in browser ↗':'Open in app ↗';button.append(name,hint);button.onclick=()=>void openResult(selected,output.id);outputs.append(button);}
 }
 function paintCover(row,task){
  const preview=previews.get(task.id)?.value,cover=row.querySelector('.task-preview'),kind=type(task,preview),icon=row.querySelector('.task-icon');row.dataset.kind=kind;const appearance=window.CODYTaskAppearance.describe(task,preview);row.dataset.app=appearance.app;row.style.setProperty('--task-accent',appearance.color);const appIcon=appearance.icon||preview?.appIcon;
  if(icon.dataset.source!==(appIcon||appearance.app)){icon.dataset.source=appIcon||appearance.app;icon.replaceChildren();if(appIcon){const image=document.createElement('img');image.src=appIcon;image.alt='';icon.append(image);}else{window.CODYIcons?.set(icon,kind==='website'?'globe':kind==='images'?'image':kind==='download'?'download':'file-text');}}
  row.querySelector('.task-result-action').textContent=outputLabel(preview?.outputs?.[0])+' ↗';
  const signature=JSON.stringify([task.status,task.preview,task.progress]);if(cover._previewValue===preview&&cover.dataset.signature===signature)return;cover._previewValue=preview;cover.dataset.signature=signature;cover.replaceChildren();
  if(preview?.websiteImage){cover.className='task-preview task-website-preview';const bar=document.createElement('span');bar.className='task-browser-bar';bar.innerHTML='<i></i><i></i><i></i>';const address=document.createElement('span');address.textContent=preview.outputs?.find(x=>x.kind==='website')?.name||'Website preview';bar.append(address);const img=document.createElement('img');img.addEventListener('load',()=>{if(img.naturalWidth&&img.naturalHeight)list.style.setProperty('--task-website-aspect',String(img.naturalWidth/img.naturalHeight));});img.src=preview.websiteImage;img.alt='Preview of '+task.title;cover.append(bar,img);}
  else if(preview?.images?.length){cover.className='task-preview task-gallery';for(const src of preview.images.slice(0,3)){const img=document.createElement('img');img.src=src;img.alt=task.title;cover.append(img);}}
  else if(preview?.documentText){cover.className='task-preview task-document-preview';const paper=document.createElement('span');paper.className='task-paper';for(const [index,line]of preview.documentText.split('\n').filter(Boolean).slice(0,6).entries()){const text=document.createElement(index?'span':'strong');text.textContent=line;paper.append(text);}cover.append(paper);}
  else{
   cover.className='task-preview task-output-preview'+(appearance.kind==='message'?' task-message-preview':'');
   const badge=document.createElement('span');badge.className='task-output-type';badge.textContent=appearance.label;
   const content=document.createElement('span');content.className='task-cover-content';
   const caption=document.createElement('span');caption.className='task-cover-caption';caption.textContent=window.CODYTaskFormat.summary(task.preview||task.progress)||(active.has(task.status)?'Cody is working on this…':task.status==='Stopped'?'This task was stopped. Open details to pick up where you left off.':'Open details to see what Cody worked on.');
   if(appearance.kind==='message'){const bubble=document.createElement('span');bubble.className='task-message-bubble';bubble.append(caption);content.append(bubble);}
   else{const name=preview?.outputs?.[0]?.name;if(name){const title=document.createElement('strong');title.textContent=name;content.append(title);}content.append(caption);}
   if(appIcon){const mark=document.createElement('img');mark.className='task-cover-mark';mark.src=appIcon;mark.alt='';cover.append(mark);}
   cover.append(badge,content);
  }
 }
 function createCard(task){
  const row=document.createElement('article');row.className='task-row';row.dataset.taskId=task.id;row.setAttribute('role','listitem');
  row.innerHTML='<header class="task-card-heading"><button class="task-open" type="button"><span class="task-icon" aria-hidden="true"></span><span class="task-card-title"><strong></strong><small></small></span></button><button class="task-more" type="button" aria-label="Task options" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button><button class="task-close" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button><div class="task-menu" hidden><button type="button" data-action="open">View task ↗</button><button type="button" data-action="details">Task details</button><button type="button" data-action="chat">Open chat</button></div></header><button class="task-preview" type="button"></button><div class="task-card-progress"><div class="task-track"><span></span></div><span class="task-progress-label"></span></div><footer class="task-card-footer"><button type="button" class="task-result-action">View task ↗</button><button type="button" class="task-details-action">Details</button></footer>';
  row.querySelector('.task-open').onclick=row.querySelector('.task-preview').onclick=row.querySelector('.task-result-action').onclick=row.querySelector('[data-action="open"]').onclick=()=>void viewTask(task.id);
  row.querySelector('.task-details-action').onclick=row.querySelector('[data-action="details"]').onclick=()=>openDetail(task.id);
  row.querySelector('.task-more').onclick=()=>{const menu=row.querySelector('.task-menu'),opening=menu.hidden;closeMenus();menu.hidden=!opening;row.querySelector('.task-more').setAttribute('aria-expanded',String(opening));};
  row.querySelector('.task-close').onclick=()=>{const current=state.tasks.find(item=>item.id===task.id);if(active.has(current?.status))void actFor(task.id,'stop');else{void clearTask(task.id);}};
  row.querySelector('[data-action="chat"]').onclick=()=>void openChat(task.id);observer.observe(row);return row;
 }
 function render(){
  const tasks=state.tasks.filter(task=>!dismissed.has(task.id));$('tasks-summary').textContent=!state.connected?'Offline':`${tasks.length} ${tasks.length===1?'task':'tasks'}`;
  $('tasks-clear-finished').disabled=actionPending||!state.connected||!tasks.some(task=>!active.has(task.status));
  const badge=$('task-count');badge.textContent=String(state.activeCount);badge.hidden=!state.activeCount;$('panel-tasks').setAttribute('aria-label',state.activeCount?`Background tasks, ${state.activeCount} active`:'Background tasks');
  if(!state.tasks.some(task=>task.id===selected)){select(state.tasks[0]?.id||null);if(detailOpen&&!selected)showGrid();}
  const existing=new Map([...list.children].map(node=>[node.dataset.taskId,node]));
  for(const [index,task]of tasks.entries()){
   const row=existing.get(task.id)||createCard(task);row.querySelector('.task-card-title strong').textContent=task.title;row.querySelector('.task-card-title small').textContent=state.connected?(task.statusLabel||labels[task.status]||task.status):'Offline';row.dataset.status=task.status;
   row.querySelector('.task-open').title=task.title;row.querySelector('.task-preview').setAttribute('aria-label',`Open result for ${task.title}`);
   const stop=row.querySelector('.task-close');stop.setAttribute('aria-label',`${active.has(task.status)?'Stop':'Clear'} ${task.title}`);stop.title=active.has(task.status)?'Stop task':'Clear task';stop.disabled=actionPending||!state.connected;row.querySelector('[data-action="chat"]').disabled=!task.turn;
   const track=row.querySelector('.task-track'),label=row.querySelector('.task-progress-label'),done=task.status==='Finished',total=task.stepsTotal||0,completed=task.stepsDone||0;
   row.querySelector('.task-card-progress').hidden=!active.has(task.status);track.classList.toggle('indeterminate',!total&&['Starting','Running'].includes(task.status));track.querySelector('span').style.width=total?`${Math.round(completed/total*100)}%`:'0%';label.textContent=total?`${completed} / ${total}`:task.status==='WaitingForUser'?'Needs you':active.has(task.status)?'Working…':labels[task.status];
   paintCover(row,task);if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);existing.delete(task.id);
  }
  for(const node of existing.values()){observer.unobserve(node);visible.delete(node.dataset.taskId);node.remove();}
  empty.hidden=detailOpen||tasks.length>0;paintDetail();document.dispatchEvent(new CustomEvent('cody:tasks-state',{detail:state}));
 }
 async function loadPreview(id,force=false){
  if(!api.tasks.preview||!state.connected)return null;if(!force&&(!document.body.classList.contains('tasks-open')||!document.body.classList.contains('panel-open')))return previews.get(id)?.value||null;if(loading.has(id))return loading.get(id);const cached=previews.get(id);if(!force&&Date.now()-(cached?.at||0)<20000)return cached.value;
  const operation=(async()=>{try{const value=await api.tasks.preview(id);previews.set(id,{value,at:Date.now()});if(previews.size>100)previews.delete(previews.keys().next().value);const row=[...list.children].find(node=>node.dataset.taskId===id),task=state.tasks.find(item=>item.id===id);if(row&&task)paintCover(row,task);if(selected===id)paintDetail();return value;}catch{return cached?.value||null;}finally{loading.delete(id);}})();loading.set(id,operation);return operation;
 }
 async function viewTask(id){closeMenus();const preview=await loadPreview(id);if(preview?.outputs?.length)await openResult(id,preview.outputs[0].id);else openDetail(id);}
 async function openResult(id,outputId){try{await api.tasks.open({id,outputId});}catch(error){openDetail(id);$('task-error').textContent=error.message;}}
 async function clearTask(id){try{await api.tasks.clear(id);await refresh();}catch(error){openDetail(id);$('task-error').textContent=error.message;}}
 $('tasks-clear-finished').onclick=async()=>{if(actionPending)return;actionPending=true;render();try{await api.tasks.clearFinished();await refresh();}catch(error){$('task-error').textContent=error.message;}finally{actionPending=false;render();}};
 async function loadDetail(){
  if(!detailOpen||!document.body.classList.contains('tasks-open')||!document.body.classList.contains('panel-open')||!state.connected||!selected||pendingId===selected)return;
  const id=selected,revision=++generation;pendingId=id;try{const result=await api.tasks.detail(id);if(revision!==generation||selected!==id)return;detail=result;paintDetail();}catch(error){if(revision===generation)$('task-error').textContent=error.message;}finally{if(revision===generation)pendingId=null;}
 }
 async function refresh(){try{state=await api.tasks.state();render();void loadDetail();}catch(error){state={...state,connected:false,activeCount:0};render();$('task-error').textContent=error.message;}}
 async function actFor(id,action,text){if(actionPending||!id||!state.connected)return;actionPending=true;render();$('task-error').textContent='';try{await api.tasks.action({id,action,...(text?{text}:{})});if(action==='message'){drafts.delete(id);if(selected===id)$('task-message').value='';}await refresh();}catch(error){openDetail(id);$('task-error').textContent=error.message;}finally{actionPending=false;render();}}
 async function openChat(id){try{const result=await api.tasks.chat(id);if(!result.available){openDetail(id);$('task-error').textContent='This task has no saved conversation. Its result is shown above.';return;}island.setActiveView('chat');}catch(error){openDetail(id);$('task-error').textContent=error.message;}}
 function closeMenus(){for(const menu of list.querySelectorAll('.task-menu')){menu.hidden=true;menu.parentElement.querySelector('.task-more').setAttribute('aria-expanded','false');}}
 $('task-back').onclick=showGrid;$('panel-tasks').addEventListener('click',()=>{if(document.body.classList.contains('tasks-open')&&document.body.classList.contains('panel-open'))island.setActiveView('chat');else open();});
 $('task-stop').onclick=()=>void actFor(selected,'stop');$('task-open-chat').onclick=()=>void openChat(selected);$('task-open-result').onclick=()=>void openResult(selected,previews.get(selected)?.value.outputs?.[0]?.id);
 $('task-message-form').addEventListener('submit',event=>{event.preventDefault();const text=$('task-message').value.trim();if(text)void actFor(selected,'message',text);});
 document.addEventListener('cody:view-changed',event=>{$('panel-tasks').setAttribute('aria-pressed',String(event.detail==='tasks'));if(event.detail==='tasks'){expand(detailOpen);void loadDetail();for(const id of visible)void loadPreview(id);}else expand(false);});
 document.addEventListener('click',event=>{if(!event.target.closest('.task-card-heading'))closeMenus();});
 api.on('tasks-changed',value=>{state=value;render();void loadDetail();});api.on('tasks-open',open);window.CODYTasks={open,snapshot:()=>state};
 setInterval(()=>{void loadDetail();if(document.body.classList.contains('tasks-open')&&document.body.classList.contains('panel-open'))for(const id of visible)if(loading.size<2)void loadPreview(id);},2500);showGrid();void refresh();
})();
