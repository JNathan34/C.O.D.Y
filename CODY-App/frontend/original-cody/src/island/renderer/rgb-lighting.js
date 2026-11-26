'use strict';
(()=>{
  const assistant=window.assistant,api=assistant?.rgb;
  if(!api)return;
  const byId=id=>document.getElementById(id);
  const reactive=byId('island-rgb-reactive'),discover=byId('island-rgb-discover'),devices=byId('island-rgb-devices');
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
    const ready=current?.pluginEnabled&&current.devices.some(device=>device.selected);
    apply.disabled=busy||current?.busy||!ready||!validColor.test(hex.value);
    off.disabled=busy||current?.busy||!ready;
    byId('island-rgb-level').value=level.value+'%';
  }
  function render(){
    renderActions();
    if(!current)return;
    const locked=busy||current.busy||!current.pluginEnabled;
    const selected=current.devices.filter(device=>device.selected).length;
    byId('island-rgb-device-count').textContent=current.provider?`${current.provider} · ${selected} ${selected===1?'device':'devices'}`:'Devices';
    reactive.checked=current.enabled;
    reactive.disabled=locked||(!current.enabled&&!selected);
    discover.disabled=locked||current.enabled;
    devices.replaceChildren(...current.devices.map(device=>{
      const row=document.createElement('li');
      row.textContent=device.name+(device.selected?'':device.available?' · Paused':' · Unsupported');
      return row;
    }));
  }
  function message(text){byId('island-rgb-status').textContent=text;}
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
  discover.addEventListener('click',()=>void run(api.discover));
  reactive.addEventListener('change',()=>{const checked=reactive.checked;void run(()=>api.enable(checked));});
  byId('rgb-open').addEventListener('click',()=>void run(api.open));
  assistant.on('rgb-lighting-changed',receive);
  window.CODYRgbLighting={show:()=>void run(api.state),pickAt};
  fromHex(hex.value);renderActions();
})();
