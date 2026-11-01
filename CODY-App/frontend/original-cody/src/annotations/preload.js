'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('annotationOverlay',Object.freeze({
 ready:()=>ipcRenderer.send('annotation-overlay:ready'),
 acknowledge:message=>ipcRenderer.send('annotation-overlay:ack',message),
 onScene:callback=>ipcRenderer.on('annotation-overlay:scene',(_event,scene)=>callback(scene))
}));
