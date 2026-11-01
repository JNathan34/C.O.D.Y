'use strict';
// Coordinates are Electron desktop DIPs. A deliberate back-and-forth shake toggles parking.
class FloatingCursor {
 constructor(){this.reset();}
 reset(){this.detached=false;this.point=null;this.last=null;this.shakeX=null;this.samples=[];this.cooldown=0;this.updatedAt=null;this.boost=0;this.boostStarted=0;this.boostUntil=0;this.boostCooldown=0;}
 update(point,{hideFloatingCursor=false,shakeToDetach=true}={},now=Date.now()){
  if(hideFloatingCursor){this.reset();return null;}
  if(!shakeToDetach){this.detached=false;this.samples=[];this.shakeX=point.x;}
  if(shakeToDetach&&this.last&&now>=this.cooldown){
   const dx=point.x-(this.shakeX??this.last.x);
   if(Math.abs(dx)>=20){
    this.shakeX=point.x;
    this.samples.push({at:now,dx});this.samples=this.samples.filter(s=>now-s.at<=450);
    let reversals=0;for(let i=1;i<this.samples.length;i++)if(Math.sign(this.samples[i].dx)!==Math.sign(this.samples[i-1].dx))reversals++;
    if(reversals>=6&&this.samples.reduce((sum,s)=>sum+Math.abs(s.dx),0)>=900){this.detached=!this.detached;this.cooldown=now+1400;this.samples=[];}
   }
  }
  if(this.shakeX===null||now<this.cooldown)this.shakeX=point.x;
  const interval=this.updatedAt===null?0:now-this.updatedAt,elapsed=Math.max(0,Math.min(64,interval));
  const distance=this.point?Math.hypot(point.x+14-this.point.x,point.y+16-this.point.y):0,speed=this.last&&interval>0?Math.hypot(point.x-this.last.x,point.y-this.last.y)/interval:0;
  if(!this.detached&&interval>0&&interval<=64&&distance>=380&&speed>=2.2&&now>=this.boostCooldown){this.boostStarted=now;this.boostUntil=now+480;this.boostCooldown=now+2400;}
  if(this.detached)this.boostUntil=0;
  this.boost=now<this.boostUntil?Math.max(0,Math.min(1,(now-this.boostStarted)/70,(this.boostUntil-now)/160)):0;
  this.updatedAt=now;
  this.last={...point};const target={x:point.x+14,y:point.y+16};
  if(!this.point)this.point=target;
  else if(!this.detached){
   // Time-based easing keeps the same gentle lag at different refresh rates.
   const blend=1-Math.exp(-elapsed/(200/(1+.45*this.boost))),dx=target.x-this.point.x,dy=target.y-this.point.y;
   this.point=Math.hypot(dx,dy)<.1?target:{x:this.point.x+dx*blend,y:this.point.y+dy*blend};
  }
  return this.point;
 }
}
module.exports={FloatingCursor};
