'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {identify}=require('../src/island/renderer/plex-players');

test('playback badges recognize streaming players and smart TVs from Plex metadata',()=>{
 const cases=[
  [{platform:'Android',product:'Plex for Android (TV)',model:'AFTKRT',player:'Living Room TV'},'fire-tv-stick','Fire TV Stick'],
  [{platform:'Fire OS',model:'AFTMM'},'fire-tv','Fire TV'],
  [{platform:'Fire OS',model:'AFTMM',player:'Bedroom Firestick'},'fire-tv-stick','Fire TV Stick'],
  [{platform:'Android',device:'AFTGAZL'},'fire-tv-cube','Fire TV Cube'],
  [{platform:'Roku',device:'Roku TV'},'roku-tv','Roku TV'],
  [{platform:'tvOS',product:'Plex for Apple TV'},'apple-tv','Apple TV'],
  [{platform:'Android',product:'Plex for Android (TV)',model:'SHIELD Android TV'},'shield','NVIDIA Shield'],
  [{product:'Plex for Smart TVs',platform:'webOS'},'lg-tv','LG TV'],
  [{product:'Plex for Smart TVs',platform:'webOS Hub',vendor:'Sharp'},'sharp-tv','Sharp TV'],
  [{product:'Plex for Smart TVs',platform:'Tizen'},'samsung-tv','Samsung TV'],
  [{product:'Plex for Smart TVs',platform:'VIDAA',vendor:'Hisense'},'hisense-tv','Hisense TV'],
  [{product:'Plex for Smart TVs',platform:'VIDAA'},'vidaa-tv','VIDAA TV'],
  [{product:'Plex for Smart TVs',platform:'SmartCast'},'vizio-tv','VIZIO TV'],
  [{platform:'Android TV',vendor:'TCL'},'tcl-tv','TCL TV'],
  [{platform:'Google TV',model:'BRAVIA'},'sony-tv','Sony TV'],
  [{platform:'Google TV',model:'Google TV Streamer'},'google-tv-streamer','Google TV Streamer'],
  [{platform:'Chrome',product:'Chromecast'},'cast','Chromecast']
 ];
 for(const [session,type,caption] of cases){
  const device=identify(session);
  assert.equal(device.type,type,JSON.stringify(session));
  assert.equal(device.caption,caption,JSON.stringify(session));
 }
});

test('native players and consoles keep their own badge when browser hints conflict',()=>{
 assert.equal(identify({platform:'Edge',product:'Plex for Windows'}).type,'windows');
 assert.equal(identify({platform:'Edge',product:'Plex HTPC',device:'Windows'}).type,'windows');
 assert.equal(identify({platform:'Windows',player:'Edge'}).type,'windows');
 assert.equal(identify({platform:'Edge',product:'Plex Web',device:'Windows'}).type,'edge');
 assert.equal(identify({platform:'Windows',product:'Plex Web',player:'Firefox'}).type,'firefox');
 assert.equal(identify({platform:'Chromium',product:'Plex Web',player:'Brave'}).type,'brave');
 assert.equal(identify({platform:'Chrome',product:'Plex Web',player:'Firefox'}).type,'chrome');
 assert.equal(identify({platform:'Windows',product:'Plex Web'}).type,'browser');
 assert.equal(identify({platform:'Android',vendor:'Samsung',device:'Galaxy S25'}).type,'android');
 assert.equal(identify({product:'Plex for Xbox',model:'Xbox Series X',platform:'Edge'}).caption,'Xbox Series X');
 assert.equal(identify({product:'Plex for PlayStation 5',platform:'WebKit'}).glyph,'device-playstation');
 assert.equal(identify({platform:'PS4'}).caption,'PS4');
 assert.equal(identify({player:'Living Room TV'}).type,'tv');
});
