'use strict';
function demoCommands(bounds){
 const x=bounds.x+bounds.width*.25,y=bounds.y+bounds.height*.25,w=Math.min(200,bounds.width*.24),h=Math.min(75,bounds.height*.12);
 const common={durationMs:8000};
 return [
  {action:'draw.spotlight',args:{...common,x:x-25,y:y-25,width:w*2.6,height:h*3.3}},
  {action:'draw.rectangle',args:{...common,x,y,width:w,height:h}},
  {action:'draw.circle',args:{...common,x:x+w*1.6,y:y+h*.5,radius:h*.65}},
  {action:'draw.arrow',args:{...common,x:x-55,y:y+h*2,toX:x+25,toY:y+h}},
  {action:'draw.line',args:{...common,x:x+w*.5,y:y+h*1.6,toX:x+w*2,toY:y,controlX:x+w,controlY:y+h*3}},
  {action:'draw.underline',args:{...common,x,y:y+h*2.2,width:w}},
  {action:'draw.path',args:{...common,points:[{x:x+w*1.3,y:y+h*2.2},{x:x+w*1.55,y:y+h*1.5},{x:x+w*1.8,y:y+h*2.3},{x:x+w*2.1,y:y+h*1.8}]}},
  {action:'draw.text',args:{...common,x,y:y-55,text:'C.O.D.Y screen annotations\nClick-through · automatically clears',fontSize:17}}
 ];
}
module.exports={demoCommands};
