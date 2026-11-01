'use strict';
(()=>{
  class IdlePresence{
    constructor({now=Date.now,onChange=()=>{},delay=45000}={}){this.now=now;this.onChange=onChange;this.delay=delay;this.lastInteraction=now();this.sleeping=false;}
    setSleeping(value){if(this.sleeping===value)return;this.sleeping=value;this.onChange(value);}
    interact(){this.lastInteraction=this.now();this.setSleeping(false);}
    tick({engaged=false,mediaPlaying=false}={}){
      if(engaged||mediaPlaying)this.interact();
      else if(this.now()-this.lastInteraction>=this.delay)this.setSleeping(true);
      return this.sleeping;
    }
  }
  if(typeof module!=='undefined')module.exports={IdlePresence};
  if(typeof window!=='undefined')window.CODYIdlePresence=IdlePresence;
})();
