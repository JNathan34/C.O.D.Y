'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('controlVisuals',{onState:callback=>ipcRenderer.on('control-visual-state',(_event,state)=>callback(state)),frame:()=>ipcRenderer.send('control-visual-frame')});
