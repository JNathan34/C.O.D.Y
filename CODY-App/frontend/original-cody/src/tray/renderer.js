'use strict';
const buttons=[...document.querySelectorAll('button[data-action]')];
for(const button of buttons)button.addEventListener('click',()=>window.codyTray.action(button.dataset.action));
window.codyTray.onState(state=>{document.querySelector('[data-action="controls"]').setAttribute('aria-checked',String(state.controls===true));document.querySelector('[data-action="background"]').setAttribute('aria-checked',String(state.background===true));});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.preventDefault();window.codyTray.action('close');}
 if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
  event.preventDefault();const current=buttons.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();
 }
});
