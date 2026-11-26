'use strict';
const field=document.getElementById('text'),status=document.getElementById('status');
field.disabled=true;
window.stickyNote.read().then(note=>{field.value=note.text;field.disabled=false;field.focus();}).catch(()=>{status.textContent='Could not open this note.';status.classList.add('error');});
field.addEventListener('input',()=>{status.textContent='Saving…';window.stickyNote.write(field.value);});
document.getElementById('close').addEventListener('click',()=>window.stickyNote.close());
window.stickyNote.onSaved(result=>{status.textContent=result.ok?'Visible across apps · Saved on this device':'Could not save. Keep this note open and try typing again.';status.classList.toggle('error',!result.ok);});
