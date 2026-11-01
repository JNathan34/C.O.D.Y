'use strict';
(() => {
  // Demo iframes in Settings never talk to the real desktop island.
  const demoMode = new URLSearchParams(location.search).has('demo');
  const api = demoMode ? null : (window.cody || null);
  const body = document.body;
  const island = document.getElementById('island');
  const panel = document.getElementById('quick-panel');
  const faceGaze = document.getElementById('face-gaze');
  const morphDot = document.getElementById('morph-dot');
  const layers = Object.fromEntries(['idle','listening','thinking','speaking','error','offline','restored'].map(key => [key,document.getElementById(`symbol-${key}`)]));
  const bars = [...document.querySelectorAll('.waveform i')];
  const micButton = document.getElementById('panel-mic');
  const note = document.getElementById('integration-note');
  const chatView = document.getElementById('view-chat');
  const settingsView = document.getElementById('view-settings');
  let activeView = 'chat';
  let micTestStream=null, micTestContext=null, micTestFrame=null;
  const input = document.getElementById('quick-input');
  const sendButton = document.getElementById('panel-send');
  const messages = document.getElementById('chat-messages');
  const emptyState = document.getElementById('empty-state');
  const shape = document.getElementById('island-shape');
  const shapePath = document.getElementById('island-path');
  const STATES = Object.keys(layers);
  const DEFAULTS = {
    visibility:'always',islandSize:'medium',animationSpeed:'normal',revealStyle:'liquid',
    idleReactions:'subtle',cursorTracking:true,blinkEnabled:true,reactiveExpressions:true,
    funReactions:true,sunglassesEnabled:true,pretendSleepEnabled:true,wifiReactions:true,
    startListeningOnHotkey:true,hotkeyMode:'hold',activityHideDelay:1600,
    enableHotkey:true,wakeWordEnabled:false,wakeHeyCody:true,wakeOkayCody:true,wakeCody:true,controlInputMode:'system',mascotLook:'blue',accentColor:'#9D9DFF',cursorColor:'accent',hideFloatingCursor:false,screenHighlight:true,shakeToDetach:true,voiceId:'',voiceRate:1,voicePitch:1,voiceVolume:1,micDeviceId:'',micSensitivity:1,visibility:'always'
  };
  let settings = {...DEFAULTS};
  let state = 'idle';
  let displayedState = 'idle';
  let panelOpen = false;
  let revealTimer = null, expressionTimer = null, transitionTimers = [];
  let nextBlink = performance.now()+4700;
  let nextGag = performance.now()+11000;
  let nextGlance = performance.now()+5400;
  let expression = 'normal';
  let followMouseMode = false;
  let cursor = {x:0,y:0,speed:0,near:false,hovered:false};
  let gaze = {x:0,y:0}, gazeTarget = {x:0,y:0};
  let lastCursorUpdate = performance.now();
  let lastFrame = performance.now();
  let lastSurprisedByMouse = 0;
  let audioTarget = 0, audioSmooth = 0, audioLastSample = 0;
  let micContext = null, micStream = null, micAnalyser = null, micFrame = null;
  let micTicket = 0, micRequested = false;
  let speechContext = null, speechAnalyser = null, speechAudio = null, speechFrame = null;
  let hotkeyActive = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const random = (min,max) => min + Math.random()*(max-min);
  let mediaPlaying=false;
  const presence=new window.CODYIdlePresence({now:()=>performance.now(),onChange:sleeping=>{
    body.classList.toggle('auto-sleeping',sleeping);body.classList.remove('is-blinking');
    gazeTarget={x:0,y:0};setExpression(sleeping?'sleepy':'normal',0,true);
    if(!sleeping){nextBlink=performance.now()+4500;nextGag=performance.now()+11000;}
  }});
  function wakeUp(){presence.interact();}
  function setMediaPlaying(value){const next=Boolean(value);if(next===mediaPlaying)return;mediaPlaying=next;wakeUp();body.classList.toggle('media-playing',next);if(next)setExpression('normal',0,true);}
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const normalMotion = () => settings.animationSpeed !== 'off' && !reducedMotion.matches;
  const motionFactor = () => settings.animationSpeed === 'slow' ? 1.4 : settings.animationSpeed === 'fast' ? .75 : 1;
  const defer = (fn,delay) => { const t=setTimeout(fn,delay);transitionTimers.push(t);return t; };

  // Keep the notch attached to the top of the screen at EVERY intermediate
  // animation size, with inverse shoulders and softly rounded lower corners.
  function updateIslandPath(){
    const w=island.clientWidth,h=island.clientHeight;
    if(!w || !h)return;
    const t=clamp((h-32)/388,0,1);
    const shoulder=41-14*t, neck=Math.min(h,32+12*t);
    const radius=Math.min(25*t,Math.max(0,(h-neck)/3));
    const endX=shoulder+radius;
    const f=n=>Number(n.toFixed(2));
    shape.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const k=.55228475,r=radius;
    // Restore the original compact notch, blending into the expanded shoulders.
    const progress=clamp((h-36)/80,0,1),blend=progress*progress*(3-2*progress);
    if(blend<1){
      const s=shoulder,n=neck,crest=13+7*t;
      const mix=(a,b)=>a+(b-a)*blend;
      // Split the expanded cubic at its midpoint to match the original two curves.
      const original=[11,0,15,crest*.5,19,crest,23,crest+9,25,n,s,n];
      const expanded=[.325*s,0,.575*s,.0875*n,.74375*s,.25625*n,.9125*s,.425*n,s,.675*n,s,n];
      const p=original.map((v,i)=>mix(v,expanded[i]));
      const right=p.map((v,i)=>f(i%2?v:w-v)),left=p.map(f);
      const corner=mix(2/3,k);
      shapePath.setAttribute('d',`M0 0 H${w} C${right.slice(0,6).join(' ')} C${right.slice(6).join(' ')} L${f(w-s)} ${f(h-r)} C${f(w-s)} ${f(h-r+corner*r)} ${f(w-endX+corner*r)} ${h} ${f(w-endX)} ${h} H${f(endX)} C${f(endX-corner*r)} ${h} ${f(s)} ${f(h-r+corner*r)} ${f(s)} ${f(h-r)} L${f(s)} ${f(n)} C${left[8]} ${left[9]} ${left[6]} ${left[7]} ${left[4]} ${left[5]} C${left[2]} ${left[3]} ${left[0]} ${left[1]} 0 0 Z`);
      return;
    }
    // Horizontal tangents at the screen edge, vertical tangents into the sides.
    shapePath.setAttribute('d',`M0 0 H${w} C${f(w-shoulder*.65)} 0 ${f(w-shoulder)} ${f(neck*.35)} ${f(w-shoulder)} ${f(neck)} L${f(w-shoulder)} ${f(h-r)} C${f(w-shoulder)} ${f(h-r+k*r)} ${f(w-endX+k*r)} ${h} ${f(w-endX)} ${h} H${f(endX)} C${f(endX-k*r)} ${h} ${f(shoulder)} ${f(h-r+k*r)} ${f(shoulder)} ${f(h-r)} L${f(shoulder)} ${f(neck)} C${f(shoulder)} ${f(neck*.35)} ${f(shoulder*.65)} 0 0 0 Z`);
  }
  new ResizeObserver(updateIslandPath).observe(island);
  updateIslandPath();
  function appendMessage(role,text){
    const node=document.createElement('div');
    node.className='message '+(role==='user'?'user':'assistant');
    node.textContent=String(text);
    messages.appendChild(node);
    emptyState.hidden=true;
    document.getElementById('conversation').scrollTop=document.getElementById('conversation').scrollHeight;
    return node;
  }
  function newConversation(){
    if(window.CODYIsland?.backendBusy){note.textContent='Finish or stop the current reply first.';return;}
    messages.replaceChildren();emptyState.hidden=false;input.value='';
    updateInput();note.textContent='';
    if(typeof window.CODYIsland?.onNewChat==='function') window.CODYIsland.onNewChat();
    input.focus();
  }
  function updateInput(){
    sendButton.disabled=!input.value.trim()||Boolean(window.CODYIsland?.backendBusy);
    input.style.height='24px';input.style.height=Math.min(input.scrollHeight,82)+'px';
  }
  function clearTransition() {
    transitionTimers.forEach(clearTimeout);
    transitionTimers=[];
    for(const layer of Object.values(layers))layer.classList.remove('is-active','is-collapsing');
    morphDot.classList.remove('morph-active');
  }
  // Every state passes through one central dot: current glyph contracts, ring colour
  // crossfades, then the next glyph grows from the dot. Interruption-safe for quick PTT.
  function morphTo(next) {
    clearTransition();
    if (!normalMotion()) {
      body.dataset.state=next;
      layers[next].classList.add('is-active');
      displayedState=next;
      return;
    }
    const old=layers[displayedState];
    old.classList.add('is-active');
    void old.offsetWidth;
    morphDot.classList.add('morph-active');
    requestAnimationFrame(()=>{
      old.classList.remove('is-active');
      old.classList.add('is-collapsing');
    });
    const rate=motionFactor();
    defer(()=>{body.dataset.state=next;},Math.round(100*rate));
    defer(()=>{
      old.classList.remove('is-collapsing');
      layers[next].classList.add('is-active');
      morphDot.classList.remove('morph-active');
      displayedState=next;
    },Math.round(185*rate));
  }
  function setExpression(name='normal', duration=0, force=false) {
    if(['crying','angry','sunglasses'].includes(name))name='normal';
    if(!force && (state!=='idle' || settings.idleReactions==='off' || !settings.reactiveExpressions))return;
    if(expressionTimer){clearTimeout(expressionTimer);expressionTimer=null;}
    if(name==='sunglasses'&&!settings.sunglassesEnabled&&!force)name='normal';
    if(name==='sleepy'&&!settings.pretendSleepEnabled&&!force)name='normal';
    if(name==='tracking'&&!settings.cursorTracking&&!force)name='normal';
    // Short natural wink (~220 ms), including animation studio previews.
    if(name==='wink')duration=220;
    if(name==='squint')duration=1250;
    followMouseMode = name==='tracking';
    expression=name;
    body.dataset.expression=name;
    if(duration)expressionTimer=setTimeout(()=>{
      expressionTimer=null;
      if(state==='idle')setExpression(cursor.hovered?'happy':cursor.near?'curious':'normal',0,true);
    },duration);
  }
  function blink(double=false,force=false) {
    if(state!=='idle'||(!force&&(settings.idleReactions==='off'||!settings.blinkEnabled))||expression==='sleepy'||expression==='squint')return;
    body.classList.remove('is-blinking');
    void body.offsetWidth;
    body.classList.add('is-blinking');
    setTimeout(()=>body.classList.remove('is-blinking'),160);
    if(double)setTimeout(()=>{if(state==='idle')blink(false,force);},245);
  }
  function pickIdleBehaviour(now){
    const playful=settings.idleReactions==='playful';
    const choices = !settings.funReactions ? ['happy','curious'] : playful ? ['wink','smug','surprised','confused','shy','squint','tracking','happy'] : ['wink','curious','happy','tracking','squint'];
    const choice=choices[Math.floor(Math.random()*choices.length)];
    setExpression(choice, choice==='sleepy'?5200:choice==='tracking'?3400:choice==='wink'?220:choice==='surprised'?520:random(950,1850));
    nextGag=now+random(playful?7200:15500,playful?13500:27000);
  }
  function applySettings(prefs) {
    settings={...settings,...prefs};
    const look=window.CODYLooks[settings.mascotLook]||window.CODYLooks.blue;
    body.style.setProperty('--mascot-filter',look.filter);
    const lookStatus=document.getElementById('mascot-look-status');if(lookStatus)lookStatus.textContent=look.name+' selected';
    body.dataset.mascotLook=settings.mascotLook||'blue';
    body.dataset.size=settings.islandSize;
    body.dataset.motion=settings.animationSpeed;
    body.dataset.style=settings.revealStyle;
    body.style.setProperty('--ui-accent',settings.accentColor||'#9D9DFF');
    refreshPreferences();
    if(settings.idleReactions==='off'){
      gazeTarget={x:0,y:0};
      setExpression('normal',0,true);
    }
    if(!settings.cursorTracking)gazeTarget={x:0,y:0};
    if(!normalMotion())body.classList.remove('is-blinking');
  }
  function applyCursor(sample){
    cursor={...cursor,...sample};
    if(cursor.hovered)wakeUp();
    if(presence.sleeping)return;
    lastCursorUpdate=performance.now();
    if(state!=='idle'||settings.idleReactions==='off')return;
    const trackingActive = settings.cursorTracking && (followMouseMode || cursor.hovered);
    if(trackingActive){
      // No part of the original eyes can leave the central ring: radius clamp + clipping.
      gazeTarget.x=clamp(cursor.x,-1,1)*(settings.idleReactions==='playful'?1.25:1.0);
      gazeTarget.y=clamp(cursor.y,-1,1)*.56;
    }else if(!expressionTimer){
      gazeTarget.x *= .5; gazeTarget.y *= .5;
    }
    if(!settings.reactiveExpressions||window.CODYIsland?.voiceCapturing)return;
    const now=performance.now();
    if(cursor.hovered){
      if(expressionTimer && ['sleepy','sunglasses','crying','angry','tracking'].includes(expression)){
        clearTimeout(expressionTimer); expressionTimer=null;
      }
      if(expression!=='happy') setExpression('happy',0,true);
      return;
    }
    if(expressionTimer)return;
    if(cursor.near&&cursor.speed>1200&&now-lastSurprisedByMouse>5500){
      lastSurprisedByMouse=now;
      setExpression('surprised',430);
    }else if(cursor.near && expression!=='curious'){
      setExpression('curious');
    }else if(!cursor.near && ['happy','curious'].includes(expression)){
      setExpression('normal');
    }
  }
  function showIsland(show){
    // Repeated state updates must not cancel an unfinished reveal/conceal.
    if(show?(body.dataset.reveal==='visible'||body.dataset.reveal==='entering'):(body.dataset.reveal==='hidden'||body.dataset.reveal==='leaving'))return;
    if(revealTimer){clearTimeout(revealTimer);revealTimer=null;}
    if(show){
      if(body.dataset.reveal==='visible'||body.dataset.reveal==='entering')return;
      body.dataset.reveal='entering';
      const duration = !normalMotion()||settings.revealStyle==='none'?0:420*motionFactor()+20;
      revealTimer=setTimeout(()=>{if(body.dataset.reveal==='entering')body.dataset.reveal='visible';revealTimer=null;},duration);
    }else{
      if(body.dataset.reveal==='hidden'||body.dataset.reveal==='leaving')return;
      body.dataset.reveal='leaving';
      const duration=!normalMotion()||settings.revealStyle==='none'?0:270*motionFactor()+30;
      revealTimer=setTimeout(()=>{
        if(body.dataset.reveal==='leaving'){
          body.dataset.reveal='hidden';
          api?.concealComplete?.();
        }
        revealTimer=null;
      },duration);
    }
  }
  function stopMicrophone(goIdle=true){
    if(goIdle&&typeof window.CODYIsland?.onStopListening==='function')return window.CODYIsland.onStopListening();
    micRequested=false;micTicket++;
    if(micFrame)cancelAnimationFrame(micFrame);
    micFrame=null;
    if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}
    if(micContext){void micContext.close().catch(()=>{});micContext=null;}
    micAnalyser=null;audioTarget=0;
    if(goIdle && (state==='listening'||state==='error'))setState('idle');
  }
  function stopSpeechMonitoring(){
    if(speechFrame)cancelAnimationFrame(speechFrame);
    speechFrame=null;
    if(speechAudio)speechAudio=null;
    speechAnalyser=null;
    if(speechContext){void speechContext.close().catch(()=>{});speechContext=null;}
  }
  function setState(next,notify=true){
    if(!STATES.includes(next))return;
    if(next!=='idle')wakeUp();
    if(next===state)return;
    if(next!=='listening' && (micRequested||micStream))stopMicrophone(false);
    if(next!=='speaking' && (speechContext||speechFrame))stopSpeechMonitoring();
    state=next;
    if(next!=='idle'){
      if(expressionTimer){clearTimeout(expressionTimer);expressionTimer=null;}
      setExpression('normal',0,true);
    }else{
      nextBlink=performance.now()+random(2700,5500);
      nextGag=performance.now()+random(6800,12500);
    }
    morphTo(next);
    micButton.setAttribute('aria-label',next==='listening'?'Stop listening':'Start listening');
    micButton.setAttribute('aria-pressed',String(next==='listening'));
    document.getElementById('mic-status').textContent=next==='listening'?'Listening…':'';
    audioTarget=0;audioLastSample=0;
    if(notify)api?.setState(next);
    if(!api)showIsland(true);
    document.dispatchEvent(new CustomEvent('cody:statechange',{detail:{state:next}}));
  }
  function setAudioLevel(level){
    audioTarget=clamp(Number(level)||0,0,1);
    audioLastSample=performance.now();
  }
  function animateFrame(now){
    presence.tick({engaged:state!=='idle'||Boolean(window.CODYIsland?.voiceCapturing)||Boolean(window.CODYIsland?.backendBusy)||cursor.hovered||body.classList.contains('timer-finished')||!settings.pretendSleepEnabled,mediaPlaying});
    const dt=clamp((now-lastFrame)/16.667,.4,4);
    lastFrame=now;
    if(state==='idle'&&!window.CODYIsland?.voiceCapturing&&!presence.sleeping){
      if(settings.idleReactions!=='off'){
        if(now>=nextBlink){blink(settings.idleReactions==='playful'&&Math.random()<.12);nextBlink=now+random(settings.idleReactions==='playful'?3300:5000,settings.idleReactions==='playful'?7500:12500);}
        if(!cursor.near && !cursor.hovered && !expressionTimer && now>=nextGag && settings.reactiveExpressions)pickIdleBehaviour(now);
        if(!followMouseMode && now-lastCursorUpdate>10000 && now>nextGlance){
          gazeTarget={x:random(-.9,.9),y:random(-.35,.35)};
          nextGlance=now+random(3500,6500);
        }
      }
      const follow=1-Math.pow(.875,dt);
      gaze.x+=(gazeTarget.x-gaze.x)*follow;
      gaze.y+=(gazeTarget.y-gaze.y)*follow;
      gaze.x=clamp(gaze.x,-1.35,1.35);
      gaze.y=clamp(gaze.y,-.7,.7);
      faceGaze.style.transform=`translate3d(${gaze.x.toFixed(2)}px,${gaze.y.toFixed(2)}px,0)`;
    }else if(Math.abs(gaze.x)+Math.abs(gaze.y)>.02){
      gaze.x*=.78;gaze.y*=.78;
      faceGaze.style.transform=`translate3d(${gaze.x.toFixed(2)}px,${gaze.y.toFixed(2)}px,0)`;
    }
    if(now-audioLastSample>180)audioTarget=0;
    const alpha=1-Math.pow(audioTarget>audioSmooth?.71:.84,dt);
    audioSmooth+=(audioTarget-audioSmooth)*alpha;
    const weights=[.45,.78,1,.77,.47];
    bars.forEach((bar,i)=>{
      const breathing=(.018*Math.sin(now/175+i*.85));
      const scale=clamp(.17 + audioSmooth*.87*weights[i] + breathing,.15,.98);
      bar.style.transform=`scaleY(${scale.toFixed(3)})`;
    });
    if(body.dataset.reveal==='hidden'&&!panelOpen){
      setTimeout(()=>requestAnimationFrame(animateFrame),180);
    }else requestAnimationFrame(animateFrame);
  }
  async function startMicrophone(){
    if(typeof window.CODYIsland?.onStartListening==='function')return window.CODYIsland.onStartListening();
    if(window.assistant)return;
    if(micRequested||state==='listening')return;
    micRequested=true;
    const ticket=++micTicket;
    setState('listening');
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone input unavailable');
      const constraint={echoCancellation:true,noiseSuppression:true,autoGainControl:true};
      if(settings.micDeviceId)constraint.deviceId={ideal:settings.micDeviceId};
      const stream=await navigator.mediaDevices.getUserMedia({audio:constraint});
      if(!micRequested||ticket!==micTicket||state!=='listening'){stream.getTracks().forEach(t=>t.stop());return;}
      micStream=stream;
      const context=new (window.AudioContext||window.webkitAudioContext)();
      micContext=context;
      const analyser=context.createAnalyser();
      analyser.fftSize=1024;analyser.smoothingTimeConstant=.72;
      context.createMediaStreamSource(stream).connect(analyser);
      micAnalyser=analyser;
      await context.resume();
      const samples=new Float32Array(analyser.fftSize);
      const sampleAudio=()=>{
        if(ticket!==micTicket||!micRequested||state!=='listening')return;
        analyser.getFloatTimeDomainData(samples);
        let power=0;
        for(let i=0;i<samples.length;i++)power+=samples[i]*samples[i];
        setAudioLevel(Math.sqrt(power/samples.length)*9*(settings.micSensitivity||1));
        micFrame=requestAnimationFrame(sampleAudio);
      };
      sampleAudio();
    }catch(error){
      if(ticket!==micTicket||!micRequested)return;
      console.warn('[C.O.D.Y.] Microphone:',error);
      stopMicrophone(false);
      note.textContent='Microphone unavailable. Check Windows microphone permissions.';
      setState('error');
      setTimeout(()=>{if(state==='error')setState('idle');},2200);
    }
  }
  async function connectSpeakingAudio(element,{play=true}={}){
    if(!(element instanceof HTMLMediaElement))throw new TypeError('Expected an HTML audio element');
    stopSpeechMonitoring();
    setState('speaking');
    const context=new (window.AudioContext||window.webkitAudioContext)();
    speechContext=context;
    const analyser=context.createAnalyser();analyser.fftSize=1024;
    context.createMediaElementSource(element).connect(analyser);
    analyser.connect(context.destination);
    speechAudio=element;speechAnalyser=analyser;
    const samples=new Float32Array(analyser.fftSize);
    const sampleAudio=()=>{
      if(state!=='speaking'||speechAnalyser!==analyser)return;
      analyser.getFloatTimeDomainData(samples);
      let power=0;
      for(let i=0;i<samples.length;i++)power+=samples[i]*samples[i];
      setAudioLevel(Math.sqrt(power/samples.length)*7);
      speechFrame=requestAnimationFrame(sampleAudio);
    };
    element.addEventListener('ended',()=>setState('idle'),{once:true});
    await context.resume();if(play)await element.play();sampleAudio();
  }
  function toggleMic(){
    if(typeof window.CODYIsland?.onToggleListening==='function')return window.CODYIsland.onToggleListening();
    if(window.assistant)return;
    if(state==='listening'||micRequested)stopMicrophone();
    else void startMicrophone();
  }
  function onHotkey(action){
    if(action==='down')wakeUp();
    if(typeof window.CODYIsland?.onVoiceHotkey==='function')return window.CODYIsland.onVoiceHotkey(action);
    if(window.assistant)return;
    if(!settings.startListeningOnHotkey){if(action==='down')togglePanel();return;}
    if(action==='down'){
      if(hotkeyActive)return;
      hotkeyActive=true;
      void startMicrophone();
      document.dispatchEvent(new CustomEvent('cody:push-to-talk-start'));
    }else if(action==='up'&&hotkeyActive){
      hotkeyActive=false;
      stopMicrophone();
      // Future speech-to-text integration finalises/sends on modifier release.
      document.dispatchEvent(new CustomEvent('cody:push-to-talk-release',{detail:{sendWhenTranscribed:true}}));
    }
  }
  function setActiveView(view){
    activeView=['settings','tasks','history'].includes(view)?view:'chat';
    const history=activeView==='history',historyView=document.getElementById('view-history');
    body.classList.toggle('history-open',history);historyView.setAttribute('aria-hidden',String(!history));historyView.inert=!history;historyView.classList.toggle('is-current',history);
    if(history)document.getElementById('history-conversation').append(chatView);else if(chatView.parentElement.id==='history-conversation')historyView.parentElement.prepend(chatView);
    body.classList.toggle('settings-open',activeView==='settings');
    body.classList.toggle('tasks-open',activeView==='tasks');
    const tasksView=document.getElementById('view-tasks');tasksView.setAttribute('aria-hidden',String(activeView!=='tasks'));tasksView.inert=activeView!=='tasks';tasksView.classList.toggle('is-current',activeView==='tasks');
    api?.setView?.(activeView);
    chatView.setAttribute('aria-hidden',String(activeView!=='chat'&&!history));
    settingsView.setAttribute('aria-hidden',String(activeView!=='settings'));
    chatView.inert=activeView!=='chat'&&!history;
    settingsView.inert=activeView!=='settings';
    chatView.classList.toggle('is-current',activeView==='chat'||history);
    settingsView.classList.toggle('is-current',activeView==='settings');
    document.getElementById('panel-settings').classList.toggle('is-selected',activeView==='settings');
    document.getElementById('panel-settings').setAttribute('aria-label',activeView==='settings'?'Back to chat':'Settings');
    document.dispatchEvent(new CustomEvent('cody:view-changed',{detail:activeView}));
    if(activeView==='chat'&&!window.assistant&&document.getElementById('chat-connection'))document.getElementById('chat-connection').textContent = window.CODYIsland?.backendConnected?'Connected to C.O.D.Y. backend':'Not connected in standalone GUI';
  }
  function setPanelOpen(next,notify=true){
    if(next)wakeUp();
    if(next&&!panelOpen)setActiveView('chat');
    panelOpen=Boolean(next);
    body.classList.toggle('panel-open',panelOpen);
      document.dispatchEvent(new CustomEvent('cody:panel-change',{detail:{open:panelOpen}}));
    api?.setView?.(activeView);
    island.setAttribute('aria-expanded',String(panelOpen));
    panel.setAttribute('aria-hidden',String(!panelOpen));
    panel.inert=!panelOpen;
    island.tabIndex=panelOpen?-1:0;
    if(notify)api?.expand(panelOpen);
    if(panelOpen && activeView==='chat')setTimeout(()=>{if(panelOpen && activeView==='chat')input.focus({preventScroll:true});},290);
    if(!panelOpen){stopMicTest();try{speechSynthesis.cancel();}catch{}}
  }
  function togglePanel(value=!panelOpen){setPanelOpen(value);}
  async function sendPrompt(){
    const prompt=input.value.trim();
    if(!prompt || sendButton.disabled)return;
    if(typeof window.CODYIsland.onPrompt!=='function'&&!window.CODYIsland.backendConnected){
      note.textContent="Connect your main C.O.D.Y. backend to enable chat.";
      return;
    }
    if(!window.CODYIsland.managedChat)appendMessage('user',prompt);input.value='';updateInput();
    note.textContent='';
    document.dispatchEvent(new CustomEvent('cody:prompt',{detail:{prompt}}));
    if(typeof window.CODYIsland.onPrompt==='function'){
      setState('thinking');
      try{
        const result=await window.CODYIsland.onPrompt(prompt);
        if(typeof result==='string')appendMessage('assistant',result);
        else if(result&&typeof result.text==='string')appendMessage('assistant',result.text);
        if(state==='thinking'&&!window.CODYIsland.backendBusy)setState('idle');
      }catch(error){
        console.error(error);appendMessage('assistant','Could not send: '+error.message);
        setState('error');
      }
    }else{
      setState('thinking');
    }
  }
  // Preferences shown here are real persisted app settings, not disconnected decorative controls.
  function refreshPreferences(){
    document.querySelectorAll('[data-pref]').forEach(control=>{
      const name=control.dataset.pref;
      if(!(name in settings))return;
      if(control.tagName==='SELECT' && name==='voiceId' && settings.voiceId && ![...control.options].some(o=>o.value===settings.voiceId))return;
      if(control.tagName==='SELECT' && name==='micDeviceId' && settings.micDeviceId && ![...control.options].some(o=>o.value===settings.micDeviceId))return;
      if(control.type==='checkbox')control.checked=Boolean(settings[name]);
      else control.value=String(settings[name]);
    });
    document.querySelectorAll('[data-accent]').forEach(button=>{
      const selected=button.dataset.accent===settings.accentColor;
      button.classList.toggle('selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    document.querySelectorAll('[data-mascot-look]').forEach(button=>{const selected=button.dataset.mascotLook===(settings.mascotLook||'blue');button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    document.querySelectorAll('[data-cursor-color]').forEach(button=>{const selected=button.dataset.cursorColor===(settings.cursorColor||'accent');button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
    for(const name of ['voiceRate','voicePitch','voiceVolume','micSensitivity']){
      const output=document.querySelector(`[data-for="${name}"]`);
      if(output)output.textContent=name==='voiceVolume'?Math.round(Number(settings[name]??1)*100)+'%':Number(settings[name]??1).toFixed(name==='micSensitivity'?1:2)+(name==='voicePitch'?'':'×');
    }
    document.querySelectorAll('[data-speed]').forEach(button=>{const active=Math.abs(Number(button.dataset.speed)-Number(settings.voiceRate))<.001;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
    pauseReactions.checked=settings.idleReactions==='off';
    if(!window.assistant&&document.getElementById('chat-connection'))document.getElementById('chat-connection').textContent = window.CODYIsland?.backendConnected?'Connected to C.O.D.Y. backend':'Not connected in standalone GUI';
  }
  async function savePreference(key,value){
    if(!(key in settings))return;
    const previous=settings[key];
    settings={...settings,[key]:value};
    applySettings(settings);
    if(api){
      try{const saved=await api.updateSettings({[key]:value});applySettings(saved);}
      catch(error){console.warn('[C.O.D.Y.] Preference save failed:',error);settings[key]=previous;applySettings(settings);}
    }
  }
  // Local audio meter is only active after the user explicitly starts a test.
  function stopMicTest(){
    if(micTestFrame){cancelAnimationFrame(micTestFrame);micTestFrame=null;}
    if(micTestStream){micTestStream.getTracks().forEach(track=>track.stop());micTestStream=null;}
    if(micTestContext){void micTestContext.close().catch(()=>{});micTestContext=null;}
    const testButton=document.getElementById('request-mic-permission');
    if(testButton)testButton.textContent='Test microphone';
    document.querySelectorAll('#mic-meter i').forEach(bar=>{bar.classList.remove('active');bar.style.height='11px';});
  }
  const pauseReactions=document.getElementById('pause-reactions');
  pauseReactions.checked=settings.idleReactions==='off';
  pauseReactions.addEventListener('change',()=>void savePreference('idleReactions',pauseReactions.checked?'off':'subtle'));
  document.querySelectorAll('[data-speed]').forEach(button=>button.addEventListener('click',()=>void savePreference('voiceRate',Number(button.dataset.speed))));
  document.getElementById('permission-check-mic').addEventListener('click',()=>void getMicrophoneAccess());
  function setSettingsTab(tab){
    if(tab==='developer'){api?.openSettings();return;}
    stopMicTest();
    document.querySelectorAll('.nav-item').forEach(item=>{
      item.classList.toggle('selected',item.dataset.tab===tab);
      item.setAttribute('aria-current',item.dataset.tab===tab?'page':'false');
    });
    document.querySelectorAll('.settings-tab').forEach(item=>{
      const showing=item.dataset.content===tab;
      item.hidden=!showing;item.classList.toggle('selected',showing);
    });
    document.getElementById('settings-content').scrollTop=0;
  }
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>setSettingsTab(button.dataset.tab)));
  document.querySelectorAll('[data-pref]').forEach(control=>{
    const callback=()=>{
      const key=control.dataset.pref;
      const value=control.type==='checkbox'?control.checked:control.type==='range'?Number(control.value):control.value;
      void savePreference(key,value);
    };
    control.addEventListener(control.type==='range'?'input':'change',callback);
  });
  const mascotOptions=document.getElementById('mascot-options');
  for(const [id,look] of Object.entries(window.CODYLooks)){
    const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');
    button.type='button';button.className='voice-option mascot-option';button.dataset.mascotLook=id;button.style.setProperty('--voice-color',look.color);
    button.setAttribute('aria-label',look.name+' C.O.D.Y.');image.src='../../../assets/brand/cody-64.png';image.alt='';image.style.filter=look.filter;image.draggable=false;label.textContent=look.name;button.append(image,label);
    button.addEventListener('click',async()=>{await savePreference('mascotLook',id);const saved=window.CODYLooks[settings.mascotLook]||window.CODYLooks.blue;document.getElementById('mascot-look-status').textContent=saved.name+' selected';});mascotOptions.append(button);
  }
  const accentOptions=document.querySelector('[aria-label="Accent colour"]'),cursorOptions=document.querySelector('.cursor-options');
  for(const look of Object.values(window.CODYLooks)){
    const swatch=document.createElement('button');swatch.type='button';swatch.className='swatch';swatch.dataset.accent=look.color;swatch.setAttribute('aria-label',look.name);swatch.style.setProperty('--swatch',look.color);accentOptions.append(swatch);
    const button=document.createElement('button'),preview=document.createElement('span'),label=document.createElement('span');button.type='button';button.className='cursor-option';button.dataset.cursorColor=look.color;button.style.setProperty('--cursor-option',look.color);preview.className='cursor-option-preview';preview.setAttribute('aria-hidden','true');label.textContent=look.name;button.append(preview,label);cursorOptions.append(button);
  }
  refreshPreferences();
  document.querySelectorAll('[data-accent]').forEach(button=>button.addEventListener('click',()=>{
    void savePreference('accentColor',button.dataset.accent);
  }));
  document.querySelectorAll('[data-cursor-color]').forEach(button=>button.addEventListener('click',()=>void savePreference('cursorColor',button.dataset.cursorColor)));
  function enumerateVoices(){
    if(window.assistant)return;
    if(!('speechSynthesis' in window))return;
    const voices=window.speechSynthesis.getVoices();
    const select=document.getElementById('voice-choices');
    const selected=settings.voiceId;
    select.replaceChildren(new Option('System default',''));
    for(const voice of voices){select.add(new Option(`${voice.name} (${voice.lang})`,voice.voiceURI));}
    select.value=[...select.options].some(o=>o.value===selected)?selected:'';
  }
  enumerateVoices();
  if('speechSynthesis' in window)speechSynthesis.addEventListener('voiceschanged',enumerateVoices);
  document.getElementById('preview-voice').addEventListener('click',()=>{
    if(window.assistant)return;
    if(!('speechSynthesis' in window))return;
    speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance('Hello! I am C.O.D.Y., your desktop assistant.');
    const match=speechSynthesis.getVoices().find(v=>v.voiceURI===settings.voiceId);
    if(match)utterance.voice=match;
    utterance.rate=settings.voiceRate||1;utterance.pitch=settings.voicePitch||1;utterance.volume=settings.voiceVolume??1;
    speechSynthesis.speak(utterance);
  });
  async function getMicrophoneAccess(){
    if(window.CODYIsland?.voiceCapturing)return;
    const label=document.getElementById('mic-permission-status');
    if(!navigator.mediaDevices?.getUserMedia){label.textContent='Unavailable in this browser';return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const devices=await navigator.mediaDevices.enumerateDevices();
      stream.getTracks().forEach(track=>track.stop());
      const select=document.getElementById('mic-choices');
      const selected=settings.micDeviceId;
      select.replaceChildren(new Option('System default',''));
      devices.filter(d=>d.kind==='audioinput').forEach((d,index)=>select.add(new Option(d.label||`Microphone ${index+1}`,d.deviceId)));
      select.value=[...select.options].some(o=>o.value===selected)?selected:'';
      label.textContent='Available for voice input';
    }catch(error){label.textContent=error.name==='NotAllowedError'?'Access denied by Windows or app':'Could not access microphone';}
  }
  document.getElementById('refresh-microphones').addEventListener('click',()=>void getMicrophoneAccess());
  document.getElementById('request-mic-permission').addEventListener('click',async()=>{
    if(window.CODYIsland?.voiceCapturing){note.textContent='Finish voice input before testing the microphone.';return;}
    if(micTestStream){stopMicTest();return;}
    try{
      const constraint=settings.micDeviceId?{deviceId:{ideal:settings.micDeviceId}}:true;
      const stream=await navigator.mediaDevices.getUserMedia({audio:constraint});
      if(!panelOpen||activeView!=='settings'||document.querySelector('[data-content="microphone"]').hidden){stream.getTracks().forEach(t=>t.stop());return;}
      micTestStream=stream;
      const ctx=new (window.AudioContext||window.webkitAudioContext)();micTestContext=ctx;
      const analyser=ctx.createAnalyser();analyser.fftSize=1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      await ctx.resume();
      const data=new Uint8Array(analyser.frequencyBinCount);
      const meter=[...document.querySelectorAll('#mic-meter i')];
      document.getElementById('request-mic-permission').textContent='Stop test';
      document.getElementById('mic-permission-status').textContent='Listening to test audio';
      const update=()=>{
        if(!micTestStream)return;
        analyser.getByteFrequencyData(data);
        const level=Math.min(1,Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length)/130);
        meter.forEach((bar,i)=>{const v=Math.max(.08,level*(.54+.46*Math.sin(i*.72+performance.now()/150)));bar.style.height=(8+v*26)+'px';bar.classList.toggle('active',v>.18);});
        micTestFrame=requestAnimationFrame(update);
      };update();
    }catch(error){stopMicTest();document.getElementById('mic-permission-status').textContent=error.name==='NotAllowedError'?'Microphone permission denied':'Microphone unavailable';}
  });
  island.addEventListener('click',event=>{
    if(event.target.closest('button,textarea,select,input,label,nav,.settings-content'))return;
    if(panelOpen){
      // The little mascot at the top is also a collapse target.
      const rect=island.getBoundingClientRect();
      if(Math.abs(event.clientX-(rect.left+rect.width/2))<40 && event.clientY<rect.top+42)togglePanel(false);
      return;
    }
    if(state==='idle'&&settings.reactiveExpressions)setExpression('surprised',350);
    togglePanel(true);
  });
  island.addEventListener('mouseenter',()=>{wakeUp();if(state==='idle'&&settings.reactiveExpressions&&!window.CODYIsland?.voiceCapturing){if(expressionTimer&&['sleepy','sunglasses','crying','angry','tracking'].includes(expression)){clearTimeout(expressionTimer);expressionTimer=null;} setExpression('happy',0,true);}});
  for(const event of ['pointerdown','pointermove'])island.addEventListener(event,wakeUp,{capture:true,passive:true});
  for(const event of ['keydown','input'])document.addEventListener(event,wakeUp,true);
  island.addEventListener('mouseleave',()=>{if(state==='idle'&&!cursor.near&&!expressionTimer)setExpression('normal');});
  island.addEventListener('keydown',event=>{if(event.target===island&&!panelOpen&&(event.key==='Enter'||event.key===' ')){event.preventDefault();togglePanel(true);}});
  document.getElementById('new-chat').addEventListener('click',()=>{setActiveView(activeView==='history'?'history':'chat');newConversation();});
  document.querySelectorAll('[data-suggestion]').forEach(button=>button.addEventListener('click',()=>{
    input.value=button.dataset.suggestion;updateInput();input.focus();
  }));
  input.addEventListener('input',updateInput);
  updateInput();
  refreshPreferences();
  micButton.addEventListener('click',toggleMic);
  document.getElementById('panel-settings').addEventListener('click',()=>setActiveView(activeView==='settings'?'chat':'settings'));
  document.getElementById('panel-send').addEventListener('click',sendPrompt);
  document.getElementById('quick-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendPrompt();}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panelOpen&&!event.target.closest?.('select:open')){if(activeView!=='chat')setActiveView('chat');else togglePanel(false);}});
  if(api){
    api.onHotkey(onHotkey);
    api.onCommand(action=>{
      if(action==='start')void startMicrophone();else if(action==='stop')stopMicrophone();
      else if(action==='chat'){setActiveView('chat');setPanelOpen(true,false);}
    });
    api.onState(next=>{if(next!==state)setState(next,false);});
    api.onSettings(applySettings);api.onAudioLevel(setAudioLevel);
    api.onCursor(applyCursor);api.onVisibility(showIsland);
    api.onExpanded(next=>{if(panelOpen!==next)setPanelOpen(next,false);});
    api.onShowSettings(()=>{if(!panelOpen)setPanelOpen(true,false);setActiveView('settings');});
    Promise.all([api.getSettings(),api.getState()]).then(([prefs,current])=>{
      applySettings(prefs);
      if(current!=='idle')setState(current,false);
    }).catch(console.error);
  }else{
    // Browser preview shares the real renderer, but cannot provide Windows global keys.
    showIsland(true);
    window.addEventListener('mousemove',event=>{
      const bounds=island.getBoundingClientRect();
      const mx=bounds.left+bounds.width/2;
      const my=bounds.top+bounds.height/2;
      const distance=Math.hypot(event.clientX-mx,event.clientY-my);
      applyCursor({x:(event.clientX-mx)/210,y:(event.clientY-my)/130,near:distance<100,hovered:distance<18,speed:0});
    });
  }
  // Cross-frame animation studio protocol. postMessage works reliably even
  // when file:// pages have different/opaque origins in Chromium or Electron.
  // Only accepted in the explicitly marked demo renderer.
  if (demoMode && window.parent !== window) {
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.data?.namespace !== 'CODY-ANIMATION-TEST') return;
      const {action, args=[]} = event.data;
      const test = window.CODYIsland;
      if (!test || !Array.isArray(args)) return;
      const safe = new Set(['showIsland','setState','setAudioLevel','applySettings','applyCursor','previewExpression','previewBlink','togglePanel','setActiveView']);
      if (safe.has(action) && typeof test[action] === 'function') {
        try { test[action](...args); } catch(err) { console.warn('[C.O.D.Y. demo]',err); }
      }
    });
  }
  window.CODYIsland={
    setState,setAudioLevel,connectSpeakingAudio,stopMicTest,setSettingsTab,updateInput,wakeUp,setMediaPlaying,resetExpression:()=>setExpression('normal',0,true),
    startListening:()=>void startMicrophone(),stopListening:()=>stopMicrophone(),
    togglePanel,getState:()=>state,onPrompt:null,onNewChat:null,backendConnected:false,
    appendMessage,newConversation,setActiveView,
    applySettings,showIsland,applyCursor,
    playExpression:(name,duration)=>setExpression(name,duration),
    previewExpression:(name,duration=2100)=>{setState('idle');setExpression(name,duration,true);},
    previewBlink:(double=false)=>{setState('idle');setExpression('normal',0,true);blink(double,true);},
    getExpression:()=>expression,
    simulateHotkey:onHotkey // local renderer test hook; native keyboard watcher remains in main.js
  };
  document.dispatchEvent(new Event('cody:island-ready'));
  requestAnimationFrame(animateFrame);
})();
