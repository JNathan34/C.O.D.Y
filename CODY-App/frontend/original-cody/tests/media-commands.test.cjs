'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseMediaCommand}=require('../src/media-commands');
test('Plex is a player alias for Plezy across titles, transport, seeking and opening',()=>{
  for(const player of ['Plex','Plezy','Plezzy','Plexy']){
    for(const verb of ['play','resume','continue'])assert.deepEqual(parseMediaCommand(`${verb} The Mentalist on ${player}`),{action:'plezy.play',args:{title:'The Mentalist'}});
    assert.deepEqual(parseMediaCommand(`pause on ${player}`),{action:'media.control',args:{command:'pause',target:'plezy'}});
    assert.deepEqual(parseMediaCommand(`resume on ${player}`),{action:'media.control',args:{command:'play',target:'plezy'}});
    assert.deepEqual(parseMediaCommand(`pause ${player}`),{action:'media.control',args:{command:'pause',target:'plezy'}});
    assert.deepEqual(parseMediaCommand(`skip 2 mins on ${player}`),{action:'media.control',args:{command:'seek',target:'plezy',seconds:120}});
    assert.deepEqual(parseMediaCommand(`next on ${player}`),{action:'media.control',args:{command:'next',target:'plezy'}});
    assert.deepEqual(parseMediaCommand(`open ${player}`),{action:'app.open',args:{app:'plezy'}});
  }
  assert.deepEqual(parseMediaCommand('play Plex on Plex'),{action:'plezy.play',args:{title:'Plex'}});
  assert.deepEqual(parseMediaCommand('play my video on Plex'),{action:'media.control',args:{command:'play',target:'plezy'}});
  assert.equal(parseMediaCommand('resume The Mentalist on Plex and email someone'),null);
  const script=require('../src/control/windows').openApp(parseMediaCommand('open Plex').args.app);
  assert.match(script,/Programs[\\/]Plezy[\\/]plezy\.exe/);assert.doesNotMatch(script,/Plex\.exe/i);
});
test('plain play and pause choose the current player, explicit Plezy stays Plezy',()=>{
  for(const [text,command,target]of [['pause','pause','current'],['play','play','current'],['resume my video','play','current'],['pause on Plezy','pause','plezy']])assert.deepEqual(parseMediaCommand(text),{action:'media.control',args:{command,target}});
  assert.deepEqual(parseMediaCommand('Play Iron Man on Plezy'),{action:'plezy.play',args:{title:'Iron Man'}});
  for(const text of ['play Spotify','play music on spotify','explain play and pause','play Iron Man on Plezy and email someone'])assert.equal(parseMediaCommand(text),null,text);
});
test('relative seeking handles minutes, seconds and spoken numbers without skipping a track',()=>{
  for(const [text,seconds,target]of [['skip 2 mins',120,'current'],['go back 30 seconds',-30,'current'],['rewind two minutes on Plezy',-120,'plezy'],['skip forward 1.5 minutes',90,'current']])assert.deepEqual(parseMediaCommand(text),{action:'media.control',args:{command:'seek',target,seconds}});
  for(const text of ['skip 2 mins and open calculator','skip track','skip 999999 hours','skip 0 seconds'])assert.equal(parseMediaCommand(text),null,text);
});
