'use strict';
(()=>{
 const api=window.assistant?.annotations,button=document.getElementById('annotation-demo'),status=document.getElementById('annotation-status');if(!api||!button)return;
 window.CODYIcons?.set(document.getElementById('annotation-nav-icon'),'square-pen');
 button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Drawing the local demo…';try{const result=await api.demo();status.textContent=result?.cancelled?'Cancelled.':'The demo clears after eight seconds.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
})();
