'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('screenRecorder',{
  onCommand:callback=>ipcRenderer.on('screen-recorder-command',(_event,value)=>callback(value)),
  chunk:value=>ipcRenderer.invoke('screen-recorder-chunk',value),
  response:value=>ipcRenderer.send('screen-recorder-response',value),
  failure:message=>ipcRenderer.send('screen-recorder-failure',message)
});
