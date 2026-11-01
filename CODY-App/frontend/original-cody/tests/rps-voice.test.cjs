'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {RpsVoice}=require('../src/rps-voice');
const {RockPaperScissors}=require('../src/rock-paper-scissors');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const engine=new EventEmitter(),calls=[];let time=1000,answer='paper';
  engine.request=async(command,args)=>{calls.push({command,args});if(command==='game-play')engine.emit('game-cue',{text:args.text});return command==='begin'?{listening:true}:command==='end'?{transcript:answer}:command==='speak'?{spoken:true}:{};};
  const game=new RockPaperScissors({random:()=>0});game.start();
  const voice=new RpsVoice({engine,game,now:()=>time});
  return {engine,calls,game,voice,setAnswer:value=>answer=value,meter:(level,ms=100)=>{time+=ms;engine.emit('meter',{state:'Listening',level});}};
}
test('audio cues drive each visible countdown step and mic opens before CODY says his move',async()=>{
  const s=setup(),steps=[];s.game.on('change',state=>{if(state.voice.status==='countdown')steps.push(state.voice.countdown);});
  await s.voice.start();assert.deepEqual(steps,[3,2,1]);assert.deepEqual(s.calls.filter(c=>c.command==='game-play').map(c=>c.args.text),['Three.','Two.','One.','Rock.']);
  const begin=s.calls.findIndex(c=>c.command==='begin'),reveal=s.calls.findIndex(c=>c.command==='game-play'&&c.args.text==='Rock.');assert.ok(begin<reveal);
  assert.equal(s.calls[begin].args.utilityOnly,true);assert.equal(s.calls[begin].args.gameDuplex,true);
  assert.equal(s.game.snapshot().voice.status,'listening');assert.equal(s.game.snapshot().cody,'rock');
  for(let i=0;i<1000;i++)s.meter(.005);assert.equal(s.calls.some(c=>c.command==='end'),false);
  await s.voice.cancel();
});
test('speech followed by silence submits once, scores locally and speaks the result',async()=>{
  const s=setup();await s.voice.start();s.meter(.01,200);for(let i=0;i<4;i++)s.meter(.3);for(let i=0;i<9;i++)s.meter(.005);await tick();
  assert.equal(s.calls.filter(c=>c.command==='end').length,1);assert.equal(s.game.snapshot().outcome,'win');assert.equal(s.game.snapshot().score.you,1);
  assert.equal(s.calls.at(-1).args.text,'You win.');assert.equal(s.calls.some(c=>c.command==='submit'),false);assert.equal(s.voice.running,false);
});
test('unrecognised answer retries with the same announced move',async()=>{
  const s=setup();s.setAnswer('banana');await s.voice.start();await s.voice.finishListening();
  assert.equal(s.game.snapshot().cody,'rock');assert.equal(s.game.snapshot().round,1);assert.equal(s.game.snapshot().voice.status,'listening');
  assert.equal(s.calls.filter(c=>c.command==='begin').length,2);assert.ok(s.calls.some(c=>c.args?.text==='Say rock, paper or scissors.'));
  await s.voice.cancel();
});
test('cancelling during countdown prevents a late microphone start',async()=>{
  const s=setup();let release;
  s.engine.request=async(command,args)=>{s.calls.push({command,args});return command==='game-play'?new Promise(r=>release=r):{};};
  const start=s.voice.start();await tick();await s.voice.cancel();s.game.close();release({spoken:true});await start;
  assert.equal(s.calls.some(c=>c.command==='begin'),false);assert.equal(s.game.snapshot().active,false);
});

test('a player answer during the announced move is kept until playback completes',async()=>{
  const s=setup();let finishMove;
  const request=s.engine.request;s.engine.request=async(command,args)=>{
    if(command==='game-play'&&args.text==='Rock.'){
      s.calls.push({command,args});s.engine.emit('game-cue',{text:args.text});
      return new Promise(resolve=>finishMove=resolve);
    }
    return request(command,args);
  };
  const start=s.voice.start();await tick();assert.equal(s.voice.capture,true);assert.equal(s.game.snapshot().voice.status,'reveal');
  await s.voice.finishListening();assert.equal(s.calls.some(c=>c.command==='end'),false);
  finishMove({spoken:true});await start;await tick();assert.equal(s.game.snapshot().outcome,'win');assert.equal(s.game.snapshot().you,'paper');
});

test('mixed speaker and player words retain the player choice',async()=>{
  const s=setup();await s.voice.start();s.setAnswer('Rock. Paper.');await s.voice.finishListening();assert.equal(s.game.snapshot().you,'paper');assert.equal(s.game.snapshot().outcome,'win');
});
test('quiet recognised move is accepted without requiring an audio threshold',async()=>{
  const s=setup();await s.voice.start();s.engine.emit('transcript',{turn:s.voice.turn,text:'paper'});
  await new Promise(resolve=>setTimeout(resolve,500));assert.equal(s.game.snapshot().outcome,'win');assert.equal(s.calls.filter(c=>c.command==='end').length,1);
});
test('spoken stop closes the game and microphone failures remain recoverable',async()=>{
  const s=setup();await s.voice.start();s.setAnswer('stop the game');await s.voice.finishListening();assert.equal(s.game.active,false);assert.equal(s.voice.running,false);
  s.game.start();await s.voice.start();s.engine.emit('failure',{Message:'Microphone disconnected'});assert.equal(s.game.snapshot().voice.status,'error');assert.equal(s.voice.capture,false);
});
