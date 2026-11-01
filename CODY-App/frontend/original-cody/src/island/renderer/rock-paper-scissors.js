'use strict';
(async()=>{
  const api=window.assistant;if(!api?.rps)return;
  const info=document.getElementById('island-info'),controls=document.getElementById('island-rps-controls');
  let game={active:false},pending=false;
  function render(state){
    if(state.revision<game.revision)return;
    const opening=state.active&&!game.active;game=state;
    controls.hidden=!state.active;info.classList.toggle('showing-game',state.active);
    info.dataset.gameStatus=state.voice?.status||'idle';
    document.body.classList.toggle('rps-active',state.active);info.tabIndex=state.active?0:-1;
    const blocked=pending||['preparing','countdown','starting','reveal','processing','retry'].includes(state.voice?.status);
    for(const button of controls.querySelectorAll('button')){button.disabled=blocked;button.setAttribute('aria-pressed',String(button.dataset.rpsMove===state.you));}
    if(opening)window.CODYIsland.togglePanel(false);
  }
  async function act(value){
    if(pending)return;pending=true;render(game);
    try{render(await api.rps.action(value));}catch(error){info.title=error.message;}
    finally{pending=false;render(game);}
  }
  for(const button of controls.querySelectorAll('button'))button.addEventListener('click',event=>{
    event.stopPropagation();void act({action:game.phase==='result'?'next-choice':'choose',move:button.dataset.rpsMove});
  });
  // Compact game clicks never open the chat panel.
  document.getElementById('island').addEventListener('click',event=>{
    if(!game.active||event.target.closest('button'))return;
    event.stopImmediatePropagation();event.preventDefault();
    if(game.phase==='result'||game.voice?.status==='error')void act({action:'voice'});
  },true);
  info.addEventListener('keydown',event=>{
    if(game.active&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();void act({action:'voice'});}
  });
  document.addEventListener('keydown',event=>{
    if(game.active&&event.key==='Escape'){event.stopImmediatePropagation();event.preventDefault();void act({action:'close'});}
  },true);
  window.cody.onGameCommand?.(action=>{if(game.active)void act({action});});
  api.on('rps-state',render);render(await api.rps.state());
})().catch(error=>console.error('Island game:',error));
