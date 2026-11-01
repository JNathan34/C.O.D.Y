'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('assistant',{
  updates:Object.fromEntries(['state','check','download','install','configure','releases'].map(name=>[name,value=>ipcRenderer.invoke('updates-'+name,value)])),
  on:(name,callback)=>{if(name==='updates-state')ipcRenderer.on(name,(_event,state)=>callback(state));}
});
