'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('assistant',{
 files:{state:()=>ipcRenderer.invoke('attachments-state'),add:files=>ipcRenderer.invoke('attachments-add',Array.from(files,file=>file.name)),remove:id=>ipcRenderer.invoke('attachments-remove',id),pick:()=>ipcRenderer.invoke('attachments-pick'),dragging:value=>ipcRenderer.invoke('attachments-drag',value)},
 previewSend:()=>ipcRenderer.invoke('send-message',{chatId:'preview',text:'Read the attached file'}),
 on:(name,callback)=>ipcRenderer.on(name,(_event,value)=>callback(value))
});
