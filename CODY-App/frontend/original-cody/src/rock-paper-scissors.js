'use strict';
const {EventEmitter}=require('node:events');
const {randomInt}=require('node:crypto');
const {commandText}=require('./command-text');
const MOVES=['rock','paper','scissors'];
const BEATS={rock:'scissors',paper:'rock',scissors:'paper'};
function isGameStart(text){
  // Dictation inserts articles, conjunctions and fillers into the game's name.
  // Match the entire request after removing those words, keeping other tasks
  // and questions intact rather than requiring a word-for-word game title.
  const normalized=text.replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\brockpaperscissors\b/g,'rock paper scissors')
    .replace(/\bscissor\b/g,'scissors')
    .replace(/\b(?:the|a|an|and|or|um|uh|erm)\b/g,' ')
    .replace(/\s+/g,' ').trim()
    .replace(/^(?:leslie|lesley) /,'lets play ');
  const match=/^(?:(?:lets|let us|can we|could we|shall we|i want to|id like to|i would like to|we should|want to) )?(?:(?:play|do|start|have) )?(?:game (?:of )?)?(rock paper scissors|rock scissors|rps)(?: game)?(?: with (?:you|me|cody))?(?: now| again)?$/.exec(normalized);
  return Boolean(match&&(match[1]!=='rock scissors'||/\b(?:lets|play|do|start)\b/.test(normalized)));
}
class RockPaperScissors extends EventEmitter{
  constructor({random=randomInt}={}){super();this.random=random;this.active=false;this.phase='closed';this.round=0;this.score={you:0,cody:0,draws:0};this.revision=0;}
  parse(input){
    const text=commandText(input).toLowerCase().replace(/[’']/g,'').replace(/[-,]/g,' ').replace(/\s+/g,' ').trim();
    if(isGameStart(text))return {action:'start'};
    if(!this.active)return null;
    if(/^(?:play again|again|another round|next round|rematch)$/.test(text))return {action:'again'};
    if(/^(?:(?:stop|close|quit|end) (?:the )?(?:game|rock paper scissors)|stop playing)$/.test(text))return {action:'close'};
    const match=/^(?:(?:i choose|i pick|choose|pick|my move is|my choice is|ill go with|go with) )?(rock|paper|scissors)$/.exec(text);
    return match?{action:this.phase==='result'?'next-choice':'choose',move:match[1]}:null;
  }
  snapshot(){return {active:this.active,phase:this.phase,round:this.round,revision:this.revision,score:{...this.score},voice:this.voice||{status:'idle',message:''},you:this.you||null,cody:this.phase==='result'||this.revealed?this.committed:null,outcome:this.outcome||null,message:this.message||'Choose your move.'};}
  setVoice(status,message,details={}){this.voice={status,message,...details};return this.publish();}
  reveal(){this.revealed=true;return this.publish();}
  publish(){this.revision++;const state=this.snapshot();this.emit('change',state);return state;}
  prepare(){this.phase='ready';this.revealed=false;this.committed=MOVES[this.random(3)];this.you=null;this.outcome=null;this.message='Choose your move.';}
  start(){this.active=true;this.round=1;this.score={you:0,cody:0,draws:0};this.prepare();return this.publish();}
  choose(move){
    if(!MOVES.includes(move))throw Error('Choose rock, paper or scissors.');
    if(!this.active||this.phase!=='ready')return this.snapshot();
    this.you=move;this.phase='result';
    this.outcome=move===this.committed?'draw':BEATS[move]===this.committed?'win':'lose';
    const winner=this.outcome==='win'?move:this.committed,loser=this.outcome==='win'?this.committed:move;
    if(this.outcome==='win')this.score.you++;else if(this.outcome==='lose')this.score.cody++;else this.score.draws++;
    this.message=this.outcome==='draw'?"Same move. It's a draw!":`${winner[0].toUpperCase()+winner.slice(1)} beats ${loser}. ${this.outcome==='win'?'You win!':'C.O.D.Y. wins!'}`;
    return this.publish();
  }
  again(){if(!this.active)return this.start();if(this.phase!=='result')return this.snapshot();this.round++;this.prepare();return this.publish();}
  close(){this.active=false;this.phase='closed';return this.publish();}
  act({action,move}={}){if(action==='voice')return this.phase==='result'?this.again():this.active?this.snapshot():this.start();if(action==='start')return this.start();if(action==='choose')return this.choose(move);if(action==='next-choice'){this.again();return this.choose(move);}if(action==='again')return this.again();if(action==='close')return this.close();throw Error('Unknown game action.');}
  confirmation(state=this.snapshot()){return state.phase==='result'?({win:'You win.',lose:'I win.',draw:"It's a draw."})[state.outcome]:state.active?'Your move.':'Game closed.';}
}
module.exports={RockPaperScissors};
