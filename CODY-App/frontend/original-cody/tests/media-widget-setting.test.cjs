'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),path=require('node:path');
const read=p=>readFileSync(path.join(__dirname,'../src/island',p),'utf8');
test('Spotify mini-player can be disabled without stopping the media session',()=>{
 const controller=read('main.js'),ui=read('renderer/ui.js'),view=read('renderer/assistant.js'),html=read('renderer/index.html');
 assert.match(controller,/showMediaWidget:\s*true/);
 assert.match(ui,/showMediaWidget:\s*true/);
 assert.match(html,/data-pref="showMediaWidget"/);
 assert.match(view,/showMedia=.+preferences\.showMediaWidget!==false/);
 assert.match(view,/setMediaPlaying\(Boolean\(preferences\.showMediaWidget!==false/);
});