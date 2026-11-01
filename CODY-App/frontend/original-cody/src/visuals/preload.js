'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('codyScene',Object.freeze({
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('scene:state',listener);return ()=>ipcRenderer.removeListener('scene:state',listener);},
 ready:error=>ipcRenderer.send('scene:ready',error?{error:String(error).slice(0,250)}:{}),
 acknowledge:message=>ipcRenderer.send('scene:ack',message),
 changed:message=>ipcRenderer.send('scene:changed',message)
}));
