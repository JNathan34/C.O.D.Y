'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('codyTray',{
 action:action=>{if(['open','controls','background','quit','close'].includes(action))ipcRenderer.send('cody-tray-action',action);},
 onState:callback=>ipcRenderer.on('cody-tray-state',(_event,state)=>callback(state))
});
