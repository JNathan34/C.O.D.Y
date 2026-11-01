'use strict';
// Preserve the C.O.D.Y. DOM and icons; microphone capture and speech live in CODY.
(()=>{
  function attach({api,$,toast,getApp,onBeforeCapture=()=>{},bindMicrophone=true}){
    let phase='idle';
    const mic=$('voice-mic'),speaker=$('voice-speaker'),status=$('voice-connection-status');
    const setPhase=value=>{phase=value;mic?.classList.toggle('recording',value==='listening');mic?.classList.toggle('working',value==='thinking');mic?.setAttribute('aria-pressed',String(value==='listening'));window.dispatchEvent(new CustomEvent('cody:voice-state',{detail:{phase:value}}));};
    const report=error=>{if(status)status.textContent=error.message;toast(error.message);setPhase('idle');};
    const voiceStyles={cedar:['#47A8FF','none'],marin:['#9D9DFF','hue-rotate(60deg)'],alloy:['#F5F5F5','grayscale(1) brightness(1.6)'],ash:['#FFB067','hue-rotate(190deg)'],ballad:['#F377BC','hue-rotate(115deg)'],coral:['#F87171','hue-rotate(155deg)'],echo:['#F4D35E','hue-rotate(215deg)'],sage:['#4ADE80','hue-rotate(-70deg)'],shimmer:['#22D3C5','hue-rotate(-30deg)'],verse:['#C084FC','hue-rotate(85deg)']};
    let selectedVoice='cedar',choosingVoice=false;
    function updateVoiceSelection(){for(const button of document.querySelectorAll('#voice-options [data-voice-id]')){const selected=button.dataset.voiceId===selectedVoice;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}}
    function renderVoiceOptions(voices,selected){
      const grid=document.getElementById('voice-options');if(!grid)return;selectedVoice=selected;grid.replaceChildren();
      for(const voice of voices){
        const [color,filter]=voiceStyles[voice.id]||voiceStyles.cedar,button=document.createElement('button'),icon=document.createElement('img'),label=document.createElement('span');
        button.type='button';button.className='voice-option';button.dataset.voiceId=voice.id;button.style.setProperty('--voice-color',color);button.setAttribute('aria-label',voice.name+' voice');
        icon.src='../../../assets/brand/cody-256.png';icon.alt='';icon.style.filter=filter;icon.draggable=false;label.textContent=voice.name;button.append(icon,label);
        button.addEventListener('click',async()=>{
          if(choosingVoice||selectedVoice===voice.id)return;choosingVoice=true;const previous=selectedVoice;selectedVoice=voice.id;updateVoiceSelection();
          for(const tile of grid.children)tile.disabled=true;
          try{await api.voice.configure({voice:voice.id});const select=$('voice-choice');if(select)select.value=voice.id;}
          catch(error){selectedVoice=previous;updateVoiceSelection();report(error);}
          finally{choosingVoice=false;for(const tile of grid.children)tile.disabled=false;}
        });grid.append(button);
      }updateVoiceSelection();
    }
    function render(){const settings=getApp().data.settings;window.CODYIcons?.set(speaker,settings.voiceAutoSpeak?'volume-2':'volume-x');speaker?.setAttribute('aria-pressed',String(Boolean(settings.voiceAutoSpeak)));if($('voice-auto-speak'))$('voice-auto-speak').checked=Boolean(settings.voiceAutoSpeak);if($('voice-auto-send'))$('voice-auto-send').checked=true;}
    async function refresh(){const current=await api.voice.status();const catalog=await api.voice.voices();const select=$('voice-choice');if(select){select.replaceChildren(...catalog.voices.map(v=>new Option(v.name,v.id)));select.value=current.voice||'cedar';}renderVoiceOptions(catalog.voices,current.voice||'cedar');for(const [id,label]of [['voice-engine','CODY'],['voice-recognition','CODY native']]){const element=$(id);if(element){element.replaceChildren(new Option(label,'heyclicky'));element.disabled=true;}}const language=$('voice-language');if(language){language.replaceChildren(new Option('English','en'),new Option('Automatic (multilingual)','multi'));language.disabled=false;language.value=current.recognitionLanguage||'en';}if(status)status.textContent=current.signedIn?'Ready — hold Ctrl+Alt, speak, then release.':'Sign in to CODY in Plugins.';if($('recognition-model-status'))$('recognition-model-status').textContent='CODY native speech recognition';render();return current;}
    async function press(){if(phase==='speaking'){await api.voice.cancel().catch(()=>{});setPhase('idle');}if(phase!=='idle'||getApp().busy)return;try{onBeforeCapture();setPhase('starting');await api.voice.begin();}catch(error){report(error);}}
    async function release(){if(!['starting','listening'].includes(phase))return;setPhase('thinking');try{await api.voice.end();}catch(error){report(error);}}
    async function cancel(){await api.voice.cancel().catch(report);setPhase('idle');}
    function stopSpeech(){void api.voice.stopSpeech().catch(()=>{});}
    api.on('native-phase',data=>setPhase(({Idle:'idle',Listening:'listening',Processing:'thinking',Responding:'speaking'})[data.state]||'idle'));
    api.on('native-meter',data=>window.dispatchEvent(new CustomEvent('cody:audio-level',{detail:{level:data.level||0}})));
    const saveSpeak=async value=>{await api.saveSettings({voiceAutoSpeak:value});getApp().data.settings.voiceAutoSpeak=value;render();};
    speaker?.addEventListener('click',()=>void saveSpeak(!getApp().data.settings.voiceAutoSpeak).catch(report));
    $('voice-auto-speak')?.addEventListener('change',event=>void saveSpeak(event.target.checked).catch(report));
    $('voice-auto-send')?.addEventListener('change',event=>{event.target.checked=true;toast('CODY submits the recording when you release the microphone.');});
    $('voice-choice')?.addEventListener('change',event=>void api.voice.configure({voice:event.target.value}).catch(report));
    $('voice-language')?.addEventListener('change',event=>void api.voice.configure({recognitionLanguage:event.target.value}).catch(report));
    for(const id of ['voice-save','voice-install','recognition-install'])$(id)?.addEventListener('click',()=>void refresh().catch(report));
    $('voice-test')?.addEventListener('click',()=>void api.voice.preview().catch(report));
    $('mic-record-check')?.addEventListener('click',()=>{if(phase==='listening')void release();else void press();});
    if(bindMicrophone)mic?.addEventListener('click',()=>{if(phase==='listening')void release();else void press();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&phase!=='idle')void cancel();});
    render();const initialized=refresh().catch(report);
    return {render,refresh,initialized,press,release,cancel,stopSpeech,getPhase:()=>phase};
  }
  window.CODYVoice={attach};
})();
