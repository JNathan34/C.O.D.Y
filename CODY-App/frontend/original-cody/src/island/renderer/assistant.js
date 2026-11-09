'use strict';
(async()=>{
  if(new URLSearchParams(location.search).has('demo')||!window.assistant)return;
  const api=window.assistant,visual=window.cody,island=window.CODYIsland;
  const $=id=>document.getElementById(id);
  const app={data:await api.state(),busy:false,mode:'heyclicky'};
  let preferences=await visual.getSettings(),voice,approval=null,wakeState={mode:'off'};
  const wakeListening=()=>['armed','hearing'].includes(wakeState.mode);
  const activity=[];
  let timer=app.data.timer||null;
  let game=app.data.rps||{active:false};
  let capture=app.data.capture||{status:'idle'},capturePending=false;
  let monitors=app.data.monitors||{active:false,items:[]};
  let tasks=app.data.tasks||{connected:false,tasks:[],activeCount:0};
  let quickCard=app.data.quickCard||null,media=app.data.spotify||{available:false};
  let artKey='',artCandidates=[],artIndex=0;
  const art=$('island-media-art');
  art.addEventListener('error',()=>{if(artIndex+1<artCandidates.length)art.src=artCandidates[++artIndex];});
  window.CODYIcons.set($('island-timer-icon'),'timer');
  window.CODYIcons.set($('island-media-previous'),'skip-back');window.CODYIcons.set($('island-media-next'),'skip-forward');
  function renderTimer(){
    const infoUpdate=$('island-info');
    infoUpdate.dataset.update='false';infoUpdate.removeAttribute('role');infoUpdate.removeAttribute('tabindex');infoUpdate.removeAttribute('aria-label');
    $('island-update-progress').hidden=true;
    if(wakeListening()&&!['starting','recording','paused','stopping'].includes(capture.status)){
      for(const name of ['task-layout','recording-layout','media-layout','weather-layout','timer-active','timer-finished'])document.body.classList.remove(name);
      document.body.classList.add('utility-layout','island-content-active');
      for(const id of ['island-timer','island-recording-dot','island-recording-controls','island-media-controls','island-rps-controls'])$(id).hidden=true;
      const info=$('island-info');info.hidden=false;info.dataset.tasks='false';info.dataset.rps='false';delete info.dataset.monitor;info.classList.remove('showing-media','showing-game');
      $('island-info-text').textContent='Listening…';$('island-info-detail').textContent='Speak your request';
      $('island-info-icon').hidden=false;window.CODYIcons.set($('island-info-icon'),'mic');art.hidden=true;
      return;
    }
    const activeTasks=tasks.connected?tasks.tasks.filter(task=>['Starting','Running','WaitingForUser'].includes(task.status)):[];
    if(activeTasks.length)island.wakeUp();
    island.setMediaPlaying(Boolean(media.available&&media.playing));
    const recording=['starting','recording','paused','stopping'].includes(capture.status);
    const quick=Boolean(!recording&&!game.active&&quickCard&&quickCard.expiresAt>Date.now()&&timer?.status!=='finished');
    const updateCard=window.CODYUpdateStatus?.card();
    const showUpdate=Boolean(updateCard&&!recording&&!game.active&&!quick&&timer?.status!=='finished');
    const showMonitors=monitors.active&&!recording&&!game.active&&!quick&&!showUpdate&&timer?.status!=='finished';
    const showGame=game.active&&!recording,showTimer=Boolean(timer)&&!showMonitors&&!quick&&!showGame&&!recording&&!showUpdate,showTasks=activeTasks.length>0&&!showUpdate&&!showMonitors&&!recording&&!showTimer&&!quick&&!showGame,showMedia=!showUpdate&&!showTasks&&!showMonitors&&!recording&&!showTimer&&!quick&&!showGame&&media.available&&Boolean(media.title);
    document.body.classList.toggle('task-layout',Boolean(showTasks));
    document.body.classList.toggle('recording-layout',recording);document.body.dataset.recording=capture.status;
    document.body.classList.toggle('media-layout',Boolean(showMedia));
    document.body.classList.toggle('weather-layout',Boolean(quick&&quickCard.kind==='weather'));
    document.body.classList.toggle('utility-layout',Boolean(showUpdate||showTasks||showMonitors||recording||showGame||(quick&&['time','date','utility'].includes(quickCard.kind))));
    const button=$('island-timer');button.hidden=!showTimer;document.body.classList.toggle('timer-active',showTimer);
    document.body.classList.toggle('island-content-active',Boolean(showUpdate||showTasks||showMonitors||recording||showTimer||quick||showMedia||showGame));
    const info=$('island-info');info.hidden=!showUpdate&&!showTasks&&!showMonitors&&!recording&&!quick&&!showMedia&&!showGame;info.dataset.tasks=String(Boolean(showTasks));info.dataset.rps=String(Boolean(showGame));info.classList.toggle('showing-media',Boolean(showMedia));
    if(!showMonitors)delete info.dataset.monitor;
    if(showMonitors&&monitors.items.length){
      const index=Math.floor(Date.now()/3000)%monitors.items.length,item=monitors.items[index];
      $('island-info-text').textContent=item.text;$('island-info-detail').textContent=item.detail;
      info.dataset.monitor=item.id;
      $('island-info-icon').hidden=false;window.CODYIcons.set($('island-info-icon'),item.icon||'activity');art.hidden=true;$('island-media-controls').hidden=true;$('island-rps-controls').hidden=true;
    }
    $('island-recording-dot').hidden=!recording;$('island-recording-controls').hidden=!recording;
    if(recording){
      const elapsed=Math.max(0,Math.floor((capture.elapsedMs+(capture.status==='recording'?Date.now()-capture.capturedAt:0))/1000));
      $('island-info-text').textContent=capture.status==='starting'?'Starting…':capture.status==='stopping'?'Saving…':Math.floor(elapsed/60).toString().padStart(2,'0')+':'+(elapsed%60).toString().padStart(2,'0');
      $('island-info-detail').textContent=capture.status==='paused'?'PAUSED':'REC';
      $('island-info-icon').hidden=true;art.hidden=true;$('island-media-controls').hidden=true;
      $('island-rps-controls').hidden=true;info.classList.remove('showing-game');
      const pause=$('island-recording-pause'),stop=$('island-recording-stop'),icon=capture.status==='paused'?'play':'pause';
      if(pause.dataset.icon!==icon)window.CODYIcons.set(pause,icon);if(stop.dataset.icon!=='square')window.CODYIcons.set(stop,'square');
      pause.setAttribute('aria-label',capture.status==='paused'?'Resume recording':'Pause recording');pause.setAttribute('aria-pressed',String(capture.status==='paused'));
      pause.disabled=stop.disabled=capturePending||!['recording','paused'].includes(capture.status);
    }
    if(showGame){
      const status=game.voice?.status;
      $('island-info-text').textContent=status==='countdown'?String(game.voice.countdown):status==='reveal'?'Say it now!':status==='listening'?'Listening…':status==='preparing'?'Getting ready…':status==='processing'?'Hearing you…':game.phase==='result'?({win:'You win!',lose:'C.O.D.Y. wins!',draw:'Draw!'})[game.outcome]:'Rock paper scissors';
      const hands={rock:'🪨',paper:'📃',scissors:'✂️'};
      $('island-info-detail').textContent=status==='countdown'?'Get ready':status==='reveal'?'C.O.D.Y.: '+hands[game.cody]:status==='listening'?'Say your move':game.phase==='result'?hands[game.you]+' vs '+hands[game.cody]+' · '+game.score.you+'–'+game.score.cody:'You '+game.score.you+' · C.O.D.Y. '+game.score.cody;
      $('island-info-icon').hidden=false;art.hidden=true;$('island-media-controls').hidden=true;window.CODYIcons.set($('island-info-icon'),'hand');
    }
    if(quick||showMedia){
      $('island-info-text').textContent=quick?quickCard.text:media.title;
      $('island-info-detail').textContent=quick?(quickCard.detail||''):`${media.playing?'':'Paused · '}${media.artist||media.app||'Media'}`;
      $('island-info-icon').hidden=Boolean(showMedia);art.hidden=!showMedia;
      if(quick)window.CODYIcons.set($('island-info-icon'),quickCard.icon||'calculator');
      else{const candidates=window.CODYMediaArt.candidates(media),key=JSON.stringify(candidates);if(key!==artKey){artKey=key;artCandidates=candidates;artIndex=0;art.src=candidates[0];}}
      $('island-media-controls').hidden=!showMedia;
      window.CODYIcons.set($('island-media-toggle'),media.playing?'pause':'play');
      $('island-media-toggle').setAttribute('aria-label',media.playing?'Pause media':'Resume media');
    }
    if(showTasks){
      const task=activeTasks.find(task=>task.status==='WaitingForUser')||activeTasks[Math.floor(Date.now()/5000)%activeTasks.length];
      $('island-info-text').textContent=task.status==='WaitingForUser'?'Needs you':activeTasks.length>1?`${activeTasks.length} tasks working`:task.title;
      $('island-info-detail').textContent=task.progress||(task.status==='Starting'?'Starting…':'Working in background');
      $('island-info-icon').hidden=false;window.CODYIcons.set($('island-info-icon'),'clock');art.hidden=true;$('island-media-controls').hidden=true;$('island-rps-controls').hidden=true;
    }
    if(showUpdate){
      info.dataset.update='true';info.dataset.tasks='false';info.dataset.rps='false';
      info.setAttribute('role','button');info.tabIndex=0;
      info.setAttribute('aria-label',(updateCard.tooltip||updateCard.text+' · '+updateCard.detail)+' · Open Settings → Updates');
      $('island-info-text').textContent=updateCard.text;$('island-info-detail').textContent=updateCard.detail;
      $('island-info-icon').hidden=false;window.CODYIcons.set($('island-info-icon'),updateCard.icon);
      art.hidden=true;$('island-media-controls').hidden=true;$('island-rps-controls').hidden=true;
      const progress=$('island-update-progress');progress.hidden=updateCard.progress===undefined;progress.value=updateCard.progress??0;
    }
    document.body.classList.toggle('timer-finished',timer?.status==='finished');
    if(!timer)return;
    const remaining=Math.max(0,Math.ceil((timer.deadline-Date.now())/1000));
    const hours=Math.floor(remaining/3600),minutes=Math.floor(remaining/60)%60,seconds=remaining%60;
    const label=(hours?hours+':':'')+String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0');
    $('island-timer-value').textContent=label;
    button.setAttribute('aria-label',timer.status==='finished'?'Timer finished. Dismiss timer.':`Timer: ${label} remaining. Open chat.`);
  }
  document.addEventListener('cody:update-state',renderTimer);
  api.on('rps-state',state=>{game=state;renderTimer();});
  api.on('capture-state',state=>{capture=state;renderTimer();});
  api.on('monitor-state',state=>{monitors=state;renderTimer();});
  api.on('timer-changed',value=>{timer=value;renderTimer();});
  api.on('island-card',value=>{quickCard=value;renderTimer();});
  api.on('spotify-changed',value=>{media=value;renderTimer();});
  document.addEventListener('cody:tasks-state',event=>{tasks=event.detail;renderTimer();});
  let mediaCommandPending=false;
  for(const [id,command] of [['island-media-previous','previous'],['island-media-toggle','toggle'],['island-media-next','next']])$(id).addEventListener('click',async event=>{
    event.stopPropagation();if(mediaCommandPending)return;mediaCommandPending=true;
    const buttons=[...$('island-media-controls').querySelectorAll('button')];buttons.forEach(button=>{button.disabled=true;});
    try{await api.control.execute('media.control',{command,source:media.source});}
    catch(error){quickCard={text:error.message,expiresAt:Date.now()+8000};renderTimer();}
    finally{mediaCommandPending=false;buttons.forEach(button=>{button.disabled=false;});}
  });
  for(const [id,action]of [['island-recording-pause',()=>capture.status==='paused'?'resume':'pause'],['island-recording-stop',()=> 'stop']])$(id).addEventListener('click',async event=>{
    event.stopPropagation();if(capturePending)return;capturePending=true;renderTimer();
    try{await api.capture.action(action());capture=await api.capture.state();}
    catch(error){note(error.message);}
    finally{capturePending=false;renderTimer();}
  });
  $('island-info').addEventListener('click',event=>{event.stopPropagation();if($('island-info').dataset.tasks==='true'){window.CODYTasks?.open();return;}if(quickCard?.captureKind&&!['starting','recording','paused','stopping'].includes(capture.status))void api.capture.reveal(quickCard.captureKind);});
  $('island-timer').addEventListener('click',event=>{event.stopPropagation();if(timer?.status==='finished')void api.dismissTimer();else{island.setActiveView('chat');island.togglePanel(true);}});
  renderTimer();setInterval(renderTimer,250);
  // The native picker can occupy transparent host space beyond the Island.
  let pickerTimer=null,pickerWasOpen=false;
  function syncPicker(){
    const open=Boolean(document.querySelector('select:open'));
    if(open!==pickerWasOpen){pickerWasOpen=open;visual.setPickerOpen(open);}
    if(open&&!pickerTimer)pickerTimer=setInterval(syncPicker,50);
    if(!open&&pickerTimer){clearInterval(pickerTimer);pickerTimer=null;}
  }
  function preparePicker(select){
    const rect=select.getBoundingClientRect(),surface=$('island').getBoundingClientRect();
    const below=Math.max(0,surface.bottom-14-rect.bottom-6),above=Math.max(0,rect.top-6-(surface.top+64));
    const up=below<Math.min(230,select.options.length*34+12)&&above>below;
    const width=Math.min(select.id==='core-control-level'?410:rect.width,surface.width-80),left=Math.max(surface.left+36,Math.min(rect.left,surface.right-36-width));
    for(const [name,value]of Object.entries({left:left+'px',width:width+'px',top:up?'auto':rect.bottom+6+'px',bottom:up?innerHeight-rect.top+6+'px':'auto',height:Math.max(48,Math.min(240,up?above:below))+'px'}))select.style.setProperty('--picker-'+name,value);
    select.dataset.pickerReady='true';
  }
  for(const event of ['pointerdown','keydown','change','focusout'])document.addEventListener(event,e=>{const select=e.target.closest?.('select');if(select&&!select.matches(':open'))preparePicker(select);setTimeout(syncPicker,0);},true);
  window.addEventListener('blur',()=>{pickerWasOpen=false;visual.setPickerOpen(false);if(pickerTimer){clearInterval(pickerTimer);pickerTimer=null;}});
  island.backendConnected=true;island.managedChat=true;
  const note=text=>{$('integration-note').textContent=String(text||'');};
  const current=()=>app.data.chats.find(chat=>chat.id===app.data.activeChatId);
  const displayText=text=>String(text||'').replace(/\r\n/g,'\n').replace(/\n{3,}/g,'\n\n');
  const selectedMode=mode=>{
    app.mode=['heyclicky','codex','chatgpt'].includes(mode)?mode:'heyclicky';
  };
  selectedMode(app.data.settings.assistantProvider||app.mode);window.addEventListener('cody-provider-changed',event=>selectedMode(event.detail));
  function renderHistory(){
    const list=$('history-list'),query=$('history-search').value.trim().toLowerCase();list.replaceChildren();
    for(const chat of [...app.data.chats].sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)))){
      if(chat.id!==app.data.activeChatId&&!chat.messages?.length)continue;
      if(query&&!String(chat.title||'New chat').toLowerCase().includes(query))continue;
      const button=document.createElement('button');button.type='button';button.className='history-chat';button.textContent=chat.title||'New chat';button.title=chat.title||'New chat';button.dataset.chatId=chat.id;button.disabled=app.busy;button.setAttribute('aria-current',chat.id===app.data.activeChatId?'page':'false');button.onclick=async()=>{try{await voice?.cancel();await api.selectChat(chat.id);}catch(error){note(error.message);}};list.append(button);
    }
    if(!list.children.length){const empty=document.createElement('p');empty.className='history-empty';empty.textContent=query?'No matching chats':'Your conversations will appear here.';list.append(empty);}
    $('history-new').disabled=app.busy;
  }
  function renderMessages(){
    $('chat-messages').replaceChildren();$('empty-state').hidden=Boolean(current()?.messages?.length);
    for(const message of current()?.messages||[]){
      const node=island.appendMessage(message.role,displayText(message.text)||'Thinking…');node.dataset.messageId=message.id;
      window.CODYAttachments?.decorateMessage(node,message);
    }
    renderHistory();
  }
  function updateMessage(chatId,messageId,text,delta=false){
    const log=$('conversation');
    // Measure before replacing the text: a new spoken line can grow by more
    // than the follow threshold in one update.
    const follow=log.scrollHeight-log.scrollTop-log.clientHeight<130;
    const message=app.data.chats.find(chat=>chat.id===chatId)?.messages.find(message=>message.id===messageId);
    if(message)message.text=delta?(message.text||'')+text:text;
    if(chatId!==app.data.activeChatId)return;
    const node=[...$('chat-messages').children].find(node=>node.dataset.messageId===messageId);
    if(node){island.renderMessage(node,displayText(message?.text||text)||'Thinking…',message?.role||'assistant');window.CODYAttachments?.decorateMessage(node,message||{});}
    if(follow)log.scrollTop=log.scrollHeight;
  }
  function busy(value){
    app.busy=Boolean(value);island.backendBusy=app.busy;
    $('quick-input').disabled=app.busy;$('new-chat').disabled=app.busy;
    $('core-history').disabled=app.busy;
    renderHistory();
    $('core-stop').hidden=!app.busy;$('panel-send').hidden=app.busy;island.updateInput();
  }
  function renderPermissions(){
    const permission=app.data.settings.computerControl||{};
    const native=app.data.settings.nativePermissions;
    $('core-control-enabled').checked=(native?.enabled??permission.enabled)===true;
    const full=['full','advanced'].includes(permission.level),custom=permission.level==='custom';
    $('core-custom-permissions').hidden=!custom;
    $('core-control-level').value=full?'full':permission.level==='standard'||permission.level==='off'?'approve-safe':permission.level||'approve-safe';
    $('core-access-description').textContent=custom?'Choose which permissions C.O.D.Y. can use below. Enabled native controls run without approval cards; disabled permissions are blocked.':full?'CODY control requests and local tools are approved automatically. Extra paid task usage has its own switch below.':permission.level==='ask'?'Ask before C.O.D.Y. actions and CODY computer control.':'Routine local commands run automatically. CODY asks before taking control of your computer.';
    $('core-folder').textContent=native?.workingFolder||app.data.settings.workingFolder||'Default CODY background task workspace';
    for(const input of document.querySelectorAll('[data-core-permission]')){input.checked=Boolean(permission[input.dataset.corePermission]);input.disabled=full;}
    for(const input of document.querySelectorAll('[data-native-permission]')){input.checked=Boolean(native?.[input.dataset.nativePermission]);input.disabled=!native;}
  }
  async function configureControl(change){
    $('core-permission-status').textContent='Saving backend permissions…';
    try{const result=await api.control.configure(change);app.data.settings.computerControl=result.permissions||result;if(result.native)app.data.settings.nativePermissions=result.native;renderPermissions();$('core-permission-status').textContent='Saved to C.O.D.Y. and CODY.';}
    catch(error){note(error.message);renderPermissions();$('core-permission-status').textContent=error.message;}
  }
  async function connection(){if(!$('chat-connection'))return;
    try{
      const status=await api.webStatus();
      $('chat-connection').textContent=status.signedIn?'ChatGPT connected':status.detail||'Sign in using Connect / repair.';
    }catch(error){$('chat-connection').textContent=error.message;}
  }
  async function firefox(){if(!$('core-firefox-status'))return;
    try{const status=await api.control.firefoxStatus();$('core-firefox-status').textContent=status.connected?'Firefox extension connected':status.error||'Extension not connected';}
    catch(error){$('core-firefox-status').textContent=error.message;}
  }
  let sendingMessage=false;
  async function send(options={}){
    if(sendingMessage)return;
    sendingMessage=true;
    try{return await sendRequest(options);}finally{sendingMessage=false;}
  }
  async function sendRequest({voice:voiceRequest=false,quickMessage}={}){
    if(app.busy)return;
    const text=(quickMessage??$('quick-input').value).trim();if(!text)return;
    await window.CODYAttachments?.ready();if(app.busy)return;
    voice?.stopSpeech(); // a new request owns a new utterance and visual timeline
    if(!app.data.activeChatId){
      const chat=await api.newChat();if(!app.data.chats.some(item=>item.id===chat.id))app.data.chats.unshift(chat);app.data.activeChatId=chat.id;
    }
    const result=await api.sendMessage({chatId:app.data.activeChatId,text,mode:app.mode,voice:voiceRequest});
    if(result?.error||result?.blocked){note(result.error||'Request blocked');return result;}
    if(!result?.cancelled&&quickMessage===undefined){$('quick-input').value='';island.updateInput();}
    return result;
  }
  island.onQuickMessage=async text=>{
    if(app.busy||sendingMessage){note('C.O.D.Y. is busy. Tap AltGr again when ready.');return;}
    try{await send({quickMessage:text});}catch(error){note(error.message);}
  };
  island.onPrompt=async text=>{
    $('quick-input').value=text;
    await send();
  };
  island.onNewChat=async()=>{
    try{await voice?.cancel();const chat=await api.newChat();app.data.activeChatId=chat.id;if(!app.data.chats.some(item=>item.id===chat.id))app.data.chats.unshift(chat);renderMessages();}
    catch(error){note(error.message);renderMessages();}
  };
  api.on('chats-changed',data=>{app.data=data;renderMessages();renderPermissions();});
  api.on('settings-changed',settings=>{app.data.settings=settings;selectedMode(settings.assistantProvider);renderPermissions();voice?.render();});
  api.on('message-added',({chatId,message})=>{
    const chat=app.data.chats.find(item=>item.id===chatId);
    if(chat&&!chat.messages.some(item=>item.id===message.id))chat.messages.push(message);
    if(chatId===app.data.activeChatId){const node=island.appendMessage(message.role,displayText(message.text)||'Thinking…');node.dataset.messageId=message.id;window.CODYAttachments?.decorateMessage(node,message);}
  });
  api.on('message-delta',({chatId,messageId,delta})=>updateMessage(chatId,messageId,delta,true));
  api.on('message-replace',({chatId,messageId,text})=>updateMessage(chatId,messageId,text));
  api.on('busy',({busy:value})=>busy(value));
  api.on('web-status',status=>{if(!$('chat-connection'))return;$('chat-connection').textContent=status.connected?'ChatGPT connected':status.detail||'Sign-in required';});
  api.on('firefox-status',status=>{if(!$('core-firefox-status'))return;$('core-firefox-status').textContent=status.connected?'Firefox extension connected':status.error||'Extension not connected';});
  api.on('activity',event=>{activity.push(event.text);if(activity.length>60)activity.shift();if($('core-activity'))$('core-activity').textContent=activity.join('\n');});
  api.on('diagnostic',text=>note(text));
  let approvalQueue=[],decidingApproval=false;
  function renderApproval(){
    const previous=approval;approval=approvalQueue[0]||null;
    const card=$('core-approval');card.hidden=!approval;card.dataset.approvalId=approval?.id||'';
    $('core-approval-deny').disabled=decidingApproval;$('core-approval-allow').disabled=decidingApproval;
    if(!approval)return;
    $('core-approval-reason').textContent=approval.reason||'Allow C.O.D.Y. to control your computer for this step?';
    $('core-approval-command').textContent=approval.command||approval.cwd||'';
    $('core-approval-count').textContent=approvalQueue.length>1?`${approvalQueue.length} requests waiting`:'';
    if(previous?.id!==approval.id||previous?.source!==approval.source){
      $('core-approval-error').textContent='';island.togglePanel(true);island.setActiveView('chat');$('core-approval-deny').focus();
    }
  }
  function nativeApprovals(requests){
    const ids=new Set(requests.map(request=>request.id));
    approvalQueue=approvalQueue.filter(request=>request.source!=='native'||ids.has(request.id));
    for(const request of requests){const existing=approvalQueue.find(item=>item.source==='native'&&item.id===request.id);if(existing)Object.assign(existing,request);else approvalQueue.push({...request,source:'native'});}
    renderApproval();
  }
  api.on('computer-approvals',nativeApprovals);
  api.on('approval',request=>{if(!approvalQueue.some(item=>item.source==='local'&&item.id===request.id))approvalQueue.push({...request,source:'local'});renderApproval();});
  api.on('approval-resolved',id=>{approvalQueue=approvalQueue.filter(item=>item.source!=='local'||item.id!==id);renderApproval();});
  void api.approvals.state().then(nativeApprovals).catch(error=>note(error.message));
  const decide=async decision=>{
    if(!approval||decidingApproval)return;const request=approval;decidingApproval=true;renderApproval();
    try{
      if(request.source==='native')await api.approvals.decide(request.id,decision);else await api.approve(request.id,decision);
      approvalQueue=approvalQueue.filter(item=>!(item.id===request.id&&item.source===request.source));
    }catch(error){$('core-approval-error').textContent=error.message;if(request.source==='native')void api.approvals.state().then(nativeApprovals).catch(()=>{});}
    finally{decidingApproval=false;renderApproval();}
  };
  document.addEventListener('keydown',event=>{
    if(!approval)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}
    if(event.key==='Tab'){const buttons=[$('core-approval-deny'),$('core-approval-allow')].filter(button=>!button.disabled);if(!buttons.length){event.preventDefault();return;}const current=buttons.indexOf(document.activeElement),next=event.shiftKey?(current<=0?buttons.length-1:current-1):(current+1)%buttons.length;event.preventDefault();buttons[next].focus();}
  },true);
  $('core-approval-deny').addEventListener('click',()=>void decide('decline'));
  $('core-approval-allow').addEventListener('click',()=>void decide('accept'));
  $('core-history').addEventListener('click',()=>{island.setActiveView('history');renderHistory();});
  const importSettings=$('settings-import'),exportSettings=$('settings-export'),backupStatus=$('settings-backup-status');
  async function runSettingsBackup(action){
    importSettings.disabled=exportSettings.disabled=true;
    backupStatus.hidden=true;
    backupStatus.textContent='';
    try{
      const result=await api.settingsBackup[action]();
      if(result.cancelled)return;
      if(result.imported)void voice.refresh().catch(error=>note(error.message));
      backupStatus.textContent=result.imported?'Settings imported.':'Settings exported.';
    }catch(error){
      const message=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');
      backupStatus.textContent=message;
    }finally{
      backupStatus.hidden=!backupStatus.textContent;
      importSettings.disabled=exportSettings.disabled=false;
    }
  }
  importSettings.addEventListener('click',()=>void runSettingsBackup('import'));
  exportSettings.addEventListener('click',()=>void runSettingsBackup('export'));
  $('history-search').addEventListener('input',renderHistory);
  $('history-new').addEventListener('click',()=>void island.onNewChat());
  $('history-close').addEventListener('click',()=>island.setActiveView('chat'));
  $('core-stop').addEventListener('click',async()=>{try{await voice.cancel();await api.stop();}catch(error){note(error.message);}});
  $('core-connect')?.addEventListener('click',async()=>{try{await api.webSignIn();await connection();}catch(error){note(error.message);}});
  $('core-check')?.addEventListener('click',()=>void connection());
  $('core-firefox-check')?.addEventListener('click',()=>void firefox());
  $('core-firefox-test')?.addEventListener('click',async()=>{try{const result=await api.control.firefoxTest();note(JSON.stringify(result));}catch(error){note(error.message);}});
  $('core-codex-connect')?.addEventListener('click',async()=>{try{await api.connect();$('core-codex-status').textContent='Your Codex account is connected';}catch(error){$('core-codex-status').textContent=error.message;}});
  $('core-codex-signin')?.addEventListener('click',async()=>{try{await api.signIn();}catch(error){note(error.message);}});
  $('core-control-enabled').addEventListener('change',event=>void configureControl({enabled:event.target.checked}));
  $('core-control-level').addEventListener('change',event=>void configureControl({level:event.target.value}));
  for(const input of document.querySelectorAll('[data-core-permission]'))input.addEventListener('change',()=>void configureControl({[input.dataset.corePermission]:input.checked}));
  for(const input of document.querySelectorAll('[data-native-permission]'))input.addEventListener('change',()=>void configureControl({[input.dataset.nativePermission]:input.checked}));
  void api.control.permissions().then(result=>{if(result.native)app.data.settings.nativePermissions=result.native;renderPermissions();$('core-permission-status').textContent='Permissions are connected to the CODY backend.';}).catch(error=>{$('core-permission-status').textContent=error.message;});
  $('core-folder-browse').addEventListener('click',async()=>{try{const folder=await api.browseFolder();if(folder){app.data.settings.workingFolder=folder;renderPermissions();}}catch(error){note(error.message);}});
  $('core-emergency').addEventListener('click',async()=>{try{await voice.cancel();await api.control.emergencyStop();}catch(error){note(error.message);}});
  const aliases={'voice-mic':'panel-mic','voice-speaker':'core-speaker',prompt:'quick-input','voice-choice':'voice-choices','voice-test':'preview-voice'};
  voice=window.CODYVoice.attach({
    api,$:id=>$(aliases[id]||id),toast:note,send,getApp:()=>app,preview:false,bindMicrophone:false,
    selectChatGPT:()=>selectedMode('chatgpt'),getVolume:()=>preferences.voiceVolume??1,getMicDeviceId:()=>preferences.micDeviceId||'',
    onBeforeCapture:()=>island.stopMicTest(),
    onReview:()=>{island.togglePanel(true);island.setActiveView('chat');$('quick-input').focus();},
    onAudio:audio=>audio instanceof HTMLMediaElement?island.connectSpeakingAudio(audio,{play:false}):undefined
  });
  island.onVoiceHotkey=action=>{if(action==='down'){if(!preferences.microphoneMuted)void voice.press();}else if(action==='up'){if(!preferences.microphoneMuted)void voice.release();}else if(['starting','listening'].includes(voice.getPhase()))void voice.cancel();};
  island.onStartListening=()=>voice.press();island.onStopListening=()=>voice.release();
  island.onToggleListening=()=>['starting','listening'].includes(voice.getPhase())?voice.release():voice.press();
  window.addEventListener('cody:voice-state',event=>{
    const phase=event.detail.phase;island.voiceCapturing=['starting','listening','transcribing','submitting'].includes(phase);
    island.setState(['transcribing','submitting','thinking'].includes(phase)?'thinking':phase==='listening'?'listening':phase==='speaking'?'speaking':wakeListening()?'listening':'idle');
    if(phase==='starting')island.resetExpression();
    $('mic-status').textContent=({starting:'Opening mic…',listening:'Listening…',transcribing:'Transcribing…',submitting:'Sending…',speaking:'Speaking…'})[phase]||'';
  });
  window.addEventListener('cody:audio-level',event=>island.setAudioLevel(Math.min(1,event.detail.level*9*(preferences.micSensitivity||1))));
  visual.onSettings(next=>{
    const speedChanged=next.voiceRate!==preferences.voiceRate;preferences=next;
    if(next.microphoneMuted&&['starting','listening'].includes(voice.getPhase()))void voice.cancel();
    if(speedChanged)void api.voice.configure({speed:next.voiceRate}).catch(error=>note(error.message));
  });
  busy(app.data.busy);renderMessages();renderPermissions();
  await voice.initialized;
  await api.voice.configure({speed:preferences.voiceRate});
  await Promise.all([app.mode==='chatgpt'?connection():Promise.resolve(),firefox()]);
  const renderWake=state=>{
    const wasListening=wakeListening();wakeState=state;
    const label=$('wake-word-status');if(label){label.textContent=state.message;label.dataset.mode=state.mode;}
    if(wakeListening()){island.wakeUp();island.setState('listening');}
    else if(wasListening){const phase=voice.getPhase();island.setState(phase==='speaking'?'speaking':['transcribing','submitting','thinking'].includes(phase)||app.busy?'thinking':phase==='listening'?'listening':'idle');}
    renderTimer();
  };
  api.on('wake-word-state',renderWake);api.wake?.status().then(renderWake).catch(()=>{});
  island.integrationReady=true;
})().catch(error=>{
  console.error('C.O.D.Y. Island integration:',error);
  const note=document.getElementById('integration-note');if(note)note.textContent='Could not initialize C.O.D.Y.: '+error.message;
});
