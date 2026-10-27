'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cody', Object.freeze({
  listVoices: engine => ipcRenderer.invoke('voices:list', engine),
  speak: req => ipcRenderer.invoke('voices:speak', req),
  stop: () => ipcRenderer.invoke('voices:stop'),
  install: kind => ipcRenderer.invoke('voices:install', kind),
  transcribe: encodedWav => ipcRenderer.invoke('mic:transcribe', encodedWav)
}));
