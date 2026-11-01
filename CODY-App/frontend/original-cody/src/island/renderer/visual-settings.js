'use strict';
(()=>{
 const api=window.assistant?.visuals,button=document.getElementById('visual-demo'),status=document.getElementById('visual-status');if(!api||!button)return;
 button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Opening the local demo…';try{const result=await api.demo();status.textContent=result?.cancelled?'Cancelled.':'Drag to move, right-drag to rotate, and scroll to resize.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
})();
