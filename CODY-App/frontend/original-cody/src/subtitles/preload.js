'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('subtitles', {
  onText(callback) {
    ipcRenderer.on('subtitle-text', (_event, text) => callback(text));
  }
});
