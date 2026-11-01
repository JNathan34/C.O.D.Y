'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {RockPaperScissors}=require('../src/rock-paper-scissors');
const {IslandUtilities}=require('../src/island-utilities');
const moves=['rock','paper','scissors'];
test('all nine move combinations have the correct outcome and one score',()=>{
  const outcomes=[['draw','lose','win'],['win','draw','lose'],['lose','win','draw']];
  for(let you=0;you<3;you++)for(let cody=0;cody<3;cody++){
    const game=new RockPaperScissors({random:()=>cody});game.start();
    const state=game.choose(moves[you]);assert.equal(state.outcome,outcomes[you][cody]);
    assert.equal(state.cody,moves[cody]);assert.equal(Object.values(state.score).reduce((a,b)=>a+b),1);
    assert.deepEqual(game.choose(moves[(you+1)%3]),state);
  }
});
test('CODY commits before the player chooses and keeps the move hidden',()=>{
  let calls=0;const game=new RockPaperScissors({random:n=>{assert.equal(n,3);calls++;return 1;}});
  assert.equal(game.start().cody,null);assert.equal(calls,1);
  assert.equal(game.choose('rock').cody,'paper');assert.equal(calls,1);
  const next=game.again();assert.equal(next.cody,null);assert.equal(next.round,2);assert.equal(next.score.cody,1);assert.equal(calls,2);
  assert.equal(game.start().score.cody,0);assert.equal(game.close().active,false);
});

test('simultaneous reveal exposes the committed move without scoring until the player answers',()=>{
  const game=new RockPaperScissors({random:()=>2});game.start();assert.equal(game.snapshot().cody,null);
  const revealed=game.reveal();assert.equal(revealed.cody,'scissors');assert.equal(revealed.phase,'ready');assert.equal(revealed.score.cody,0);
  assert.equal(game.choose('rock').outcome,'win');assert.equal(game.again().cody,null);
});
test('voice routes are contextual and compound or ordinary questions stay with AI',()=>{
  const game=new RockPaperScissors({random:()=>0});assert.equal(game.parse('rock'),null);
  for(const text of ["Let's play rock paper scissors",'Can we play rock, paper, scissors?','Hey Cody, play rock paper scissors please'])assert.equal(game.parse(text).action,'start');
  game.start();assert.equal(game.parse('I choose paper.').move,'paper');
  for(const text of ['Tell me about rock music','rock and open calculator','play music'])assert.equal(game.parse(text),null);
  game.act(game.parse('paper'));const next=game.act(game.parse('scissors'));assert.equal(next.round,2);assert.equal(next.score.you,1);assert.equal(next.score.cody,1);
  assert.equal(game.act(game.parse('stop the game')).active,false);
});
test('game requests use the local utility route and short voice confirmations',async()=>{
  const rps=new RockPaperScissors({random:()=>0});let cleared=0;
  const utilities=new IslandUtilities({rps,clearCard:()=>cleared++});
  assert.equal((await utilities.run('play rock paper scissors')).confirmation,'Your move.');
  assert.equal((await utilities.run('paper')).confirmation,'You win.');
  assert.equal(cleared,2);assert.equal(rps.snapshot().score.you,1);
});

test('the reported Leslie Rock scissors transcript starts the local game',()=>{
  const rps=new RockPaperScissors();const utilities=new IslandUtilities({rps});
  for(const text of ['Leslie Rock scissors.','Lesley rock scissors','Leslie rock paper scissors',"Let's play rock scissors",'lets do rock paper scissors','Let us play rock paper scissors','play a game rock paper scissors']){
    assert.equal(utilities.match(text)?.action,'rps',text);assert.equal(utilities.match(text).game.action,'start',text);
  }
  for(const text of ['Who is Leslie?','Leslie rock concert','Tell Leslie to play rock paper scissors','Explain rock paper scissors','play rock scissors and open calculator'])assert.equal(utilities.match(text),null,text);
});

test('game start tolerates dictation insertions without consuming other requests',()=>{
  const game=new RockPaperScissors();
  const starts=["Let's play rock the paper scissors.","Let's play the rock paper and scissors game.",'play rock and paper and scissors with me','Can we have a game of rock paper scissors?','start a game of rock paper scissors now','play rock, paper, or scissors','play rock-paper-scissors','play rock paper scissor','play rockpaperscissors','play RPS'];
  for(const text of starts)assert.equal(game.parse(text)?.action,'start',text);
  for(const prefix of ["Let's play",'play','can we play','start a game of'])for(const article of ['the','a','um']){
    assert.equal(game.parse(`${prefix} rock ${article} paper scissors`)?.action,'start');
    assert.equal(game.parse(`${prefix} rock paper ${article} scissors`)?.action,'start');
  }
  for(const text of ['explain how to play rock paper scissors','do not play rock paper scissors','who invented rock paper scissors','play rock paper scissors and open calculator','play rock paper scissors then play music','tell Leslie to play rock paper scissors','rock music and paper scissors','rock scissors'])assert.equal(game.parse(text),null,text);
});
