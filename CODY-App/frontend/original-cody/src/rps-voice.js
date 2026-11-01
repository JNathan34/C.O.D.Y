'use strict';
const {randomUUID}=require('node:crypto');
// Only the game owns this hands-free capture. Ordinary conversations keep push-to-talk.
class RpsVoice {
  constructor({engine,game,now=Date.now}){
    Object.assign(this,{engine,game,now});this.generation=0;this.running=false;
    engine.on('meter',data=>this.meter(data));
    engine.on('game-cue',data=>{
      if(!this.running||data.text!==this.expectedCue)return;
      const count=({'Three.':3,'Two.':2,'One.':1})[data.text];
      if(count)this.show('countdown',String(count),{countdown:count});
      else{this.game.reveal();this.show('reveal','Now! Say your move.',{countdown:0});}
    });
    engine.on('transcript',data=>{
      if(!this.running||!this.capture||data.turn!==this.turn)return;
      clearTimeout(this.wordTimer);
      if(this.answer(data.text))this.wordTimer=setTimeout(()=>void this.finishListening(),450);
    });
    engine.on('failure',data=>{if(this.running)this.fail(Error(data.Message||'Microphone unavailable.'));});
    engine.on('offline',()=>{if(this.running)this.fail(Error('HeyClicky disconnected. Try again.'));});
  }
  show(status,message,details={}){this.status=status;this.game.setVoice(status,message,details);}
  answer(text){
    const direct=this.game.parse(text);if(direct)return direct;
    // A speaker can be heard alongside the player's answer. Prefer an explicit
    // player choice, or remove the announced move when both words were heard.
    const words=String(text||'').toLowerCase();
    const explicit=/(?:i (?:choose|pick)|my (?:move|choice) is) (rock|paper|scissors)\b/.exec(words);
    if(explicit)return {action:'choose',move:explicit[1]};
    const moves=[...words.matchAll(/\b(rock|paper|scissors)\b/g)].map(match=>match[1]);
    if(moves.length===2&&moves.includes(this.move)&&moves[0]!==moves[1])return {action:'choose',move:moves.find(move=>move!==this.move)};
    return null;
  }
  async cancel(){
    const owned=this.running;this.generation++;this.running=false;this.capture=false;
    clearTimeout(this.wordTimer);
    this.show('idle','');
    if(owned)await this.engine.request('cancel').catch(()=>{});
  }
  fail(error){this.generation++;this.running=false;this.capture=false;clearTimeout(this.wordTimer);this.show('error',error.message);void this.engine.request('cancel').catch(()=>{});}
  async start(){
    await this.cancel();if(!this.game.active||this.game.phase!=='ready')return;
    const token=++this.generation;this.running=true;
    try{
      this.move=this.game.committed;this.show('preparing','Getting ready…');
      const move=this.move[0].toUpperCase()+this.move.slice(1)+'.';
      await this.engine.request('game-prepare',{move});if(token!==this.generation)return;
      for(const text of ['Three.','Two.','One.']){
        this.expectedCue=text;
        await this.engine.request('game-play',{text});if(token!==this.generation)return;
      }
      await this.listen(token,true);if(token!==this.generation)return;
      this.revealing=true;this.finishQueued=false;this.expectedCue=move;
      await this.engine.request('game-play',{text:move});if(token!==this.generation)return;
      this.revealing=false;this.show('listening','Listening… say your move.');
      if(this.finishQueued)void this.finishListening();
    }catch(error){if(token===this.generation)this.fail(error);}
  }
  async listen(token,duplex=false){
    if(token!==this.generation)return;
    this.show('starting','Opening microphone…');this.turn=randomUUID();
    const result=await this.engine.request('begin',{turn:this.turn,utilityOnly:true,gameDuplex:duplex});
    if(token!==this.generation)return;
    if(!result.listening)throw Error('Microphone did not start. Try again.');
    this.speechMs=0;this.lastFrame=this.now();this.lastSound=this.now();this.started=this.now();this.noise=0.015;
    this.capture=true;if(!duplex)this.show('listening','Listening… say your move.');
  }
  meter(data){
    if(!this.running||!this.capture||data.state!=='Listening')return;
    const time=this.now(),elapsed=Math.min(200,Math.max(0,time-this.lastFrame));this.lastFrame=time;
    const level=Number(data.level)||0;
    // Briefly learn the room's background noise, then wait indefinitely for speech.
    if(time-this.started<150)return;
    if(!this.speechMs&&level<.06)this.noise=this.noise*.95+level*.05;
    if(level>Math.max(.06,this.noise*2.5)){
      this.speechMs+=elapsed;this.lastSound=time;
    }else if(this.speechMs>=180&&time-this.lastSound>=650){void this.finishListening();}
  }
  async finishListening(){
    if(!this.running||!this.capture)return;
    if(this.revealing){this.finishQueued=true;return;}
    this.capture=false;clearTimeout(this.wordTimer);const token=this.generation;this.show('processing','Hearing your move…');
    try{
      const result=await this.engine.request('end');if(token!==this.generation)return;
      const route=this.answer(result.utilityText||result.transcript||'');
      if(route?.action==='choose'){
        const state=this.game.act(route);this.show('result',state.message);
        await this.engine.request('speak',{turn:randomUUID(),text:this.game.confirmation(state)});
        if(token===this.generation){this.running=false;this.show('result',state.message);}
      }else if(route?.action==='close'){
        this.running=false;this.game.close();this.show('idle','');
      }else{
        this.show('retry','I didn’t catch a move. Say rock, paper or scissors.');
        await this.engine.request('speak',{turn:randomUUID(),text:'Say rock, paper or scissors.'});
        await this.listen(token);
      }
    }catch(error){if(token===this.generation)this.fail(error);}
  }
}
module.exports={RpsVoice};
