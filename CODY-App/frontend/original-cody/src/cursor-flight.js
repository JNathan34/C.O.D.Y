'use strict';
class CursorFlight{
 constructor({kind,from,to,startScale=kind==='return'?1:.18,startOpacity=kind==='return'?1:0}){Object.assign(this,{kind,from:{...from},to:{...to},startScale,startOpacity});this.startedAt=null;this.duration=kind==='return'?550:700;}
 begin(now=Date.now()){if(this.startedAt===null)this.startedAt=now;}
 sample(now=Date.now(),destination=this.to){
  const t=this.startedAt===null?0:Math.min(1,Math.max(0,(now-this.startedAt)/this.duration)),e=t*t*(3-2*t),dx=destination.x-this.from.x,dy=destination.y-this.from.y,length=Math.hypot(dx,dy),bend=Math.min(90,length*.15),arc=4*e*(1-e);
  const point={x:this.from.x+dx*e+(length?-dy/length*bend*arc:0),y:this.from.y+dy*e+(length?dx/length*bend*arc:0)};
  const returning=this.kind==='return',progress=returning?t*t:1-(1-t)*(1-t),endScale=returning?.18:1;
  return{point,scale:this.startScale+(endScale-this.startScale)*progress,opacity:returning?this.startOpacity*Math.min(1,(1-t)*4):this.startOpacity+(1-this.startOpacity)*Math.min(1,t*4),done:t===1};
 }
}
module.exports={CursorFlight};
