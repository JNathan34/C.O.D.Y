'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('stickyNote',{
  read:()=>ipcRenderer.invoke('sticky-note:read'),
  write:text=>ipcRenderer.send('sticky-note:write',text),
  close:()=>ipcRenderer.send('sticky-note:close'),
  onSaved:callback=>ipcRenderer.on('sticky-note:saved',(_event,result)=>callback(result))
});
