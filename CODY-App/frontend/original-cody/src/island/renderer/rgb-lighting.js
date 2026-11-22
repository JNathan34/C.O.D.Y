'use strict';
(()=>{
  const assistant=window.assistant,api=assistant?.rgb;
  if(!api)return;
  const byId=id=>document.getElementById(id);
  const settings={enabled:byId('rgb-enabled'),discover:byId('rgb-discover'),list:byId('rgb-devices'),status:byId('rgb-status')};
  const popup={enabled:byId('island-rgb-reactive'),discover:byId('island-rgb-discover'),list:byId('island-rgb-devices'),status:byId('island-rgb-status')};
  const wheel=byId('island-rgb-wheel'),marker=byId('island-rgb-marker'),hex=byId('island-rgb-hex'),level=byId('island-rgb-brightness');
  const apply=byId('island-rgb-apply'),off=byId('island-rgb-off');
  const validColor=/^#[\da-f]{6}$/i;
  let current,busy=false,hue=0,saturation=0,drag=null;

  function drawColor(){
    const angle=hue*Math.PI/180;
    marker.style.left=`${50+Math.cos(angle)*saturation*47}%`;
    marker.style.top=`${50+Math.sin(angle)*saturation*47}%`;
    marker.style.background=validColor.test(hex.value)?hex.value:'#fff';
    wheel.setAttribute('aria-valuenow',String(Math.floor(hue)));
  }
  function fromHex(value){
    const [r,g,b]=value.slice(1).match(/../g).map(channel=>parseInt(channel,16)/255);
    const max=Math.max(r,g,b),min=Math.min(r,g,b),range=max-min;
    if(range)hue=((max===r?(g-b)/range:max===g?(b-r)/range+2:(r-g)/range+4)*60+360)%360;
    saturation=max?range/max:0;
    hex.value=value.toUpperCase();drawColor();
  }
  function setWheel(nextHue,nextSaturation){
    hue=(nextHue+360)%360;saturation=nextSaturation;
    const channel=n=>{
      const k=(n+hue/60)%6;
      const value=1-saturation*Math.max(0,Math.min(k,4-k,1));
      return Math.round(value*255).toString(16).padStart(2,'0');
    };
    hex.value=('#'+[5,3,1].map(channel).join('')).toUpperCase();drawColor();renderActions();
  }
  function pickAt(x,y){
    const rect=wheel.getBoundingClientRect(),radius=rect.width/2;
    if(!radius)return;
    const dx=x-rect.left-radius,dy=y-rect.top-radius;
    setWheel(Math.atan2(dy,dx)*180/Math.PI,Math.min(1,Math.hypot(dx,dy)/radius));
  }
  function renderActions(){
    const ready=current?.pluginEnabled&&current.devices.some(device=>device.available);
    apply.disabled=busy||current?.busy||!ready||!validColor.test(hex.value);
    off.disabled=busy||current?.busy||!ready;
    byId('island-rgb-level').value=level.value+'%';
  }
  function render(){
    renderActions();
    if(!current)return;
    const locked=busy||current.busy||!current.pluginEnabled;
    const selected=current.devices.filter(device=>device.selected).length;
    byId('island-rgb-device-count').textContent=selected?`Devices · ${selected} selected`:'Devices';
    for(const view of [settings,popup]){
      view.enabled.checked=current.enabled;
      view.enabled.disabled=locked||(!current.enabled&&!selected);
      view.discover.disabled=locked||current.enabled;
      const focus=view.list.contains(document.activeElement)?document.activeElement.dataset.device:null;
      view.list.replaceChildren(...current.devices.map(device=>{
        const row=document.createElement('label');row.className=view===popup?'rgb-device-option':'setting-row';
        const name=document.createElement('span');name.textContent=device.name;
        if(!device.available){const note=document.createElement('small');note.textContent=' · Direct mode unavailable';name.append(note);}
        const input=document.createElement('input');input.type='checkbox';input.checked=device.selected;
        input.dataset.device=device.id;input.disabled=locked||current.enabled||!device.available;
        input.addEventListener('change',()=>void run(()=>api.select(device.id,input.checked)));
        row.append(name,input);return row;
      }));
      if(focus)view.list.querySelector(`input[data-device="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
    }
  }
  function message(text){for(const view of [settings,popup])view.status.textContent=text;}
  function receive(state){
    if(state.color!==current?.color&&validColor.test(state.color))fromHex(state.color);
    if(state.brightness!==current?.brightness&&Number.isInteger(state.brightness))level.value=state.brightness;
    current=state;message(state.message);render();
  }
  async function run(action){
    if(busy)return;
    busy=true;render();
    try{receive(await action());}
    catch(error){message(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
    finally{busy=false;render();}
  }
  function setColor(value=hex.value){if(validColor.test(value))void run(()=>api.setColor(value,Number(level.value)));}
  for(const [name,color] of [['Red','#FF3D55'],['Amber','#FFB45C'],['Green','#00FF00'],['Cyan','#24E9F5'],['Blue','#4276FF'],['Violet','#AF60FF'],['White','#FFFFFF']]){
    const button=document.createElement('button');button.type='button';button.title=name;button.setAttribute('aria-label',name);
    button.style.setProperty('--swatch',color);button.addEventListener('click',()=>{fromHex(color);renderActions();});
    byId('island-rgb-presets').append(button);
  }
  wheel.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag=event.pointerId;wheel.setPointerCapture(drag);pickAt(event.clientX,event.clientY);});
  wheel.addEventListener('pointermove',event=>{if(event.pointerId===drag)pickAt(event.clientX,event.clientY);});
  wheel.addEventListener('lostpointercapture',()=>{drag=null;});
  wheel.addEventListener('keydown',event=>{
    const step={ArrowRight:5,ArrowUp:5,ArrowLeft:-5,ArrowDown:-5}[event.key];
    if(step){event.preventDefault();setWheel(hue+step,saturation||1);}
  });
  hex.addEventListener('input',()=>{if(validColor.test(hex.value))fromHex(hex.value);renderActions();});
  hex.addEventListener('keydown',event=>{if(event.key==='Enter'&&!apply.disabled){event.preventDefault();setColor();}});
  level.addEventListener('input',renderActions);
  apply.addEventListener('click',()=>setColor());off.addEventListener('click',()=>setColor('#000000'));
  for(const view of [settings,popup]){
    view.discover.addEventListener('click',()=>void run(api.discover));
    view.enabled.addEventListener('change',()=>{const checked=view.enabled.checked;void run(()=>api.enable(checked));});
  }
  const panel=document.querySelector('[data-plugin-panel="rgb-lighting"]');
  panel.addEventListener('toggle',()=>{if(panel.open)void run(api.state);});
  byId('rgb-open').addEventListener('click',()=>void run(api.open));
  assistant.on('rgb-lighting-changed',receive);
  window.CODYRgbLighting={show:()=>void run(api.state),pickAt};
  fromHex(hex.value);renderActions();
})();
