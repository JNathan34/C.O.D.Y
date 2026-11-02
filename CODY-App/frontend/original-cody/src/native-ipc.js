'use strict';
const {randomUUID}=require('node:crypto');
const {stripWakeText,isListeningCancellation}=require('./voice/keyword-wake-listener');
const {RpsVoice}=require('./rps-voice');
const {taskState}=require('./background-tasks');
const {selection,providerPatch}=require('./agent-provider');
const {setPersonalCodexEnabled}=require('./usage-policy');
function installNativeIpc({ipcMain,engine,store,sendUI,submitExternal,cancelExternal=async()=>{},externalBusy=()=>false,connectProvider,codexUsage,getState,getWindow,utilities,rps,capture,attachments,chooseFiles,controller,chooseWorkingFolder,captureTextEnabled=()=>false,onTasks=()=>{},showFiles=()=>{},fileDragging=()=>{},showApprovals=()=>{},cancelLocalApprovals=()=>{}}){
  let active=null;
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
  const gameVoice=rps?new RpsVoice({engine,game:rps}):null;
  const handle=(name,fn)=>{ipcMain.removeHandler(name);ipcMain.handle(name,(event,...args)=>{if(event.sender!==getWindow()?.webContents||event.senderFrame!==event.sender.mainFrame)throw Error('Untrusted interface');return fn(...args);});};
  const rememberPermissions=value=>{if(store.data?.settings&&store.setNativePermissions){store.setNativePermissions(value);sendUI('settings-changed',store.data.settings);}return value;};
  engine.on('permissions-changed',rememberPermissions);
  handle('plugins-list',()=>engine.request('plugins-list'));
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
    for(const key of Object.keys(change)){if(!['extraUsage','voice','cursorUpdates','folder'].includes(key))throw Error('Unknown agent setting');if(key==='folder'){if(change[key]!==null)throw Error('Use the folder picker');}else if(typeof change[key]!=='boolean')throw Error('Invalid agent setting');patch[key]=change[key];}
    const state=await engine.request('agents-configure',patch);rememberPermissions(await engine.request('permissions-state'));return state;
  });
  handle('agents-folder',async()=>{const folder=await chooseWorkingFolder?.();if(!folder)return null;const state=await engine.request('agents-configure',{folder});rememberPermissions(await engine.request('permissions-state'));return state;});
  handle('agents-privacy',capability=>{if(!['broadFileSystemAccess','documentsLibrary','picturesLibrary','contacts','appointments','microphone','webcam','location'].includes(capability))throw Error('Unknown privacy setting');return engine.request('agents-privacy',{capability});});
  handle('plugins-action',async({id,action,accountId}={})=>{
    if(typeof id!=='string'||!id||id.length>200||!['connect','disconnect'].includes(action)||accountId!==undefined&&(typeof accountId!=='string'||accountId.length>300))throw Error('Invalid plugin action');
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
      const permissions=controller.configure(Object.fromEntries(Object.entries(change).filter(([key])=>!['readApps','extraUsage','computerUse','backgroundTasks'].includes(key))));if(!permissions.enabled){cancelLocalApprovals();utilities?.cancel();}sendUI('settings-changed',store.data.settings);return{permissions,native};
    });
    handle('computer-emergency-stop',async()=>{await engine.request('permissions-configure',{enabled:false});await engine.request('drive-stop');await cancel();controller.configure({enabled:false});sendUI('settings-changed',store.data.settings);return{stopped:true};});
    if(chooseWorkingFolder)handle('browse-folder',async()=>{const folder=await chooseWorkingFolder();if(!folder)return null;const native=await engine.request('permissions-configure',{workingFolder:folder});store.settings({workingFolder:folder});rememberPermissions(native);return folder;});
  }
  const sendMessage=(role,text)=>{const message=store.addMessage(active.chatId,role,text,'heyclicky');if(role==='user'&&active.files?.length){message.attachments=active.files.map(file=>({path:file,name:require('node:path').basename(file)}));store.save();}sendUI('message-added',{chatId:active.chatId,message});return message;};
  function replace(message,text){if(!active||!message)return;store.updateMessage(active.chatId,message.id,text,{persist:false});sendUI('message-replace',{chatId:active.chatId,messageId:message.id,text});}
  function finish(error){if(!active)return;const current=active;if(error){if(!current.answer)current.answer=sendMessage('assistant',error);else if(!current.answer.text)replace(current.answer,error);sendUI('diagnostic',error);}active=null;store.save();sendUI('busy',{busy:false});sendUI('chats-changed',store.publicState());}
  async function runUtility(operation,text,speak){
    if(operation.voice&&utilities.match(text)?.action==='text.proofread'&&!operation.proofreadTarget)throw Error('Click the text box, then hold your voice shortcut and say “spell check this”. The box must expose editable text.');
    if(operation.user?.attachments)delete operation.user.attachments;
    if(utilities.match(text)?.command==='start'&&rps?.active){rps.close();await gameVoice.cancel();}
    const gameRequest=utilities.match(text)?.action==='rps';
    const result=await utilities.run(text,operation.chatId,{proofreadTarget:operation.proofreadTarget});
    if(active!==operation)return;
    active.answer=sendMessage('assistant',result.reply);
    finish();
    if(gameRequest&&rps?.active&&rps.phase==='ready'){void gameVoice.start();return result;}
    if(speak&&!result.error&&!result.cancelled)void engine.request('speak',{turn:operation.turn,text:result.confirmation||result.reply}).catch(error=>sendUI('diagnostic',error.message));
    return result;
  }
  engine.on('classify-utility',data=>{void engine.request('utility-route',{turn:data.turn,handled:Boolean(active?.voice&&active.turn===data.turn&&(active.files?.length||utilities?.match(data.text)))}).catch(()=>{});});
  engine.on('phase',data=>{sendUI('native-phase',data);if(data.state!=='Idle')sendUI('busy',{busy:Boolean(active)&&data.state!=='Listening'});});
  engine.on('meter',data=>sendUI('native-meter',data));
  engine.on('transcript',data=>{if(!active||active.turn!==data.turn)return;if(active.wake){data={...data,text:stripWakeText(data.text)};if(!data.text)return;}if(!active.user)active.user=sendMessage('user',data.text);else replace(active.user,data.text);});
  engine.on('response',data=>{if(!active||active.turn!==data.turn)return;if(!active.answer)active.answer=sendMessage('assistant',data.text);else replace(active.answer,data.text);});
  engine.on('failure',data=>{finish(data.Message);sendUI('native-phase',{state:'Idle'});});
  engine.on('offline',()=>{finish('CODY engine disconnected. Restart C.O.D.Y.');sendUI('native-phase',{state:'Idle'});});
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
  handle('browser-setup-choice',async({choice,targetId,browser}={})=>{
    if(browser!==undefined&&!['Chrome','Edge'].includes(browser))throw Error('Invalid browser setup choice');
    if(!['do_it_for_me','show_me_how','not_now'].includes(choice)||typeof targetId!=='string'||targetId.length>1000)throw Error('Invalid browser setup choice');
    const state=await engine.request('browser-setup-choice',{choice,targetId,...(browser?{browser}:{})});sendUI('browser-setup',state);return state;
  });
  handle('browser-setup-folder',()=>engine.request('browser-setup-folder'));
  engine.on('offline',()=>sendUI('computer-approvals',[]));
  handle('computer-approval-state',()=>engine.request('approval-state'));
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
  handle('attachments-add',async paths=>{
    if(!attachments)throw Error('File attachments are unavailable.');
    if(!store.chat(store.data.activeChatId)){store.newChat();sendUI('chats-changed',store.publicState());}
    const result=await attachments.add(store.data.activeChatId,paths);showFiles();return result;
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
  const submit=async({chatId,text,voice=false})=>{
    if(active||externalBusy())return {error:'Another reply is in progress'};
    text=String(text||'').trim();if(!text||text.length>25000)return {error:'Enter a message under 25,000 characters'};
    if(!store.chat(chatId))return {error:'Select a conversation'};
    if(gameVoice?.running)await gameVoice.cancel();
    if(utilities?.match(text)){
      active={turn:randomUUID(),chatId,utility:true};active.user=sendMessage('user',text);sendUI('busy',{busy:true});
      const operation=active;
      void runUtility(operation,text,voice||store.data.settings.voiceAutoSpeak).catch(error=>{if(active===operation)finish(error.message);});
      return {started:true,local:true,utility:true};
    }
    let batch;try{batch=attachments?await attachments.prepare(chatId):{paths:[],ids:[]};}catch(error){return {error:error.message};}const files=batch.paths;if(active)return {error:'Another reply is in progress'};
    const chosen=selection(store.data.settings);
    if(chosen.provider!=='heyclicky'){
      if(!submitExternal)return {error:'This AI connection is unavailable.'};
      if(files.length)return {error:'Attached files currently require Claude. Remove the attachments or select Claude.'};
      return submitExternal({chatId,text,voice,mode:chosen.provider});
    }
    const status=await engine.refresh();if(!status.signedIn)return {error:'Sign in to the existing AI connection in Settings → Plugins.'};
    if(active)return {error:'Another reply is in progress'};
    active={turn:randomUUID(),chatId,files};active.user=sendMessage('user',text);active.answer=sendMessage('assistant','');sendUI('busy',{busy:true});
    remember(active);
    const operation=active;
    void engine.request('submit',{turn:active.turn,text,speak:voice||store.data.settings.voiceAutoSpeak===true,...(files.length?{files}:{})}).then(result=>{if(active!==operation)return;if(!active.answer?.text&&result.text)replace(active.answer,result.text);finish();if(!files.length)void utilities?.observe(text);}).catch(error=>{if(active===operation)finish(error.message);});
    if(batch.ids.length)await attachments.clearSent(chatId,batch.ids);
    return {started:true,provider:'heyclicky'};
  };
  handle('send-message',submit);
  const beginVoice=async({audioPrefix,wake=false}={})=>{if(externalBusy()&&!await cancelExternal())throw Error('Finish or stop the current reply first');if(gameVoice?.running)return {listening:gameVoice.capture};if(active){const drive=await engine.request('drive-state');if(!drive.active)throw Error('Finish the current reply first');await engine.request('drive-stop');finish();}const operation=active={turn:randomUUID(),chatId:store.data.activeChatId,voice:true,wake,provider:selection(store.data.settings).provider};remember(operation);try{operation.attachmentBatch=attachments?await attachments.prepare(operation.chatId):{paths:[],ids:[]};operation.files=operation.attachmentBatch.paths;if(active!==operation)return {listening:false};const result=await engine.request('begin',{turn:operation.turn,...(wake?{wake:true}:{}),captureText:captureTextEnabled(),clientPid:process.pid,...(operation.files.length||wake||operation.provider!=='heyclicky'?{utilityOnly:true}:{}),...(audioPrefix?{audioPrefix}:{})});operation.proofreadTarget=result.textTarget;return result;}catch(error){finish(error.message);throw error;}};
  handle('native-begin',()=>beginVoice());
  const endVoice=async()=>{
    if(gameVoice?.running){await gameVoice.finishListening();return {game:true};}if(!active)return {listening:false};const operation=active;
    try{
      const result=await engine.request('end');if(active!==operation)return result;
      if(operation.wake){result.utilityText=stripWakeText(result.utilityText||result.transcript||'');if(!result.utilityText||isListeningCancellation(result.utilityText)){finish();return {...result,empty:!result.utilityText,cancelled:Boolean(result.utilityText)};}}
      if(result.controlStopped){if(!operation.user&&result.transcript)operation.user=sendMessage('user',result.transcript);operation.answer=sendMessage('assistant','Stopped.');finish();}
      else if(operation.provider!=='heyclicky'&&result.utilityText&&!utilities?.match(result.utilityText)){
        const text=result.utilityText;
        const chat=store.chat(operation.chatId);
        if(operation.user&&chat){chat.messages=chat.messages.filter(m=>m.id!==operation.user.id);store.save();}
        finish();sendUI('chats-changed',store.publicState());
        if(isListeningCancellation(text))return {...result,cancelled:true};
        const sent=await submit({chatId:operation.chatId,text,voice:true});
        if(sent?.error)throw Error(sent.error);
      }
      else if(result.utilityText&&(operation.files?.length||operation.wake)&&!utilities?.match(result.utilityText)){
        if(!operation.user)operation.user=sendMessage('user',result.utilityText);operation.answer=sendMessage('assistant','');sendUI('busy',{busy:true});
        const [answer]=await Promise.all([engine.request('submit',{turn:operation.turn,text:result.utilityText,speak:true,files:operation.files}),operation.attachmentBatch?.ids.length?attachments.clearSent(operation.chatId,operation.attachmentBatch.ids):Promise.resolve()]);
        if(active===operation){if(!operation.answer.text&&answer.text)replace(operation.answer,answer.text);finish();}
      }else if(result.utilityText){await runUtility(operation,result.utilityText,true);}else{const spoken=active?.user?.text;finish();if(spoken)void utilities?.observe(spoken);}
      return result;
    }catch(error){if(active===operation)finish(error.message);throw error;}
  };
  handle('native-end',endVoice);
  handle('native-stop-speech',async()=>{if(engine.status.state==='Responding')await engine.request('cancel');return true;});
  const cancel=async()=>{await cancelExternal();cancelLocalApprovals();utilities?.cancel();await gameVoice?.cancel();await engine.request('cancel');finish();return true;};
  handle('stop-turn',cancel);handle('voice-cancel',cancel);
  handle('new-chat',async()=>{rps?.close();await cancel();await engine.request('fresh');const chat=store.newChat();sendUI('chats-changed',store.publicState());return chat;});
  handle('select-chat',async id=>{rps?.close();await cancel();await engine.request('fresh');store.select(id);sendUI('chats-changed',store.publicState());return store.chat(id);});
  const backend=async()=>{const status=await engine.refresh();return {defaultProvider:selection(store.data.settings).provider,autoAvailable:false,voiceProvider:'CODY native voice and microphone',toolsProvider:'CODY native drawing, 3D and agent tools',heyclicky:{connected:true,reason:status.signedIn?'C.O.D.Y.’s built-in engine is connected.': 'Built-in engine ready. Sign in to your CODY account.',installation:{detected:true,bundled:true,version:'1.1.3',architecture:'x64'}}};};
  handle('backend-status',backend);handle('backend-refresh',backend);
  handle('voice-status',async()=>({...(await engine.refresh()),available:true,engine:'heyclicky',recognition:'heyclicky',language:engine.status.recognitionLanguage||'en',recognitionModel:'CODY native speech recognition',output:{available:true}}));
  handle('voice-voices',()=>({voices:['cedar','marin','alloy','ash','ballad','coral','echo','sage','shimmer','verse'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),playable:true})),hint:'CODY native voice'}));
  handle('voice-configure',settings=>engine.request('configure',{...(settings.speed!==undefined?{speed:settings.speed}:{}),...(settings.voice?{voice:settings.voice}:{}),...(settings.recognitionLanguage?{recognitionLanguage:settings.recognitionLanguage}:{})}));
  handle('native-preview',async()=>{if(active)throw Error('Finish the current turn first');await engine.request('submit',{text:'Say hello in one short sentence.',speak:true});return {played:true};});
  for(const name of ['visuals-clear','visuals-clear-all','annotations-clear'])handle(name,()=>engine.request('clear'));
  // Demo IPC stays owned by the fixed local renderers in main.js. Never turn a
  // settings preview into a billable native AI request.
  handle('web-status',async()=>{const status=await engine.refresh();return {signedIn:status.signedIn,detail:status.signedIn?'CODY connected':'CODY sign-in required'};});
  handle('web-sign-in',()=>engine.request('signIn'));
  return {cancel,gameVoice,submit,beginVoice,endVoice,endWakeVoice:()=>active?.wake?endVoice():Promise.resolve({listening:false}),cancelWakeVoice:()=>active?.wake?cancel():Promise.resolve(false),isBusy:()=>Boolean(active||externalBusy())};
}
module.exports={installNativeIpc};
