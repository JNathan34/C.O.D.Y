'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('assistant',{
 agents:Object.fromEntries(['state','usage','claudeAccount'].map(name=>[name,value=>ipcRenderer.invoke('preview-account',name,value)])),
 on(){}
});
