'use strict';
const {modelFamilyMatches}=require('./chatgpt-dom');
/**
 * One-app ChatGPT Web session. The isolated Chromium session is owned by CODY/Electron;
 * the regular official Codex CLI is used only for Agent mode. No local AI models.
 * The bridge relies on an unofficial UI and can stop working when ChatGPT changes.
 */
const {EventEmitter}=require('node:events');
const path=require('node:path');
const branding=require('./branding');
const {attachImage,uploadFiles,composerImagesScript,cleanupUploads}=require('./visuals/image-attachment');
const {isImageAttachment}=require('./attachments');
const {CHATGPT_URL,approvedUrl,safeChatUrl,snapshotScript,clearComposerScript,emptyComposerScript,composeScript,verifyComposerScript,sendScript,diffResponse,openModelMenuScript,currentModelLabelScript,currentModelMatches,modelMenuSnapshotScript,expandModelFamilyScript,chooseModelFamilyScript,focusEffortSliderScript}=require('./chatgpt-dom');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class ChatGPTBrowser extends EventEmitter{
  constructor({BrowserWindow,session, parent, timeoutMs=180000, pollMs=170,screenshotDirectory}){
    super();this.BrowserWindow=BrowserWindow;this.session=session;this.parent=parent;
    this.screenshotDirectory=screenshotDirectory;
    cleanupUploads(screenshotDirectory);
    this.timeoutMs=timeoutMs;this.pollMs=pollMs;this.win=null;this.active=null;this.quitting=false;this.lastState=null;this.loadPromise=null;this.monitorTimer=null;this.pendingProbe=null;this.firstUnreadyAt=null;this.probeInProgress=false;
  }
  async ensure(){
    if(this.win&&!this.win.isDestroyed()){
      if(this.loadPromise)await this.loadPromise;
      return this.win;
    }
    const partition='persist:cody-chatgpt-web';
    const ses=this.session.fromPartition(partition);
    // Chat mode does not need OS permissions or file access.
    ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    const w=new this.BrowserWindow({title:'C.O.D.Y · ChatGPT session',icon:branding.icon,width:1120,height:790,minWidth:720,minHeight:530,
      parent:typeof this.parent==='function'?this.parent():this.parent,show:false,autoHideMenuBar:true,
      backgroundColor:'#101216',webPreferences:{partition,contextIsolation:true,nodeIntegration:false,
        sandbox:true,webSecurity:true,backgroundThrottling:false,spellcheck:true,webgl:false}});
    this.win=w;
    // The browser may finish its main navigation BEFORE the React chat composer appears.
    // Schedule a probe after redirects/hydration, and keep checking while the session is open.
    const schedule=()=>this.scheduleProbe(600);
    w.webContents.on('did-finish-load',schedule);
    w.webContents.on('did-navigate',schedule);
    w.webContents.on('did-navigate-in-page',schedule);
    w.on('close',e=>{if(!this.quitting){e.preventDefault();w.hide();this.scheduleProbe(300);}});
    w.webContents.setWindowOpenHandler(({url})=>approvedUrl(url)
      ?{action:'allow',overrideBrowserWindowOptions:{icon:branding.icon,show:true,autoHideMenuBar:true,webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webgl:false}}}
      :{action:'deny'});
    w.webContents.on('will-navigate',(event,url)=>{if(!approvedUrl(url))event.preventDefault();});
    w.webContents.on('did-fail-load',(_e,code,description,_validatedUrl,isMainFrame)=>{
      if(isMainFrame&&code!==-3)this.publish({online:false,signedIn:false,stage:'error',detail:`ChatGPT page failed to load: ${description} (${code})`});
    });
    this.loadPromise=Promise.resolve().then(()=>w.loadURL(CHATGPT_URL)).finally(()=>{this.loadPromise=null;});
    try{await this.loadPromise;}
    catch(error){this.publish({online:false,signedIn:false,stage:'error',detail:`ChatGPT navigation failed: ${error.message}`});throw error;}
    if(!this.monitorTimer){
      this.monitorTimer=setInterval(()=>{
        if(this.quitting||!this.win||this.win.isDestroyed()||this.active)return;
        void this.status().catch(err=>this.publish({online:false,signedIn:false,stage:'error',detail:`ChatGPT check failed: ${err.message}`}));
      },2500);
      this.monitorTimer.unref?.();
    }
    this.scheduleProbe(400);
    return w;
  }
  publish(next){
    const prev=this.lastState;
    this.lastState=next;
    if(!prev || prev.signedIn!==next.signedIn || prev.stage!==next.stage || prev.detail!==next.detail || prev.url!==next.url){
      this.emit('status',next);
    }
    return next;
  }
  scheduleProbe(ms=600){
    if(this.pendingProbe)clearTimeout(this.pendingProbe);
    this.pendingProbe=setTimeout(()=>{
      this.pendingProbe=null;
      void this.status().catch(err=>this.publish({online:false,signedIn:false,stage:'error',detail:`ChatGPT status error: ${err.message}`}));
    },ms);
    this.pendingProbe.unref?.();
  }
  async show(){const w=await this.ensure();w.show();w.focus();return {opened:true};}
  async warm(){
    try{await this.ensure();return await this.status();}
    catch(err){return this.publish({online:false,signedIn:false,stage:'error',detail:err.message});}
  }
  async status({create=false}={}){
    if(!create&&(!this.win||this.win.isDestroyed()))return {online:false,signedIn:false,stage:'idle',detail:'Open the ChatGPT session to sign in once'};
    await this.ensure();
    if(this.probeInProgress)return this.lastState||{online:false,signedIn:false,stage:'loading',detail:'ChatGPT is loading…'};
    this.probeInProgress=true;
    try{
      const state=await this.win.webContents.executeJavaScript(snapshotScript(),true);
      const url=safeChatUrl(state.url);
      const onChatGPT=(()=>{try{return new URL(state.url).hostname==='chatgpt.com';}catch{return false;}})();
      let stage='loading',detail='ChatGPT is loading its interface…';
      if(state.ready&&onChatGPT){stage='ready';detail='Connected — ChatGPT is ready inside CODY';}
      else if(state.challenge){stage='challenge';detail='ChatGPT is showing a security check. Open Account to complete it.';}
      else if(state.authRequired||!onChatGPT){stage='auth';detail='Sign in to ChatGPT in the C.O.D.Y Account window.';}
      else{
        if(!this.firstUnreadyAt)this.firstUnreadyAt=Date.now();
        if(state.pageLoaded&&Date.now()-this.firstUnreadyAt>=8000){
          stage='unrecognized';detail='ChatGPT loaded, but C.O.D.Y cannot find its message box. Open Account to inspect the page; the website may have changed.';
        }
      }
      if(stage==='ready'||stage==='auth'||stage==='challenge')this.firstUnreadyAt=null;
      return this.publish({online:stage==='ready',signedIn:stage==='ready',authRequired:stage==='auth',stage,detail,url});
    }catch(err){return this.publish({online:false,signedIn:false,authRequired:false,stage:'error',detail:`Could not inspect ChatGPT: ${err.message}`});}
    finally{this.probeInProgress=false;}
  }
  async waitUntilReady({timeoutMs=17000}={}){
    const started=Date.now();
    let state=await this.status({create:true});
    while(state.stage==='loading' && Date.now()-started<timeoutMs){
      await delay(500);
      state=await this.status({create:true});
    }
    return state;
  }
  async navigate(url){
    await this.ensure();const safe=safeChatUrl(url)||CHATGPT_URL;
    const current=this.win.webContents.getURL();
    if(current!==safe){await this.win.loadURL(safe);await delay(500);}
  }
  // Model picker inspired by codex-chatgpt-web v6.1.14 (MIT); no private APIs.
  // Explicit selection is verified against visible controls or the request is NOT sent.
  async selectWebModel(preference='website'){
    if(preference==='website')return;
    if(!/^(6|6\.1-sol|5\.6):(low|medium|high|xhigh)$/.test(preference))throw Error('Unsupported ChatGPT Web model preference');
    const [family,effort]=preference.split(':');
    const wc=this.win.webContents;
    // In most conversations the requested model is already selected. Verify the
    // visible label first; do not require an open picker just to send a prompt.
    const visible=await wc.executeJavaScript(currentModelLabelScript(),true);
    if(visible.ok&&currentModelMatches(preference,visible.label))return;
    // React may mount the composer before its model control. Retry non-mutating
    // checks first; never change the selection based on guessed labels.
    let opened={ok:false,why:'Model selector not ready'};
    for(let n=0;n<8;n++){
      opened=await wc.executeJavaScript(openModelMenuScript(),true);
      if(opened.ok)break;
      await delay(250);
      const current=await wc.executeJavaScript(currentModelLabelScript(),true);
      if(current.ok&&currentModelMatches(preference,current.label))return;
    }
    if(!opened.ok)throw Error('ChatGPT model selection: '+opened.why);
    await delay(300);
    let snapshot=await wc.executeJavaScript(modelMenuSnapshotScript(),true);
    if(snapshot.radios.filter(r=>r.visible).length<2){
      await wc.executeJavaScript(expandModelFamilyScript(),true);
      await delay(350);snapshot=await wc.executeJavaScript(modelMenuSnapshotScript(),true);
    }
    const radio=(snapshot.radios||[]).find(r=>r.checked);
    const familyOK=radio&&modelFamilyMatches(family,radio.name);
    if(!familyOK){
      const picked=await wc.executeJavaScript(chooseModelFamilyScript(family),true);
      if(!picked.ok)throw Error('ChatGPT model selection: '+picked.why);
      await delay(350);
    }
    // React may close the menu after choosing the version. Reopen if necessary.
    snapshot=await wc.executeJavaScript(modelMenuSnapshotScript(),true);
    if(!snapshot.slider){
      await wc.executeJavaScript(openModelMenuScript(),true);await delay(250);
      snapshot=await wc.executeJavaScript(modelMenuSnapshotScript(),true);
    }
    const want={low:0,medium:1,high:2,xhigh:3}[effort];
    const slider=snapshot.slider;
    if(!slider||!Number.isInteger(slider.min)||!Number.isInteger(slider.max)||slider.max-slider.min>4||slider.max-slider.min<want)
      throw Error('ChatGPT does not expose the requested reasoning effort. Message not sent.');
    if(slider.locks.length===slider.max-slider.min+1&&slider.locks[want]==='true')
      throw Error('That ChatGPT reasoning mode is locked for this account. Message not sent.');
    const focus=await wc.executeJavaScript(focusEffortSliderScript(),true);
    if(!focus.ok)throw Error('Cannot control ChatGPT model selection: '+focus.why);
    const target=slider.min+want;
    // Native key events (not synthetic DOM KeyboardEvents) are required for React sliders.
    const press=async key=>{wc.sendInputEvent({type:'keyDown',keyCode:key});wc.sendInputEvent({type:'keyUp',keyCode:key});await delay(110);};
    for(let n=0;n<5;n++){
      snapshot=await wc.executeJavaScript(modelMenuSnapshotScript(),true);
      const value=snapshot.slider?.value;
      if(value===target)break;
      if(!Number.isInteger(value))throw Error('ChatGPT model selector disappeared before verification');
      await press(value<target?'Right':'Left');
    }
    snapshot=await wc.executeJavaScript(modelMenuSnapshotScript(),true);
    if(snapshot.slider?.value!==target)throw Error('Could not verify the chosen ChatGPT reasoning mode. Message not sent.');
    const selected=snapshot.radios.find(r=>r.checked);
    const verified=selected&&modelFamilyMatches(family,selected.name);
    if(!verified)throw Error('Could not verify the chosen ChatGPT model family. Message not sent.');
    // Close only the currently-open menu; never click controls outside the composer.
    await wc.executeJavaScript(`(() => {const m=document.querySelector('[role="menu"]');if(m){const trigger=document.querySelector('[aria-expanded="true"][aria-haspopup="menu"]');trigger?.click();}return true})()`,true);
  }
  async send({text,chatUrl,onUrl,onText,signal,webModel='website',image,onImageDelivered,files=[],onAccepted}){
    if(this.active)throw Error('A ChatGPT response is already being generated');
    if(typeof text!=='string'||!text.trim()||text.length>25000)throw Error('Enter a message under 25,000 characters');
    const task={cancelled:false};this.active=task;let attachment;
    try{
      if(chatUrl && !safeChatUrl(chatUrl))throw Error('Saved ChatGPT conversation link is invalid. No message was sent.');
      await this.navigate(chatUrl);
      if(signal?.aborted||task.cancelled)throw Error('Cancelled');
      const wc=this.win.webContents;
      let before=await wc.executeJavaScript(snapshotScript(),true);
      for(let n=0;n<24&&!before.ready;n++){
        if(signal?.aborted||task.cancelled)throw Error('Cancelled');
        await delay(450);
        before=await wc.executeJavaScript(snapshotScript(),true);
      }
      if(!before.ready){throw Error(before.authRequired?'ChatGPT needs a one-time sign-in. Use Connect in the C.O.D.Y window, then retry.':'ChatGPT is not ready. Use Repair session in Settings if it persists.');}
      const target=safeChatUrl(chatUrl);
      if(target){
        // Loading a previous chat can briefly render a working composer from
        // the OLD conversation. Do not send until the target URL is active.
        const desired=new URL(target).pathname.replace(/\/$/,'');
        for(let n=0;n<16;n++){
          if(signal?.aborted||task.cancelled)throw Error('Cancelled');
          if(new URL(before.url).pathname.replace(/\/$/,'')===desired)break;
          await delay(250);before=await wc.executeJavaScript(snapshotScript(),true);
        }
        if(new URL(before.url).pathname.replace(/\/$/,'')!==desired)throw Error('The requested ChatGPT conversation did not load. No message was sent.');
      } else if(safeChatUrl(before.url)){
        // A supposedly new CODY conversation must never reuse a previous Web
        // thread. This can happen if the website redirects back to a recent chat.
        throw Error('ChatGPT reopened an existing conversation instead of a new chat. No message was sent; open the ChatGPT session to review it.');
      }
      await this.selectWebModel(webModel);
      // The website can retain an unsent draft (including one from a failed turn).
      // Clear and verify it BEFORE inserting, rather than appending the new prompt.
      const cleared=await wc.executeJavaScript(clearComposerScript(),true);
      if(!cleared.ok)throw Error(cleared.why);
      let empty={ok:false,why:'ChatGPT did not clear its previous draft.'};
      for(let n=0;n<14;n++){
        if(signal?.aborted||task.cancelled)throw Error('Cancelled');
        empty=await wc.executeJavaScript(emptyComposerScript(),true);
        if(empty.ok)break;
        await delay(110);
      }
      if(!empty.ok)throw Error(empty.why);
      const inserted=await wc.executeJavaScript(composeScript(text),true);
      if(!inserted.ok)throw Error(inserted.why);
      // Wait for Lexical/React to settle, then validate the whole prepared prompt.
      // Never send partially inserted text or compare raw innerText newline layout.
      let verified={ok:false,why:'ChatGPT composer did not settle after insertion.'};
      for(let n=0;n<20;n++){
        if(signal?.aborted||task.cancelled)throw Error('Cancelled');
        await delay(150);
        verified=await wc.executeJavaScript(verifyComposerScript(text),true);
        if(verified.ok)break;
      }
      if(!verified.ok)throw Error(verified.why);
      if(image)attachment=await attachImage(wc,image,{signal,cancelled:()=>task.cancelled,root:this.screenshotDirectory});
      else if(files.length){
        if(new URL(wc.getURL()).origin!=='https://chatgpt.com')throw Error('Open the ChatGPT session before uploading files.');
        const filenames=files.filter(file=>!isImageAttachment(file)).map(file=>path.basename(file));
        await uploadFiles(wc,files,{filenames,imageCount:files.length-filenames.length,signal,cancelled:()=>task.cancelled});
        const afterUpload=await wc.executeJavaScript(verifyComposerScript(text),true);
        if(!afterUpload.ok)throw Error('The ChatGPT draft changed during upload. Review it before retrying.');
      }
      else if(this.screenshotDirectory){const pending=await wc.executeJavaScript(composerImagesScript(),true);if(pending.images?.length||pending.hasAttachments)throw Error('Review the unsent attachments in ChatGPT before sending another message.');}
      // Refresh after navigation/model selection/composer updates have settled.
      // The initial page snapshot can contain only part of the saved history.
      before=await wc.executeJavaScript(snapshotScript(),true);
      if(!before.ready||before.generating)throw Error('ChatGPT is not ready for a new message. No message was sent.');
      const canonical=s=>String(s||'').replace(/[\u200b\u200c\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
      const sentText=canonical(text);
      const matchesSentUser=state=>canonical(state.lastUserText)===sentText;
      let result={ok:false,why:'ChatGPT send button was never enabled.'};
      for(let n=0;n<20;n++){
        if(signal?.aborted||task.cancelled)throw Error('Cancelled');
        result=await wc.executeJavaScript(sendScript(),true);
        if(result.ok)break;
        await delay(220);
      }
      if(!result.ok){throw Error(result.why);}
      // Only click ONCE. Wait for actual acceptance; never retry a possibly-sent prompt.
      const acceptedAt=Date.now();let accepted=false,acceptedState=null,acceptedNewUser=false;
      while(Date.now()-acceptedAt<12000){
        if(signal?.aborted||task.cancelled)throw Error('Cancelled');
        await delay(120);
        const state=await wc.executeJavaScript(snapshotScript(),true);
        const userEcho=canonical(state.lastUserText);
        // User turn may not change the observed count in newer virtualised
        // layouts. The page echo of the EXACT prepared prompt is another safe
        // acknowledgement; simply clearing the composer is not sufficient.
        const hasNewEcho=Boolean(userEcho && userEcho===sentText &&
          (canonical(before.lastUserText)!==userEcho || state.userCount>before.userCount));
        const newUserKey=Boolean(state.lastUserKey && state.lastUserKey!==before.lastUserKey);
        if(matchesSentUser(state)&&(hasNewEcho||newUserKey||state.userCount>before.userCount)&&(!image||state.lastUserImageCount>0)){
          accepted=true;acceptedState=state;acceptedNewUser=hasNewEcho||newUserKey||state.userCount>before.userCount;break;
        }
      }
      if(!accepted)throw Error('ChatGPT did not confirm the message was sent. Review the ChatGPT session; C.O.D.Y will not click twice.');
      if(image){await onImageDelivered?.(image.captureId,{accepted:true,userKey:acceptedState.lastUserKey||null,imageCount:acceptedState.lastUserImageCount});await attachment.cleanup();attachment=null;}
      await onAccepted?.();
      const start=Date.now();let current='',seenResponse=false,lastChange=Date.now();let previousUrl=null;
      const observe=(state)=>{
        const newUrl=safeChatUrl(state.url);
        if(newUrl&&newUrl!==previousUrl){previousUrl=newUrl;onUrl?.(newUrl);}
        // Never stream an old reply, commentary, role label or waiting indicator.
        const newReply=acceptedNewUser&&matchesSentUser(state)&&state.answerAfterUser===true;
        if(newReply&&state.answerPresent&&state.answer){
          const next=diffResponse(current,state.answer);
          if(next!==null){current=next;seenResponse=true;lastChange=Date.now();onText?.(current);}
        }
      };
      // Capture the first assistant chunk immediately, without waiting an extra poll.
      if(acceptedState)observe(acceptedState);
      while(Date.now()-start<this.timeoutMs){
        if(signal?.aborted||task.cancelled)throw Error('Cancelled');
        await delay(this.pollMs);
        const state=await wc.executeJavaScript(snapshotScript(),true);
        observe(state);
        // Wait for a stable finished reply. Never complete on a bare role label.
        if(seenResponse&&matchesSentUser(state)&&state.answerAfterUser===true&&!state.generating&&Date.now()-lastChange>1200)return {text:current,url:previousUrl||safeChatUrl(state.url)};
        if(!state.ready&&!state.generating&&Date.now()-start>10000)throw Error('ChatGPT page changed or navigation interrupted the response');
      }
      throw Error('Timed out waiting for ChatGPT. Open the ChatGPT session window to inspect its status.');
    }finally{try{await attachment?.cleanup();}finally{this.active=null;}}
  }
  async stop(){if(!this.active)return false;this.active.cancelled=true;
    try{await this.win?.webContents.executeJavaScript(`(() => {const b=document.querySelector('[data-testid="stop-button"],button[aria-label="Stop generating"]');if(b)b.click();})()`);}catch{}
    return true;
  }
  async quit(){this.quitting=true;this.active&&(this.active.cancelled=true);if(this.pendingProbe)clearTimeout(this.pendingProbe);if(this.monitorTimer)clearInterval(this.monitorTimer);this.pendingProbe=null;this.monitorTimer=null;if(this.win&&!this.win.isDestroyed())this.win.destroy();this.win=null;this.loadPromise=null;cleanupUploads(this.screenshotDirectory);}
}
module.exports={ChatGPTBrowser};
