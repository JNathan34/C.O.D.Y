'use strict';
(async()=>{
  const fallback={visibility:'always',idleReactions:'subtle',cursorTracking:true,blinkEnabled:true,
    reactiveExpressions:true,funReactions:true,sunglassesEnabled:true,pretendSleepEnabled:true,wifiReactions:true,islandSize:'medium',animationSpeed:'normal',revealStyle:'liquid',
    activityHideDelay:1600,enableHotkey:true,hotkeyMode:'hold',startListeningOnHotkey:true,launchAtLogin:false};
  const api=window.cody||null;
  let current=api?await api.getSettings():{...fallback};
  const keys=Object.keys(fallback);
  const save=document.getElementById('save-message');
  function display(prefs){
    current={...current,...prefs};
    for(const key of keys){
      if(key==='visibility'){
        const el=document.querySelector(`input[name="visibility"][value="${current.visibility}"]`);
        if(el)el.checked=true;
        continue;
      }
      const el=document.getElementById(key);
      if(!el)continue;
      if(el.type==='checkbox')el.checked=Boolean(current[key]);
      else el.value=String(current[key]);
    }
  }
  async function update(event){
    const control=event.target;
    const name=control.name||control.id;
    if(!keys.includes(name))return;
    const value=control.type==='checkbox'?control.checked:name==='activityHideDelay'?Number(control.value):control.value;
    current[name]=value;
    save.textContent='Saving…';
    try{if(api)current=await api.updateSettings({[name]:value});save.textContent='Changes saved';}
    catch(error){console.error(error);save.textContent='Could not save';}
    display(current);
  }
  display(current);
  document.querySelectorAll('input,select').forEach(element=>element.addEventListener('change',update));
  document.getElementById('preview').addEventListener('click',()=>{document.getElementById('animation-preview').scrollIntoView({behavior:'smooth'});});
  if(api){
    api.onSettings(display);
    api.onAnimationPreview(()=>document.getElementById('animation-preview').scrollIntoView({behavior:'smooth'}));
    api.onNetwork(status=>setNetworkStatus(status));
    api.getNetworkStatus().then(setNetworkStatus).catch(()=>{});
  }
  function setNetworkStatus(status){
    const label=document.getElementById('network-status-text');
    const indicator=document.getElementById('network-status');
    if(!status?.wifiKnown){
      label.textContent=status?.platform==='win32'?'Waiting for Windows Wi-Fi status…':'Live monitoring is Windows-only';
      indicator.dataset.status='unknown';
    }else{
      label.textContent=status.offline?'Wi-Fi disconnected':'Wi-Fi connected';
      indicator.dataset.status=status.offline?'offline':'online';
    }
  }
  const frame=document.getElementById('animation-frame');
  let previewApi=null, previewState='idle', demoTimer=null, demoTimers=[];
  const title=document.getElementById('animation-title');
  const description=document.getElementById('animation-description');
  const voiceSlider=document.getElementById('audio-level');
  let playbackTimer=null;
  const STATE_DESCRIPTIONS={
    idle:'Original smiling eyes, with subtle cursor tracking and natural expressions.',
    listening:'Five narrow cyan bars. Move the waveform slider to test different microphone levels.',
    thinking:'Five magenta dots cycle while the ring stays perfectly still.',
    speaking:'Five orange bars react to simulated speech volume.',
    offline:'Coral dot stays visible as three smaller arcs build one at a time, then reset to the dot. Real Wi-Fi is not affected.',
    restored:'Blue arcs fill one by one, stay visible briefly, then C.O.D.Y. returns to idle.',
    error:'A short error reaction inside the original signature ring.'
  };
  function clearDemo(){
    if(demoTimer){clearInterval(demoTimer);demoTimer=null;}
    demoTimers.forEach(clearTimeout);demoTimers=[];
  }
  function later(fn,delay){demoTimers.push(setTimeout(fn,delay));}
  // Communicate with the isolated preview via postMessage. This also works
  // in browsers that isolate file:// iframes from their parent origin.
  function demo(){
    if(!frame.contentWindow)return null;
    const send=(action,...args)=>frame.contentWindow.postMessage({namespace:'CODY-ANIMATION-TEST',action,args},'*');
    return Object.fromEntries(['showIsland','setState','setAudioLevel','applySettings','applyCursor','previewExpression','previewBlink']
      .map(action=>[action,(...args)=>send(action,...args)]));
  }
  function showLabel(name,text){title.textContent=name;description.textContent=text;}
  function resetPreview(){
    clearDemo();previewState='idle';
    const c=demo();if(!c)return;
    c.showIsland(true);c.applySettings({...current,visibility:'always',idleReactions:'subtle'});
    c.setState('idle');c.previewExpression('normal',0);c.setAudioLevel(0);
    showLabel('Idle · Your C.O.D.Y. mascot','Choose an animation below to test it here.');
  }
  function auditionState(which){
    clearDemo();const c=demo();if(!c)return;
    c.showIsland(true);
    if(which==='reveal'){
      c.setState('idle');c.showIsland(false);
      showLabel('Liquid reveal','The island retracts into the screen edge, then flows back down.');
      later(()=>c.showIsland(true),600);return;
    }
    if(which==='wifi-restored'){
      c.setState('restored');previewState='restored';
      showLabel('Wi-Fi restored',STATE_DESCRIPTIONS.restored);
      later(()=>{c.setState('idle');c.previewExpression('happy',650);previewState='idle';},1950);return;
    }
    previewState=which;
    c.setState(which);
    showLabel(which==='offline'?'Wi-Fi disconnected':which[0].toUpperCase()+which.slice(1),STATE_DESCRIPTIONS[which]||'');
    if(['listening','speaking'].includes(which)){
      const started=performance.now();
      demoTimer=setInterval(()=>{
        const t=(performance.now()-started)/1000;
        c.setAudioLevel(Math.min(1,Math.max(.08,Number(voiceSlider.value)/100*(.68+.24*Math.sin(t*7)+.14*Math.sin(t*13)))));
      },45);
    }
  }
  function auditionExpression(name){
    clearDemo();const c=demo();if(!c)return;
    c.showIsland(true);c.setState('idle');previewState='idle';
    showLabel(name==='doubleblink'?'Double blink':name[0].toUpperCase()+name.slice(1),
      name==='squint'?'The original eyes gently narrow, hold, and open again.':
      name==='mouse'?'C.O.D.Y. briefly enters a follow-the-mouse mood instead of tracking all the time.':'A short idle expression preview.');
    if(name==='blink'||name==='doubleblink'){
      later(()=>c.previewBlink(name==='doubleblink'),350);
    }else if(name==='mouse'){
      const sequence=[-1,-.5,.6,1,0], started=performance.now();
      sequence.forEach((x,i)=>later(()=>c.applyCursor({x,y:.25*Math.sin(i),speed:200,near:false,hovered:false}),i*500+300));
    }else later(()=>c.previewExpression(name,2400),230);
  }
  function stopPlayAll(){if(playbackTimer)clearInterval(playbackTimer);playbackTimer=null;}
  document.querySelectorAll('[data-state-test]').forEach(button=>button.addEventListener('click',()=>{stopPlayAll();auditionState(button.dataset.stateTest);}));
  document.querySelectorAll('[data-expression-test]').forEach(button=>button.addEventListener('click',()=>{stopPlayAll();auditionExpression(button.dataset.expressionTest);}));
  document.getElementById('stop-preview').addEventListener('click',()=>{if(playbackTimer)clearInterval(playbackTimer);playbackTimer=null;resetPreview();});
  frame.addEventListener('load',()=>{
    const c=demo();if(c){previewApi=c; c.applySettings({...current,visibility:'always',idleReactions:'subtle'});c.showIsland(true);}
  });
  // The preview is isolated from the real overlay; this sequential test never
  // activates the microphone, changes settings, or disconnects Wi-Fi.
  document.getElementById('play-all').addEventListener('click',()=>{
    clearDemo();if(playbackTimer)clearInterval(playbackTimer);playbackTimer=null;
    const steps=[
      ['idle'],['blink','expression'],['wink','expression'],['squint','expression'],
      ['sleepy','expression'],['mouse','expression'],['listening'],['thinking'],['speaking'],
      ['offline'],['wifi-restored'],['error'],['reveal']
    ];
    let index=0;
    const next=()=>{
      if(index>=steps.length){clearInterval(playbackTimer);playbackTimer=null;return;}
      const [value,type]=steps[index++];
      if(type==='expression')auditionExpression(value);
      else auditionState(value);
    };
    // Each audition resets its own simulated waveform; this interval is independent.
    if(playbackTimer)clearInterval(playbackTimer);
    next();playbackTimer=setInterval(next,2700);
  });
})();
