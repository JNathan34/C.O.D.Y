'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {SpotifyMedia}=require('../src/spotify');
test('stale Windows media sessions are filtered by their actual player window and process',{skip:process.platform!=='win32'},()=>{const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'media-owner.ps1')],{windowsHide:true,encoding:'utf8',timeout:20000});assert.match(result,/9 media owner checks passed/);});
test('closing the media connection clears cached artwork and pending optimistic playback',()=>{const media=new SpotifyMedia({platform:'test'});media.receiveState({available:true,source:'Spotify.exe',title:'Old track',artwork:'old',playing:false});media.confirmPlayback('play','Spotify.exe');media.close();assert.deepEqual(media.snapshot(),{available:false});assert.equal(media.playbackPending,null);});
