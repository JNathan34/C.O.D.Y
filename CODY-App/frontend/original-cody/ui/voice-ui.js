'use strict';
(function(){
  function safeForSpeech(text){
    const s=String(text||'').split(/CODY_(?:TOOL|ACTION)_JSON:|```(?:cody-tool|cody-action|json)/i)[0];
    if(/^(?:C\.O\.D\.Y\.? (?:continuation|verified runtime capabilities|desktop assistant context|local tool-result continuation)|RUNTIME CAPABILITIES|HUMAN MESSAGE:)/i.test(s.trim()))return '';
    return s.replace(/https?:\/\/\S+/g,'a link')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\ufe0f]/gu,'')
      .replace(/`[^`]+`/g,'').replace(/[#*_~>|]/g,' ').replace(/\s+/g,' ').trim();
  }
  function takeSentence(text,final=false){
    const value=String(text||'').trimStart();
    if(!value)return null;
    // Defer the next phrase until complete enough to sound natural.
    const match=value.match(/^([\s\S]{24,}?[.!?])(?=\s|$)/);
    if(match)return {speech:match[1].trim(),remaining:value.slice(match[0].length).trimStart()};
    if(final)return {speech:value.slice(0,1000),remaining:value.slice(1000).trimStart()};
    return null;
  }
  function attach({api,$,toast,send,getApp,preview,selectChatGPT=()=>{},onAudio,getVolume=()=>1,getMicDeviceId=()=>'',onBeforeCapture=()=>{},onReview=()=>{},bindMicrophone=true}) {
    const mic=$('voice-mic'), speaker=$('voice-speaker'), label=$('voice-connection-status');
    const settings=()=>getApp()?.data?.settings||{};
    let config=null, ready=false, voiceChat=null, messageId=null, messageSpeech=false,micCheck=null,reviewDraft=null;
    let selectedChat=getApp()?.data?.activeChatId;
    let spokenChars=0, generation=0, activeAudio=null, queue=[], draining=false;
    let speechPlaying=false,activeSpeechScope='preview',segmentSequence=0;
    const speechScopes=new Set();
    const reportSpeech=(phase,scopeId=activeSpeechScope,currentTime)=>{const pending=api.annotations?.speech?.({phase,scopeId,...(currentTime===undefined?{}:{currentTime}),segmentId:String(segmentSequence)});pending?.catch(()=>{});};
    function finishPlayback(){if(speechPlaying&&!activeAudio&&!draining&&!queue.length&&!getApp().busy){speechPlaying=false;for(const scope of speechScopes)reportSpeech('finished',scope);speechScopes.clear();}}
    const status=text=>{label.textContent=text;};
    const phase=value=>window.dispatchEvent(new CustomEvent('cody:voice-state',{detail:{phase:value}}));
    function stopSpeech() {
      speechPlaying=false;for(const scope of new Set([activeSpeechScope,messageId,...speechScopes,...queue.map(item=>item.scopeId)].filter(Boolean)))reportSpeech('cancelled',scope);speechScopes.clear();
      ++generation; queue=[]; draining=false;
      if(activeAudio){activeAudio.pause();activeAudio.src='';activeAudio=null;}
      void api.voice.cancel().catch(()=>{});
      phase(getApp().busy?'thinking':'idle');
    }
    async function play(text,current,scopeId='preview') {
      const result=await api.voice.synthesize(text);
      if(current!==generation)return;
      const audio=new Audio(`data:${result.mime};base64,${result.base64}`);
      audio.volume=Math.max(0,Math.min(1,getVolume()));
      activeAudio=audio;activeSpeechScope=scopeId;++segmentSequence;phase('speaking');
      try {
        if(onAudio)await onAudio(audio);
        if(current!==generation)return;
        await new Promise((resolve,reject)=>{
          let paused=false;
          audio.onplaying=()=>{if(current===generation){speechPlaying=true;speechScopes.add(scopeId);reportSpeech(paused?'resumed':'playing',scopeId,audio.currentTime||0);paused=false;}};
          audio.ontimeupdate=()=>{if(current===generation)reportSpeech('progress',scopeId,audio.currentTime||0);};
          audio.onended=resolve;
          audio.onpause=()=>{if(current!==generation){resolve();return;}if(audio.ended||activeAudio!==audio)return;paused=true;reportSpeech('paused',scopeId,audio.currentTime||0);};
          audio.onerror=()=>reject(Error('Audio playback failed'));
          audio.play().catch(reject);
        });
      } finally {if(activeAudio===audio)activeAudio=null;audio.src='';}
    }
    async function drain() {
      if(draining||!queue.length)return;
      draining=true;const current=generation;
      try {while(queue.length&&current===generation){const item=queue.shift();await play(typeof item==='string'?item:item.text,current,typeof item==='string'?'preview':item.scopeId);}}
      catch(error){if(current===generation){queue=[];speechPlaying=false;reportSpeech('cancelled');toast('Speech output: '+error.message);}}
      finally {if(current===generation){draining=false;phase(getApp().busy?'thinking':'idle');finishPlayback();}}
    }
    function speakUpdates(id,text,final=false) {
      if(!messageSpeech||id!==messageId)return;
      const safe=safeForSpeech(text);
      if(safe.length<spokenChars)return;
      let rest=safe.slice(spokenChars),next;
      while((next=takeSentence(rest,final))){
        if(next.speech)queue.push({text:next.speech,scopeId:id});
        spokenChars+=rest.length-next.remaining.length;rest=next.remaining;
        if(!rest)break;
      }
      void drain();
    }
    async function loadVoices(selected=config?.voice) {
      const select=$('voice-choice');select.replaceChildren(new Option('Loading voices…',''));
      const engine=$('voice-engine').value;
      const catalog=await api.voice.voices(engine);
      if(engine!==$('voice-engine').value)return;
      select.replaceChildren(new Option('Use default voice',''));
      for(const voice of catalog.voices||[]){
        if(voice.playable===false)continue;
        const label=(voice.name||voice.id).replace(/^Microsoft\s+/,'').replace(/ Online \(Natural\) - [^·]+/,'').replace(/ · (en-[A-Z]{2}) · /,' · ');
        const option=new Option(label,voice.id);option.title=voice.name||voice.id;select.add(option);
      }
      if([...select.options].some(option=>option.value===selected))select.value=selected;
      if(catalog.hint)status(catalog.hint);
      const unavailable=$('voice-unavailable');
      if(unavailable){const names=(catalog.voices||[]).filter(v=>v.playable===false).map(v=>(v.name||v.id).split(' · ')[0]);unavailable.hidden=!names.length;unavailable.textContent=names.length?'Installed for Narrator, unavailable through the Windows speech APIs used here: '+names.join(', ')+'. Edge Neural offers online Andrew/Ava alternatives; these are different from the downloaded HD voices.':'';}
    }
    async function refresh() {
      if(preview)return;
      try {
        config=await api.voice.status();ready=config.available;
        const modelStatus=$('recognition-model-status');if(modelStatus)modelStatus.textContent=config.recognitionModel||'Local recognition files';
        $('voice-engine').value=config.engine;$('voice-language').value=config.language;$('voice-recognition').value=config.recognition;
        try{await loadVoices();}catch(error){status('Voice list unavailable: '+error.message);}
        status(ready?(config.output?.available===false?'Listening ready. '+config.output.reason:'Ready — hold Ctrl+Alt, speak, then release.'):(config.recognitionError||'Speech recognition is unavailable. Check Microphone settings.'));
      } catch(error){ready=false;status('Speech unavailable: '+error.message);}
    }
    function render() {
      if(window.CODYIcons)window.CODYIcons.set(speaker,settings().voiceAutoSpeak?'volume-2':'volume-x');
      else speaker.textContent=settings().voiceAutoSpeak?'🔊':'🔈';
      speaker.setAttribute('aria-pressed',String(Boolean(settings().voiceAutoSpeak)));
      $('voice-auto-speak').checked=Boolean(settings().voiceAutoSpeak);
      $('voice-auto-send').checked=settings().voiceAutoSend!==false;
    }
    const recorder=new window.CODYVoiceRecorder();
    Object.defineProperty(recorder,'deviceId',{get:getMicDeviceId});
    const capture=new window.CODYPushToTalk({
      recorder,
      transcribe:audio=>api.voice.transcribe({base64:audio.base64}),
      onState:value=>{
        const listening=['starting','listening'].includes(value);
        mic.classList.toggle('recording',listening);
        mic.classList.toggle('working',['transcribing','submitting'].includes(value));
        mic.setAttribute('aria-pressed',String(listening));
        phase(value==='idle'&&getApp().busy?'thinking':value);
        if(value==='starting'){status('Opening microphone — wait for Listening.');toast('Opening microphone…');}
        if(value==='listening'){status('Listening — release Ctrl or Alt to send.');toast('Listening — release Ctrl or Alt to send.');const deviceStatus=$('mic-permission-status');if(deviceStatus&&recorder.deviceLabel)deviceStatus.textContent='Using '+recorder.deviceLabel;}
        if(value==='transcribing')status('Processing speech on this PC…');
      },
      onLevel:level=>window.dispatchEvent(new CustomEvent('cody:audio-level',{detail:{level}})),
      onError:error=>{status(error.message);toast(error.message);},
      submit:async result=>{
        const prompt=$('prompt');
        status(result.corrected?'Heard: '+result.originalText+' → '+result.text:'Heard: '+result.text);
        // Retrying an uncertain recording replaces only its untouched voice
        // draft. Never overwrite a typed or edited message.
        if(reviewDraft&&reviewDraft.chat===(getApp().data.activeChatId||'new')&&prompt.value===reviewDraft.text)prompt.value='';
        reviewDraft=null;
        if(prompt.value.trim()){
          toast('A draft is already in the composer. Your voice transcript is shown in speech status.');
          status('Voice transcript: '+result.text);return;
        }
        selectChatGPT();
        voiceChat=getApp().data.activeChatId||'new';
        messageId=null;messageSpeech=false;spokenChars=0;
        prompt.value=result.text;prompt.dispatchEvent(new Event('input',{bubbles:true}));
        if(result.needsReview||settings().voiceAutoSend===false){if(result.needsReview)reviewDraft={text:result.text,chat:getApp().data.activeChatId||'new'};const message=result.reviewReason||'Review the transcript, then press Send.';status(message);toast(message);onReview();return;}
        if(getApp().busy){status('Transcript ready — send after the current task finishes.');toast('Transcript ready — send after the current task finishes.');onReview();return;}
        try{
          const outcome=await send({voice:true});
          if(outcome?.error||outcome?.blocked||outcome?.cancelled)voiceChat=null;
          else toast('');
        }catch(error){voiceChat=null;throw error;}
      }
    });
    async function press() {
      if(micCheck){toast('Finish the microphone recording check first.');return;}
      if(!ready){toast(config?.recognitionError||'Speech is not ready. Check Settings → Microphone.');return;}
      if(getApp().busy){toast('C.O.D.Y is finishing a task. Stop it before starting another voice request.');return;}
      if(capture.phase!=='idle')return;
      onBeforeCapture();
      stopSpeech();await capture.press();
    }
    async function cancel() {if(micCheck){clearTimeout(micCheck.timer);await micCheck.recorder.cancel();micCheck=null;const button=$('mic-record-check');if(button){button.disabled=false;button.textContent='Record 5 seconds';}}await capture.cancel();stopSpeech();status('Voice input cancelled.');}
    const checkButton=$('mic-record-check');
    async function finishMicCheck(){
      const check=micCheck;if(!check||check.processing)return;check.processing=true;clearTimeout(check.timer);checkButton.disabled=true;
      const resultLabel=$('mic-check-result'),playback=$('mic-check-playback');
      try{
        const audio=await check.recorder.stop();if(micCheck!==check||!audio)return;
        playback.src='data:audio/wav;base64,'+audio.base64;playback.hidden=false;$('mic-check-playback-row').hidden=false;
        const level=audio.quality?.level,advice=level==='quiet'?'The microphone is very quiet. Check Windows input volume. ':level==='clipping'?'The audio is distorting. Lower Windows input volume. ':'';
        resultLabel.textContent=advice+'Recording from '+audio.deviceLabel+'. Checking speech…';
        const result=await api.voice.transcribe({base64:audio.base64});if(micCheck!==check)return;
        resultLabel.textContent=advice+'Heard: '+(result.text||'No clear speech')+'. Microphone: '+audio.deviceLabel+'.';
      }catch(error){if(micCheck===check)resultLabel.textContent=error.message;}
      finally{if(micCheck===check){micCheck=null;checkButton.disabled=false;checkButton.textContent='Record 5 seconds';}}
    }
    checkButton?.addEventListener('click',async()=>{
      if(micCheck){void finishMicCheck();return;}
      if(capture.phase!=='idle'||getApp().busy){toast('Finish the current voice request first.');return;}
      onBeforeCapture();stopSpeech();const recorder=new window.CODYVoiceRecorder();recorder.deviceId=getMicDeviceId();
      const check={recorder,processing:false};micCheck=check;checkButton.disabled=true;
      try{
        const playback=$('mic-check-playback');playback.pause();playback.removeAttribute('src');playback.hidden=true;$('mic-check-playback-row').hidden=true;
        $('mic-check-result').textContent='Opening microphone…';await recorder.start();if(micCheck!==check){await recorder.cancel();return;}
        $('mic-check-result').textContent='Recording for five seconds. Say “Open Firefox”, then listen to the recording below.';
        checkButton.disabled=false;checkButton.textContent='Stop recording';check.timer=setTimeout(()=>void finishMicCheck(),5000);
      }catch(error){if(micCheck===check){micCheck=null;checkButton.disabled=false;checkButton.textContent='Record 5 seconds';$('mic-check-result').textContent=error.message;}}
    });
    api.on('voice-hotkey',value=>{if(value==='down')void press();else if(value==='up')void capture.release();else void cancel();});
    if(bindMicrophone)mic.addEventListener('click',()=>{if(['starting','listening'].includes(capture.phase))void capture.release();else void press();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.target.closest?.('select:open'))void cancel();});
    window.addEventListener('beforeunload',()=>{void cancel();});
    async function saveVoice(){
      try {stopSpeech();await api.voice.configure({recognition:$('voice-recognition').value,engine:$('voice-engine').value,voice:$('voice-choice').value,language:$('voice-language').value});await refresh();return true;}
      catch(error){toast(error.message);status(error.message);return false;}
    }
    $('voice-engine').addEventListener('change',async()=>{try{await loadVoices('');await saveVoice();}catch(error){toast(error.message);}});
    for(const id of ['voice-choice','voice-recognition','voice-language'])$(id).addEventListener('change',()=>void saveVoice());
    $('voice-save').addEventListener('click',async()=>{if(await saveVoice())toast('Voice settings saved.');});
    $('voice-install').addEventListener('click',async()=>{
      const button=$('voice-install');button.disabled=true;status('Installing speech output support…');
      try {await api.voice.install($('voice-engine').value);await loadVoices();status('Speech support installed.');}
      catch(error){toast(error.message);status(error.message);}finally{button.disabled=false;}
    });
    $('recognition-install').addEventListener('click',async()=>{
      const button=$('recognition-install');button.disabled=true;status('Downloading and verifying the local speech model…');
      try{await api.voice.install('recognition');await refresh();}catch(error){status(error.message);toast(error.message);}finally{button.disabled=false;}
    });
    $('voice-test').addEventListener('click',async()=>{
      if(capture.phase!=='idle')return;
      stopSpeech();queue.push('Hello! I am C.O.D.Y, your Windows desktop assistant.');void drain();
    });
    const saveSpeak=async value=>{try{await api.saveSettings({voiceAutoSpeak:value});getApp().data.settings.voiceAutoSpeak=value;if(!value)stopSpeech();render();}catch(error){toast(error.message);}};
    speaker.addEventListener('click',()=>void saveSpeak(!settings().voiceAutoSpeak));
    $('voice-auto-speak').addEventListener('change',event=>void saveSpeak(event.target.checked));
    $('voice-auto-send').addEventListener('change',async event=>{
      try{await api.saveSettings({voiceAutoSend:event.target.checked});getApp().data.settings.voiceAutoSend=event.target.checked;}catch(error){toast(error.message);render();}
    });
    api.on('message-added',({chatId,message})=>{
      if(chatId!==getApp()?.data?.activeChatId||message.role!=='assistant')return;
      messageId=message.id;spokenChars=0;
      messageSpeech=Boolean(settings().voiceAutoSpeak||voiceChat===chatId||voiceChat==='new');
      if(message.text)speakUpdates(message.id,message.text,!getApp().busy);
      if(message.text&&!getApp().busy)voiceChat=null;
    });
    api.on('message-delta',({chatId,messageId:id})=>{
      if(chatId!==getApp()?.data?.activeChatId)return;
      const message=getApp().data.chats.find(chat=>chat.id===chatId)?.messages.find(message=>message.id===id);
      if(message)speakUpdates(id,message.text||'');
    });
    api.on('message-replace',({chatId,messageId:id,text})=>{if(chatId===getApp()?.data?.activeChatId)speakUpdates(id,text);});
    api.on('busy',({busy})=>{
      if(busy)phase('thinking');
      else {
        const message=getApp().data.chats.flatMap(chat=>chat.messages).find(message=>message.id===messageId);
        if(message)speakUpdates(messageId,message.text||'',true);
        // Readiness probes also emit busy:false before an answer exists.
        // Keep the voice request armed until its assistant message completes.
        if(message&&messageSpeech)voiceChat=null;
        if(!draining&&!activeAudio)phase('idle');finishPlayback();
      }
    });
    api.on('chats-changed',data=>{
      if(voiceChat==='new'){voiceChat=data.activeChatId;selectedChat=data.activeChatId;return;}
      if(selectedChat!==data.activeChatId){
        selectedChat=data.activeChatId;voiceChat=null;messageSpeech=false;messageId=null;void cancel();
      }
    });
    render();const initialized=refresh();
    return {refresh,render,stopSpeech,initialized,press,release:()=>capture.release(),cancel,getPhase:()=>capture.phase};
  }
  if(typeof window!=='undefined')window.CODYVoice={attach,safeForSpeech,takeSentence};
  if(typeof module!=='undefined')module.exports={safeForSpeech,takeSentence};
})();

