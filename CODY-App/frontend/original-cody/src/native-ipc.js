'use strict';
const {randomUUID}=require('node:crypto');
const {stripWakeText,isListeningCancellation}=require('./voice/keyword-wake-listener');
const {RpsVoice}=require('./rps-voice');
const {taskState}=require('./background-tasks');
const {selection,providerPatch}=require('./agent-provider');
const {setPersonalCodexEnabled}=require('./usage-policy');
const {localMemoryText,SHARED_PAUSED}=require('./memory/commands');
const {localMentions,localMentionRoute}=require('./mentions');
const {normalizeMentions}=require('./mentions-normalize');
const {normalizePluginCatalog,isReplacedWhatsAppPlugin}=require('./plugin-catalog');
const {WHATSAPP_DRAFTS_PLUGIN}=require('./integrations/whatsapp-drafts');
const {PLEX_PLUGIN_ID,hasRecentPlexRequest,hasPlexAvailabilityContext}=require('./media-commands');
const {RGB_PLUGIN_ID}=require('./rgb-commands');
const {WordSession}=require('./word-session');
const NATIVE_VOICES=Object.freeze(['cedar','marin','alloy','ash','ballad','coral','echo','sage','shimmer','verse']);
const {attachmentNames}=require('./attachments');
function installNativeIpc({ipcMain,engine,store,sendUI,submitExternal,cancelExternal=async()=>{},externalBusy=()=>false,connectProvider,codexUsage,getState,getWindow,utilities,rps,capture,attachments,chooseFiles,controller,chooseWorkingFolder,captureTextEnabled=()=>false,onTasks=()=>{},showFiles=()=>{},fileDragging=()=>{},showApprovals=()=>{},cancelLocalApprovals=()=>{},isMicrophoneMuted=()=>false,localMemoryOnly=()=>false,saveLocalMemory,onMemoryModeChange=()=>{}}){
  let active=null,changingMemoryMode=false;
  const wordSession=new WordSession({controller,engine,localMemoryOnly,
    canDraft:()=>selection(store.data.settings).provider==='heyclicky'});
  const turnChats=new Map(),reports=new Set();
  let tasks=taskState(null,false);
  function updateTasks(value,connected=true){tasks=taskState(value,connected);onTasks(tasks);sendUI('tasks-changed',tasks);return tasks;}
  engine.on('background-tasks',value=>updateTasks(value));
  engine.on('offline',()=>updateTasks(tasks,false));
  for(const chat of store.data?.chats||[])for(const turn of chat.nativeTurns||[])turnChats.set(turn,chat.id);
  function remember(operation){
    turnChats.set(operation.turn,operation.chatId);const chat=store.chat(operation.chatId);
    if(chat){chat.nativeTurns=[...(chat.nativeTurns||[]),operation.turn].slice(-128);store.save();}
    if(turnChats.size>4096)turnChats.delete(turnChats.keys().next().value);
  }
  const gameVoice=rps?new RpsVoice({engine,game:rps,isMicrophoneMuted}):null;
  const handle=(name,fn)=>{ipcMain.removeHandler(name);ipcMain.handle(name,(event,...args)=>{if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame)throw Error('Untrusted interface');return fn(...args);});};
  const rememberPermissions=value=>{if(store.data?.settings&&store.setNativePermissions){store.setNativePermissions(value);sendUI('settings-changed',store.data.settings);}return value;};
  engine.on('permissions-changed',rememberPermissions);
  handle('audio-output-devices',()=>engine.request('audio-output-devices'));
  handle('memory-mode-state',()=>({localOnly:localMemoryOnly()}));
  handle('memory-mode-configure',async localOnly=>{
    if(typeof localOnly!=='boolean')throw Error('Choose a memory mode.');
    if(changingMemoryMode||active||externalBusy())throw Error('Finish the current reply before changing memory mode.');
    changingMemoryMode=true;
    try{
      const previous=localMemoryOnly();
      const state=await engine.request('memory-mode-configure',{localOnly});
      if(state.localOnly!==previous)onMemoryModeChange(state.localOnly);
      return state;
    }
    finally{changingMemoryMode=false;}
  });
  handle('audio-output-select',deviceId=>{
    if(typeof deviceId!=='string'||deviceId.length>512)throw Error('Invalid output device.');
    return engine.request('audio-output-select',{deviceId});
  });
  handle('plugins-list',async()=>normalizePluginCatalog(await engine.request('plugins-list')));
  handle('mentions-list',async localOnly=>{
    const items=utilities?localMentions.filter(item=>
      (item.id!==WHATSAPP_DRAFTS_PLUGIN||utilities.whatsappDrafts)&&(item.id!==PLEX_PLUGIN_ID||utilities.selfHosted)&&
      (item.id!==RGB_PLUGIN_ID||utilities.rgbLighting?.pluginEnabled===true)):[];
    if(localOnly===true||localMemoryOnly()||selection(store.data.settings).provider!=='heyclicky')return {items:normalizeMentions([],items)};
    try{return {items:normalizeMentions(await engine.request('mentions-list'),items)};}
    catch{return {items:normalizeMentions([],items),error:'Could not load available mentions.'};}
  });
  handle('agents-state',()=>engine.request('agents-state'));
  handle('heyclicky-usage',()=>engine.request('heyclicky-usage'));
  handle('codex-usage',()=>codexUsage?codexUsage():{available:false,signedIn:false,error:'Codex usage is unavailable.'});
  handle('claude-account',async action=>{
    if(!['signIn','signOut'].includes(action))throw Error('Invalid Claude Code account action.');
    if(active||externalBusy()||tasks.activeCount||['Listening','Processing','Responding'].includes(engine.status?.state))throw Error('Finish or stop the current work before changing the Claude Code account.');
    const result=await engine.request(action);sendUI('auth-changed',{});return result;
  });
  handle('agent-provider-state',()=>selection(store.data.settings));
  handle('agent-provider-select',provider=>{
    if(active||externalBusy())throw Error('Finish or stop the current request before changing AI.');
    const patch=providerPatch(provider);store.settings(patch);setPersonalCodexEnabled(provider==='codex');
    sendUI('settings-changed',store.data.settings);return selection(store.data.settings);
  });
  handle('agent-provider-connect',async()=>{
    if(active||externalBusy())throw Error('Finish the current request first.');
    if(!connectProvider)throw Error('Connection setup is unavailable.');
    return connectProvider(selection(store.data.settings).provider);
  });
  handle('agents-configure',async change=>{
    if(!change||typeof change!=='object'||Array.isArray(change))throw Error('Invalid agent settings');
    const patch={};
    for(const key of Object.keys(change)){if(!['usageEnabled','extraUsage','voice','cursorUpdates','folder'].includes(key))throw Error('Unknown agent setting');if(key==='folder'){if(change[key]!==null)throw Error('Use the folder picker');}else if(typeof change[key]!=='boolean')throw Error('Invalid agent setting');patch[key]=change[key];}
    const state=await engine.request('agents-configure',patch);if('extraUsage' in patch||'folder' in patch)rememberPermissions(await engine.request('permissions-state'));return state;
  });
  handle('agents-folder',async()=>{const folder=await chooseWorkingFolder?.();if(!folder)return null;const state=await engine.request('agents-configure',{folder});rememberPermissions(await engine.request('permissions-state'));return state;});
  handle('agents-privacy',capability=>{if(!['broadFileSystemAccess','documentsLibrary','picturesLibrary','contacts','appointments','microphone','webcam','location'].includes(capability))throw Error('Unknown privacy setting');return engine.request('agents-privacy',{capability});});
  handle('plugins-action',async({id,action,accountId}={})=>{
    if(typeof id!=='string'||!id||id.length>200||!['connect','disconnect'].includes(action)||accountId!==undefined&&(typeof accountId!=='string'||accountId.length>300))throw Error('Invalid plugin action');
    if(isReplacedWhatsAppPlugin({id,kind:'cloud'}))throw Error('Use the WhatsApp plugin in Settings → Plugins.');
    return engine.request('plugins-action',{pluginId:id,action,accountId:accountId||''});
  });
  handle('plugins-add',async({name,url,apiKey}={})=>{
    if(typeof name!=='string'||!name.trim()||name.length>80||typeof url!=='string'||url.length>2048||apiKey!==undefined&&(typeof apiKey!=='string'||apiKey.length>8192||/[\r\n]/.test(apiKey)))throw Error('Invalid custom plugin');
    let server;try{server=new URL(url);}catch{throw Error('Enter a valid MCP server URL');}
    if(server.username||server.password||server.protocol!=='https:'&&!(server.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(server.hostname)))throw Error('Use HTTPS, or HTTP for localhost');
    return engine.request('plugins-add',{name:name.trim(),url:server.href,apiKey:apiKey||''});
  });
  if(controller){
    handle('computer-permissions',async()=>({...controller.permissions(),native:rememberPermissions(await engine.request('permissions-state'))}));
    handle('computer-configure',async change=>{
      if(!change||typeof change!=='object'||Array.isArray(change))throw Error('Invalid permissions');
      for(const key of ['enabled','readApps','extraUsage','computerUse','backgroundTasks'])if(key in change&&typeof change[key]!=='boolean')throw Error('Invalid permission value');
      if('level' in change&&!['ask','approve-safe','full','custom'].includes(change.level))throw Error('Invalid control level');
      const patch=Object.fromEntries(Object.entries(change).filter(([key])=>['enabled','level','readApps','extraUsage','computerUse','backgroundTasks'].includes(key)));
      const native=rememberPermissions(await engine.request('permissions-configure',patch));
      const localPatch=Object.fromEntries(Object.entries(change).filter(([key])=>!['readApps','extraUsage','computerUse','backgroundTasks'].includes(key)));
      if(!Object.keys(localPatch).length)return{permissions:controller.permissions(),native};
      const permissions=controller.configure(localPatch);
      if(!permissions.enabled){cancelLocalApprovals();utilities?.cancel();}
      sendUI('settings-changed',store.data.settings);return{permissions,native};
    });
    handle('computer-emergency-stop',async()=>{await engine.request('permissions-configure',{enabled:false});await engine.request('drive-stop');await cancel();controller.configure({enabled:false});sendUI('settings-changed',store.data.settings);return{stopped:true};});
    if(chooseWorkingFolder)handle('browse-folder',async()=>{const folder=await chooseWorkingFolder();if(!folder)return null;const native=await engine.request('permissions-configure',{workingFolder:folder});store.settings({workingFolder:folder});rememberPermissions(native);return folder;});
  }
  const sendMessage=(role,text,provider='heyclicky',{mediaLookup,draftId,plexAvailability=false}={})=>{
    const persist=!active.utility&&!(active.voice&&role==='user');
    const message=store.addMessage(active.chatId,role,text,provider,{persist,...(role==='user'&&active.mention?{mention:active.mention}:{})});
    if(role==='assistant'&&mediaLookup)message.mediaLookup=mediaLookup;
    if(role==='assistant'&&plexAvailability)message.plexAvailability=true;
    if(role==='assistant'&&draftId)message.whatsappDraftId=draftId;
    if(role==='user'&&active.files?.length){
      message.attachments=active.attachmentBatch?.items||attachmentNames(active.files);
      if(persist)store.save();
    }
    sendUI('message-added',{chatId:active.chatId,message});return message;
  };
  function replace(message,text){if(!active||!message)return;store.updateMessage(active.chatId,message.id,text,{persist:false});sendUI('message-replace',{chatId:active.chatId,messageId:message.id,text});}
  const quickUtilityActions=new Set(['weather','time','date','maths','timer','volume-status','audio.adjust','audio.set','audio.mute','spotify-status','spotify.control','media.control','app.open','island-monitors','app-settings.open','app-settings.change','rgb.open','rgb.color']);
  const usesUtilityCard=route=>quickUtilityActions.has(route?.action)||route?.action?.startsWith('system.')===true;
  function publishProgress(operation,text,phase){
    if(!operation.quietUtility&&(!operation.voice||operation.voiceClassified))sendUI('native-turn-status',{id:operation.turn,text,...(phase?{phase}:{})});
  }
  function finish(error){
    if(!active)return;
    const current=active,answered=Boolean(current.answer?.text);
    if(error){if(!current.answer)current.answer=sendMessage('assistant',error);else if(!current.answer.text)replace(current.answer,error);sendUI('diagnostic',error);}
    active=null;store.save();sendUI('busy',{busy:false});sendUI('chats-changed',store.publicState());
    sendUI('native-turn-status',{id:current.turn,finished:true,error:error||(!current.quietUtility?current.utilityError:undefined),cancelled:current.cancelled,answered:answered&&!current.quietUtility,detail:current.utility&&answered?current.answer.text:undefined});
  }
  async function runUtility(operation,text,speak,route){
    operation.utility=true;
    operation.quietUtility=usesUtilityCard(route);
    if(['whatsapp-draft','rgb.color'].includes(route?.action))operation.abort??=new AbortController();
    if(operation.voice&&route?.action==='text.proofread'&&!operation.proofreadTarget)throw Error('Click the text box, then hold your voice shortcut and say “spell check this”. The box must expose editable text.');
    if(operation.user?.attachments)delete operation.user.attachments;
    if(route?.command==='start'&&rps?.active){rps.close();await gameVoice.cancel();}
    const gameRequest=route?.action==='rps';
    const result=await utilities.run(text,operation.chatId,{proofreadTarget:operation.proofreadTarget,hasAttachments:Boolean(operation.files?.length),signal:operation.abort?.signal,route});
    if(active!==operation)return;
    operation.cancelled=Boolean(result.cancelled);
    operation.utilityError=result.error?result.reply:undefined;
    active.answer=sendMessage('assistant',result.reply,'heyclicky',{...result,plexAvailability:route?.action==='overseerr-availability'});
    finish();
    if(gameRequest&&rps?.active&&rps.phase==='ready'){void gameVoice.start();return result;}
    if(speak&&!localMemoryOnly()&&!result.error&&!result.cancelled)void engine.request('speak',{turn:operation.turn,text:result.confirmation||result.reply}).catch(error=>sendUI('diagnostic',error.message));
    return result;
  }
  function wordRoute(text,chatId,capabilityId,route,files,currentMessageId){
    if(wordSession.matches(text,chatId,capabilityId,route))return {retry:null};
    if(capabilityId||route||files?.length)return null;
    const retry=wordSession.followUp(text,store.chat(chatId)?.messages,currentMessageId);
    return retry?{retry}:null;
  }
  async function runWord(operation,text,{retry=null}={}){
    operation.word=true;operation.abort??=new AbortController();
    if(!operation.user)operation.user=sendMessage('user',text);
    sendUI('busy',{busy:true});publishProgress(operation,'Reading the Word document…');
    const result=await wordSession.run({chatId:operation.chatId,text,files:operation.files||[],signal:operation.abort.signal,
      wordSelected:operation.capabilityId==='plugin:word',retry,
      onProgress:message=>{if(active===operation)publishProgress(operation,message);}
    });
    if(active!==operation)return result;
    operation.cancelled=result.cancelled;
    operation.answer=sendMessage('assistant',result.reply);
    if(!result.question&&!result.cancelled&&operation.attachmentBatch?.ids.length)
      await attachments.clearSent(operation.chatId,operation.attachmentBatch.ids);
    if(active===operation)finish();
    return result;
  }
  engine.on('classify-utility',data=>{
    const operation=active?.voice&&active.turn===data.turn?active:null;
    const text=operation?.wake?stripWakeText(data.text):data.text;
    const route=operation&&!operation.files?.length?utilities?.match(text,{spoken:true,...operation.mediaContext}):null;
    const word=operation&&wordRoute(text,operation.chatId,'',route,operation.files,operation.user?.id);
    const handled=Boolean(operation&&(operation.files?.length||route||word||localMemoryText(text,localMemoryOnly())));
    if(operation&&!operation.voiceClassified){
      operation.quietUtility=usesUtilityCard(route);
      operation.voiceClassified=true;
      publishProgress(operation,'Working…');
    }
    void engine.request('utility-route',{turn:data.turn,handled}).catch(()=>{});
  });
  engine.on('phase',data=>{
    sendUI('native-phase',data);
    if(data.state!=='Idle')sendUI('busy',{busy:Boolean(active)&&data.state!=='Listening'});
    if(active?.turn===data.turn&&['Processing','Responding'].includes(data.state)){
      const replying=data.state==='Responding';
      publishProgress(active,replying?'Replying…':'Working…',replying?'speaking':undefined);
    }
  });
  engine.on('turn-progress',data=>{if(active?.turn===data.turn)publishProgress(active,data.label||'Working…');});
  engine.on('operation-cancelled',data=>{if(active?.turn===data.turn)active.cancelled=true;});
  engine.on('meter',data=>sendUI('native-meter',data));
  engine.on('transcript',data=>{
    if(!active||active.turn!==data.turn)return;
    const transcript=active.wake?stripWakeText(data.text):data.text;
    if(!transcript)return;
    const privateDraft=utilities?.match(transcript,{spoken:true})?.action==='whatsapp-draft';
    const text=privateDraft?'Private WhatsApp draft':localMemoryText(transcript,localMemoryOnly())?'Private memory request':transcript;
    if(!active.user)active.user=sendMessage('user',text);else replace(active.user,text);
  });
  engine.on('response',data=>{if(!active||active.turn!==data.turn)return;if(!active.answer)active.answer=sendMessage('assistant',data.text);else replace(active.answer,data.text);});
  engine.on('failure',data=>{finish(data.Message);sendUI('native-phase',{state:'Idle'});});
  engine.on('offline',()=>{
    // Local Word edits can finish without the engine. In-flight drafting
    // receives its own IPC rejection and reports it through runWord.
    if(!active?.word)finish('C.O.D.Y. disconnected. Send your request again to reconnect.');
    sendUI('native-phase',{state:'Idle'});
  });
  engine.on('diagnostic',text=>sendUI('diagnostic',text));
  engine.on('job-report',report=>{
    const chatId=turnChats.get(report.turn);if(!chatId||!store.chat(chatId)||typeof report.text!=='string'||!report.text.trim())return;
    if(store.chat(chatId).messages?.some(message=>message.nativeTaskId===report.taskId&&message.text===report.text))return;
    const key=report.taskId+':'+report.text;if(reports.has(key))return;reports.add(key);if(reports.size>128)reports.delete(reports.values().next().value);
    const message=store.addMessage(chatId,'assistant',report.text,'heyclicky');message.nativeTaskId=report.taskId;store.save();sendUI('message-added',{chatId,message});sendUI('chats-changed',store.publicState());
  });
  engine.on('computer-approvals',requests=>{sendUI('computer-approvals',requests);if(requests.length)showApprovals();});
  let browserTarget=null;
  engine.on('browser-setup',value=>{sendUI('browser-setup',value);if(value.pending&&!value.connected&&!value.busy&&value.targetId!==browserTarget)showApprovals();browserTarget=value.pending?value.targetId:null;});
  engine.on('offline',()=>{browserTarget=null;sendUI('browser-setup',{offline:true});});
  handle('browser-setup-state',()=>engine.request('browser-setup-state'));
  async function browserPreference(command,args){
    const state=await engine.request(command,args);
    if(!Array.isArray(state?.browsers))return state;
    const browsers=await Promise.all(state.browsers.map(async({id,name,executable})=>{
      if(executable){
        try{
          const image=await require('electron').app.getFileIcon(executable,{size:'normal'});
          if(!image.isEmpty())return {id,name,icon:image.toDataURL()};
        }catch{} // Browser discovery still works if the executable's icon cannot be read.
      }
      return {id,name};
    }));
    return {...state,browsers};
  }
  handle('browser-preference-state',()=>browserPreference('browser-preference-state'));
  handle('browser-preference-select',async browserId=>{
    if(typeof browserId!=='string'||!browserId||browserId.length>300)throw Error('Invalid browser selection.');
    return browserPreference('browser-preference-select',{browserId});
  });
  handle('browser-setup-choice',async({choice,targetId,browser}={})=>{
    if(browser!==undefined&&!['Chrome','Edge'].includes(browser))throw Error('Invalid browser setup choice');
    if(!['do_it_for_me','show_me_how','not_now'].includes(choice)||typeof targetId!=='string'||targetId.length>1000)throw Error('Invalid browser setup choice');
    const state=await engine.request('browser-setup-choice',{choice,targetId,...(browser?{browser}:{})});sendUI('browser-setup',state);return state;
  });
  handle('browser-setup-folder',()=>engine.request('browser-setup-folder'));
  engine.on('offline',()=>sendUI('computer-approvals',[]));
  handle('computer-approval-state',async()=>{const requests=await engine.request('approval-state');if(Array.isArray(requests))sendUI('computer-approvals',requests);return requests;});
  handle('tasks-state',async()=>updateTasks(await engine.request('tasks-state')));
  handle('task-clear',async id=>{if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid task');const result=await engine.request('task-clear',{taskId:id});await updateTasks(await engine.request('tasks-state'));return result;});
  handle('tasks-clear-finished',async()=>{const result=await engine.request('tasks-clear-finished');await updateTasks(await engine.request('tasks-state'));return result;});
  const preview=require('./task-previews').taskPreviews({engine,thumbnail:async file=>(await require('electron').nativeImage.createThumbnailFromPath(file,{width:560,height:300})).toDataURL(),websiteThumbnail:file=>require('./task-web-preview').websiteThumbnail(file,require('electron')),icon:async file=>(await require('electron').app.getFileIcon(file,{size:'large'})).toDataURL()});
  handle('task-preview',id=>preview(id));
  handle('task-open-output',({id,outputId}={})=>{if(typeof id!=='string'||!id||id.length>200||outputId!==undefined&&(typeof outputId!=='string'||outputId.length>80))throw Error('Invalid task output');return engine.request('task-open-output',{taskId:id,outputId:outputId||''});});
  handle('task-detail',id=>{if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid task');return engine.request('task-detail',{taskId:id});});
  handle('task-action',async({id,action,text}={})=>{if(typeof id!=='string'||!id||id.length>200||!['stop','message'].includes(action)||action==='message'&&(typeof text!=='string'||!text.trim()||text.length>12000))throw Error('Invalid task action');const result=await engine.request('task-action',{taskId:id,action,...(action==='message'?{text}: {})});await updateTasks(await engine.request('tasks-state'));return result;});
  handle('task-chat',async id=>{const task=tasks.tasks.find(task=>task.id===id),chatId=task&&turnChats.get(task.turn);if(!chatId||!store.chat(chatId))return {available:false};await cancel();await engine.request('fresh');store.select(chatId);sendUI('chats-changed',store.publicState());return {available:true,chatId};});
  handle('computer-approval-decision',async(id,decision)=>{
    if(typeof id!=='string'||id.length>100||!['accept','decline'].includes(decision))throw Error('Invalid permission decision');
    return engine.request('approval-decision',{approvalId:id,decision});
  });
  handle('attachments-state',()=>attachments&&store.chat?.(store.data.activeChatId)?attachments.snapshot(store.data.activeChatId):{chatId:store.data.activeChatId,items:[]});
  handle('attachments-preview',(chatId,messageId,index)=>{
    if(!attachments)throw Error('File attachments are unavailable.');
    return attachments.messagePreview(chatId,messageId,index);
  });
  handle('attachments-add',async paths=>{
    if(!attachments)throw Error('File attachments are unavailable.');
    if(!store.chat(store.data.activeChatId)){store.newChat();sendUI('chats-changed',store.publicState());}
    const result=await attachments.add(store.data.activeChatId,paths);showFiles();return result;
  });
  handle('attachments-paste',async(chatId,bytes)=>{
    if(!attachments)throw Error('Image attachments are unavailable.');
    const target=chatId||store.data.activeChatId;
    if(!target)throw Error('Select a conversation first.');
    return attachments.addImage(target,bytes);
  });
  handle('attachments-remove',id=>{if(!attachments)throw Error('File attachments are unavailable.');return attachments.remove(store.data.activeChatId,id);});
  handle('attachments-pick',async()=>{if(!attachments||!chooseFiles)throw Error('File picker is unavailable.');const paths=await chooseFiles();if(!store.chat(store.data.activeChatId)){if(!paths.length)return {chatId:null,items:[]};store.newChat();sendUI('chats-changed',store.publicState());}if(!paths.length)return attachments.snapshot(store.data.activeChatId);const result=await attachments.add(store.data.activeChatId,paths);showFiles();return result;});
  handle('attachments-drag',value=>{fileDragging(value===true);return true;});
  handle('rps-state',()=>rps?.snapshot()||{active:false});
  handle('capture-state',()=>capture?.snapshot()||{status:'idle'});
  handle('capture-action',async action=>{
    if(!capture||!['screenshot','start','pause','resume','stop'].includes(action))throw Error('Invalid screen capture action.');
    if(action==='start'&&rps?.active){rps.close();await gameVoice.cancel();}
    return capture.execute(action);
  });
  handle('capture-reveal',kind=>{if(!['screenshot','recording'].includes(kind))throw Error('Invalid capture type.');return capture?.reveal(kind)||false;});
  handle('rps-action',async value=>{
    if(active)throw Error('Finish the current request first.');
    if(!rps)throw Error('Game is unavailable.');
    await gameVoice.cancel();
    const previous=rps.snapshot();const state=rps.act(value);
    if(state.active&&state.phase==='ready'&&['start','again','voice'].includes(value.action)){void gameVoice.start();return state;}
    if(state.revision!==previous.revision&&state.phase==='result'&&store.data.settings.voiceAutoSpeak)void engine.request('speak',{turn:randomUUID(),text:rps.confirmation(state)}).catch(error=>sendUI('diagnostic',error.message));
    return state;
  });
  handle('state',()=>({...getState(),busy:Boolean(active||externalBusy()),nativeEngine:true,connected:engine.connected}));
  function mediaContext(chatId){
    const messages=store.chat(chatId)?.messages;
    return {plexContext:hasRecentPlexRequest(messages),availabilityContext:hasPlexAvailabilityContext(messages)};
  }
  const submit=async({chatId,text,voice=false,capabilityId='',mention=null})=>{
    if(active||externalBusy())return {error:'Another reply is in progress'};
    text=String(text||'').trim();if(text.length>25000)return {error:'Enter a message under 25,000 characters'};
    if(!store.chat(chatId))return {error:'Select a conversation'};
    if(typeof capabilityId!=='string'||capabilityId.length>300)return {error:'Invalid capability selection.'};
    if(/^(?:plugin|skill):/.test(capabilityId)&&isReplacedWhatsAppPlugin({id:capabilityId,kind:'plugin'}))
      return {error:'Choose the WhatsApp plugin to prepare a private draft.'};
     // This is display metadata only. Capability authorization and routing still
     // use the separately validated ID; a styled label cannot grant access.
     const validMention=capabilityId&&mention&&typeof mention==='object'&&!Array.isArray(mention)&&
       mention.id===capabilityId&&typeof mention.name==='string'&&mention.name.trim()&&mention.name.length<=80&&
       Number.isInteger(mention.offset)&&mention.offset>=0&&mention.offset<=text.length;
     const cleanMention=validMention?{id:capabilityId,name:mention.name.trim(),
       icon:typeof mention.icon==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(mention.icon)?mention.icon:'plug',
       offset:mention.offset,...(typeof mention.logo==='string'&&/^https:\/\/[^\s]{1,500}$/.test(mention.logo)?{logo:mention.logo}:{})}:null;
    if(gameVoice?.running)await gameVoice.cancel();
    if(changingMemoryMode)return {error:'Wait for C.O.D.Y. to finish changing memory mode.'};
    const note=capabilityId?null:localMemoryText(text,localMemoryOnly());
    if(note!==null){
      if(!saveLocalMemory)return {error:'Local memory is unavailable.'};
      const result=saveLocalMemory(note);
      for(const [role,message] of [['user','Private memory request'],['assistant',result.added?'Saved on this PC. Open Settings → Memory to view it.':'This memory is already saved on this PC.']])
        sendUI('message-added',{chatId,message:store.addMessage(chatId,role,message,'local')});
      return {local:true};
    }
    let batch;try{batch=attachments?await attachments.prepare(chatId):{paths:[],ids:[]};}catch(error){return {error:error.message};}
    const files=batch.paths;
    if(active||changingMemoryMode)return {error:'Another operation is in progress'};
    if(!text&&!files.length)return {error:'Enter a message or attach a file.'};
    const matchedRoute=utilities?.match(text,{capabilityId,...mediaContext(chatId)});
    const whatsappRoute=matchedRoute?.action==='whatsapp-draft'?matchedRoute:null;
    if(whatsappRoute&&capabilityId&&capabilityId!==WHATSAPP_DRAFTS_PLUGIN)return {error:'Clear the selected tool before preparing a private WhatsApp draft.'};
    const localRoute=whatsappRoute||(capabilityId||files.length?null:matchedRoute);
    const word=wordRoute(text,chatId,capabilityId,localRoute,files);
    if(word){
      const operation=active={turn:randomUUID(),chatId,word:true,abort:new AbortController(),files,attachmentBatch:batch,mention:cleanMention,capabilityId};
      void runWord(operation,text,word).catch(error=>{if(active===operation)finish(error.message);});
      return {started:true,local:true,word:true};
    }
    const selected=capabilityId?localMentionRoute(capabilityId,text,utilities):null;
    if(selected?.error)return selected;
    if(selected&&files.length)return {error:'Remove attached files before using this tool.'};
    const route=capabilityId?selected?.route:localRoute;
    if(route){
      active={turn:randomUUID(),chatId,utility:true,quietUtility:usesUtilityCard(route),mention:cleanMention,...(whatsappRoute?{files}:{})};
      active.user=sendMessage('user',whatsappRoute?'Private WhatsApp draft':text);sendUI('busy',{busy:true});
      publishProgress(active,'Working…');
      const operation=active;
      void runUtility(operation,text,voice||store.data.settings.voiceAutoSpeak,route).catch(error=>{if(active===operation)finish(error.message);});
      return {started:true,local:true,utility:true};
    }
    text ||= 'Please review the attached files.';
    const chosen=selection(store.data.settings);
    if(chosen.provider==='heyclicky'&&localMemoryOnly())return {error:SHARED_PAUSED};
    if(chosen.provider!=='heyclicky'){
      if(capabilityId)return {error:'This capability requires the native Claude Code connection.'};
      if(!submitExternal)return {error:'This AI connection is unavailable.'};
      return submitExternal({chatId,text,voice,mode:chosen.provider,...(files.length?{attachmentBatch:batch}:{})});
    }
    const status=await engine.refresh();
    if(changingMemoryMode||active)return {error:'Another operation is in progress'};
    if(localMemoryOnly())return {error:SHARED_PAUSED};
    if(!status.signedIn)return {error:'Sign in to the existing AI connection in Settings → Plugins.'};
    if(capabilityId){
      try{await engine.request('mentions-check',{capabilityId});}catch(error){return {error:error.message};}
      if(active||externalBusy()||changingMemoryMode||localMemoryOnly())return {error:'Another operation is in progress. Try again.'};
    }
    active={turn:randomUUID(),chatId,files,attachmentBatch:batch,mention:cleanMention};active.user=sendMessage('user',text);active.answer=sendMessage('assistant','');sendUI('busy',{busy:true});
    sendUI('native-turn-status',{id:active.turn,text:'Working…'});
    remember(active);
    const operation=active;
    void engine.request('submit',{turn:active.turn,text,speak:voice||store.data.settings.voiceAutoSpeak===true,...(files.length?{files}:{}),...(capabilityId?{capabilityId}:{})}).then(result=>{if(active!==operation)return;if(!active.answer?.text&&result.text)replace(active.answer,result.text);finish();if(!files.length&&!capabilityId)void utilities?.observe(text);}).catch(error=>{if(active===operation)finish(error.message);});
    if(batch.ids.length)await attachments.clearSent(chatId,batch.ids);
    return {started:true,provider:'heyclicky'};
  };
  handle('send-message',submit);
  const beginVoice=async({audioPrefix,wake=false,streamedAudio=false}={})=>{
    if(isMicrophoneMuted())throw Error('C.O.D.Y. microphone is muted. Press Ctrl + Alt + M to unmute.');
    if(externalBusy()&&!await cancelExternal())throw Error('Finish or stop the current reply first');
    if(changingMemoryMode)throw Error('Wait for C.O.D.Y. to finish changing memory mode.');
    if(gameVoice?.running)return {listening:!wake&&gameVoice.capture};
    if(active){const drive=await engine.request('drive-state');throw Error(drive.active?'Press Esc to stop computer use first.':'Finish the current reply first');}
    const operation=active={turn:randomUUID(),chatId:store.data.activeChatId,voice:true,wake,streamedAudio:wake&&streamedAudio,provider:selection(store.data.settings).provider};
    operation.mediaContext=mediaContext(operation.chatId);
    remember(operation);
    try{
      operation.attachmentBatch=attachments?await attachments.prepare(operation.chatId):{paths:[],ids:[]};
      operation.files=operation.attachmentBatch.paths;
      if(active!==operation||operation.wakeCancelled)return {listening:false};
      if(isMicrophoneMuted())throw Error('C.O.D.Y. microphone is muted. Press Ctrl + Alt + M to unmute.');
      const result=await engine.request('begin',{
        turn:operation.turn,...(wake?{wake:true}:{}),...(operation.streamedAudio?{streamedAudio:true}:{}),
        captureText:captureTextEnabled(),clientPid:process.pid,
        ...(operation.files.length||wake||localMemoryOnly()||operation.provider!=='heyclicky'?{utilityOnly:true}:{}),
        ...(audioPrefix?{audioPrefix}:{})
      });
      if(active!==operation||operation.wakeCancelled)return {listening:false};
      operation.proofreadTarget=result.textTarget;
      return result;
    }catch(error){if(active===operation&&!operation.wakeCancelled)finish(error.message);throw error;}
  };
  const forwardWakeAudio=async pcm=>{
    if(!active?.streamedAudio||active.wakeCancelled||isMicrophoneMuted())return {accepted:false};
    return engine.request('wake-audio',{turn:active.turn,pcm});
  };
  handle('native-begin',()=>beginVoice());
  const endVoice=async()=>{
    if(isMicrophoneMuted())return {listening:false,muted:true};
    if(gameVoice?.running){await gameVoice.finishListening();return {game:true};}if(!active)return {listening:false};const operation=active;
    try{
      const result=await engine.request('end');if(active!==operation)return result;
      if(operation.wake){result.utilityText=stripWakeText(result.utilityText||result.transcript||'');if(!result.utilityText||isListeningCancellation(result.utilityText)){finish();return {...result,empty:!result.utilityText,cancelled:Boolean(result.utilityText)};}}
      const matchedRoute=result.utilityText?utilities?.match(result.utilityText,{spoken:true,...operation.mediaContext}):null;
      const route=operation.files?.length&&!['text.proofread','whatsapp-draft'].includes(matchedRoute?.action)?null:matchedRoute;
      const word=result.utilityText&&wordRoute(result.utilityText,operation.chatId,'',route,operation.files,operation.user?.id);
      if(result.controlStopped){operation.cancelled=true;if(!operation.user&&result.transcript)operation.user=sendMessage('user',result.transcript);operation.answer=sendMessage('assistant','Stopped.');finish();}
      else if(word){
        await runWord(operation,result.utilityText,word);
      }
      else if(localMemoryText(result.utilityText,localMemoryOnly())){
        if(operation.user)replace(operation.user,'Private memory request');
        else operation.user=sendMessage('user','Private memory request','local');
        operation.answer=sendMessage('assistant','Type this memory or add it in Settings → Memory.','local');finish();
      }
      else if(result.utilityText&&localMemoryOnly()&&operation.provider==='heyclicky'&&!route){
        if(!operation.user)operation.user=sendMessage('user',result.utilityText);
        operation.answer=sendMessage('assistant',SHARED_PAUSED,'local');finish();
      }
      else if(operation.provider!=='heyclicky'&&result.utilityText&&!route){
        const text=result.utilityText;
        const chat=store.chat(operation.chatId);
        if(operation.user&&chat){chat.messages=chat.messages.filter(m=>m.id!==operation.user.id);store.save();}
        finish();sendUI('chats-changed',store.publicState());
        if(isListeningCancellation(text))return {...result,cancelled:true};
        const sent=await submit({chatId:operation.chatId,text,voice:true});
        if(sent?.error)throw Error(sent.error);
      }
      else if(result.utilityText&&(operation.files?.length||operation.wake)&&!route){
        if(!operation.user)operation.user=sendMessage('user',result.utilityText);operation.answer=sendMessage('assistant','');sendUI('busy',{busy:true});
        const [answer]=await Promise.all([engine.request('submit',{turn:operation.turn,text:result.utilityText,speak:true,files:operation.files}),operation.attachmentBatch?.ids.length?attachments.clearSent(operation.chatId,operation.attachmentBatch.ids):Promise.resolve()]);
        if(active===operation){if(!operation.answer.text&&answer.text)replace(operation.answer,answer.text);finish();}
      }else if(result.utilityText){
        if(route?.action==='whatsapp-draft'){
          if(operation.user)replace(operation.user,'Private WhatsApp draft');
          else operation.user=sendMessage('user','Private WhatsApp draft','local');
        }
        await runUtility(operation,result.utilityText,true,route);
      }else{
        // Reconcile the final text before releasing the turn if a streaming
        // update was missed. No answer means the session may still contain a
        // previous turn's text (for example after a silent microphone tap).
        if(operation.answer&&typeof result.text==='string'&&result.text.trim()){
          if(operation.answer.text!==result.text)replace(operation.answer,result.text);
        }
        const spoken=active?.user?.text;finish();if(spoken)void utilities?.observe(spoken);
      }
      return result;
    }catch(error){if(active===operation)finish(error.message);throw error;}
  };
  handle('native-end',endVoice);
  handle('native-stop-speech',async()=>{if(engine.status.state==='Responding')await engine.request('cancel');return true;});
  const cancel=async()=>{
    if(active?.word){
      active.abort.abort();
      cancelLocalApprovals();
      if(engine.connected)void engine.request('cancel').catch(()=>{});
      return true;
    }
    if(active){active.cancelled=engine.status?.state!=='Listening';active.abort?.abort();}
    await cancelExternal();cancelLocalApprovals();utilities?.cancel();await gameVoice?.cancel();await engine.request('cancel');finish();return true;
  };
  handle('stop-turn',cancel);handle('voice-cancel',cancel);
  handle('new-chat',async()=>{rps?.close();await cancel();await engine.request('fresh');const chat=store.newChat();sendUI('chats-changed',store.publicState());return chat;});
  handle('select-chat',async id=>{rps?.close();await cancel();await engine.request('fresh');store.select(id);sendUI('chats-changed',store.publicState());return store.chat(id);});
  const backend=async()=>{const status=await engine.refresh();return {defaultProvider:selection(store.data.settings).provider,autoAvailable:false,voiceProvider:'CODY native voice and microphone',toolsProvider:'CODY native drawing, 3D and agent tools',heyclicky:{connected:true,reason:status.signedIn?'C.O.D.Y.’s built-in engine is connected.': 'Built-in engine ready. Sign in to your CODY account.',installation:{detected:true,bundled:true,version:'1.1.3',architecture:'x64'}}};};
  handle('backend-status',backend);handle('backend-refresh',backend);
  handle('voice-status',async()=>({...(await engine.refresh()),available:true,engine:'heyclicky',recognition:'heyclicky',language:engine.status.recognitionLanguage||'en',recognitionModel:'CODY native speech recognition',output:{available:true}}));
  handle('voice-voices',()=>({voices:NATIVE_VOICES.map(id=>({id,name:id[0].toUpperCase()+id.slice(1),playable:true})),hint:'CODY native voice'}));
  handle('voice-configure',settings=>engine.request('configure',{...(settings.speed!==undefined?{speed:settings.speed}:{}),...(settings.voice?{voice:settings.voice}:{}),...(settings.recognitionLanguage?{recognitionLanguage:settings.recognitionLanguage}:{})}));
  handle('native-preview',async()=>{if(active)throw Error('Finish the current turn first');await engine.request('submit',{text:'Say hello in one short sentence.',speak:true});return {played:true};});
  for(const name of ['visuals-clear','visuals-clear-all','annotations-clear'])handle(name,()=>engine.request('clear'));
  // Demo IPC stays owned by the fixed local renderers in main.js. Never turn a
  // settings preview into a billable native AI request.
  handle('web-status',async()=>{const status=await engine.refresh();return {signedIn:status.signedIn,detail:status.signedIn?'CODY connected':'CODY sign-in required'};});
  handle('web-sign-in',()=>engine.request('signIn'));
  const muteVoice=async()=>{if(gameVoice?.running)await gameVoice.cancel();if(active?.voice&&engine.status?.state==='Listening'){await engine.request('cancel');finish();}};
  const cancelWakeVoice=()=>{
    if(!active?.wake)return Promise.resolve(false);
    active.wakeCancelled=true;
    return cancel();
  };
  return {cancel,gameVoice,submit,beginVoice,endVoice,muteVoice,forwardWakeAudio,endWakeVoice:()=>active?.wake?endVoice():Promise.resolve({listening:false}),cancelWakeVoice,isBusy:()=>Boolean(active||externalBusy())};
}
module.exports={installNativeIpc,NATIVE_VOICES};
