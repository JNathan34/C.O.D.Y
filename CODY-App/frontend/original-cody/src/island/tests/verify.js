'use strict';
const fs=require('node:fs'), path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('src/renderer/index.html'),js=read('src/renderer/ui.js'),css=read('src/renderer/styles.css'),main=read('src/main.js'),preload=read('src/preload.js');
const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,'1.8.0');
for(const state of ['idle','listening','thinking','speaking','error','offline','restored']) {
 assert(html.includes(`id="symbol-${state}"`));assert(html.includes(`id="ring-${state}"`));
}
for(const id of ['view-chat','view-settings','panel-settings','close-panel','panel-send','new-chat','voice-choices','mic-choices','preview-voice','refresh-microphones','request-mic-permission','chat-connection'])assert(html.includes(`id="${id}"`),`Missing ${id}`);
for(const tab of ['voice','microphone','appearance','shortcuts','cursor','integrations','permissions','developer'])assert(html.includes(`data-tab="${tab}"`));
for(const pref of ['voiceId','voiceRate','voicePitch','voiceVolume','micDeviceId','micSensitivity','enableHotkey','startListeningOnHotkey','cursorTracking','accentColor'])assert(main.includes(pref),`Missing ${pref}`);
assert(!html.includes('Your desktop assistant'));
assert(!html.includes('Connect C.O.D.Y. to ChatGPT to send messages.'));
assert(html.includes('id="island-path"'));
assert(main.includes('const PANEL_HEIGHT = 750'));
assert(main.includes('const SETTINGS_HEIGHT = 716'));
assert(html.includes('data-tab="general"'));
assert(html.includes('id="mic-meter"'));
assert(html.includes('data-speed="1.15"'));
assert(js.includes('setSettingsTab'));
assert(preload.includes('setView'));
assert(main.includes("ipcMain.on('island:view'"));
assert(main.includes('Host bounds are constant'));
assert(!main.includes('collapseResizeTimer=setTimeout'));
assert(js.includes('setActiveView'));
assert(js.includes('getMicrophoneAccess'));
assert(js.includes('speechSynthesis.speak'));
assert(css.includes('body.panel-open .mascot'));
assert(css.includes('.settings-nav'));
assert(preload.includes('onShowSettings'));
assert(main.includes("['wlan','show','interfaces']"));
for(const [file,htmlText] of [['index.html',html],['settings.html',read('src/renderer/settings.html')]]) {
 for(const match of htmlText.matchAll(/(?:src|href)="([^"]+)"/g)){
  const url=match[1];if(/^(https?:|data:|#)/.test(url))continue;
  assert(fs.existsSync(path.resolve(root,'src/renderer',url.split('?')[0])),`Missing ${url} in ${file}`);
 }
}
console.log('C.O.D.Y. v1.8.0 source and asset checks passed.');
