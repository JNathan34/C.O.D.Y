'use strict';
function validRect(rect){return !!rect&&['x','y','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>0&&rect.height>0;}
function intersects(a,b){return a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;}
function physicalRectToDip(screen,rect){
 if(!validRect(rect))throw Error('The observed target has no usable screen bounds');
 if(typeof screen.screenToDipRect!=='function')throw Error('Windows screen-coordinate conversion is unavailable');
 const result=screen.screenToDipRect(null,rect);if(!validRect(result))throw Error('Could not convert the observed screen bounds');return result;
}
function bounds(shape){
 if(shape.kind==='circle')return {x:shape.x-shape.radius,y:shape.y-shape.radius,width:shape.radius*2,height:shape.radius*2};
 const points=shape.points||((shape.kind==='arrow'||shape.kind==='line')?[{x:shape.x,y:shape.y},{x:shape.toX,y:shape.toY},...(shape.controlX!==undefined?[{x:shape.controlX,y:shape.controlY}]:[])]:null);
 if(points){const xs=points.map(point=>point.x),ys=points.map(point=>point.y);return {x:Math.min(...xs)-16,y:Math.min(...ys)-16,width:Math.max(...xs)-Math.min(...xs)+32,height:Math.max(...ys)-Math.min(...ys)+32};}
 return {x:shape.x-4,y:shape.y-4,width:shape.width||(shape.kind==='text'?Math.min(1200,shape.text.length*(shape.fontSize||16)*.7):1),height:shape.height||(shape.kind==='text'?(shape.fontSize||16)*(shape.text.split('\n').length+1):12)};
}
function onDesktop(shape,displays){const rect=bounds(shape);if(!displays.some(display=>intersects(rect,display.bounds)))throw Error('Annotation lies outside the current displays');return shape;}
function relativeGeometry(kind,args,rect){
 const x=value=>rect.x+value*rect.width,y=value=>rect.y+value*rect.height;
 const out={...args};for(const key of ['x','toX','controlX'])if(out[key]!==undefined)out[key]=x(out[key]);for(const key of ['y','toY','controlY'])if(out[key]!==undefined)out[key]=y(out[key]);
 for(const key of ['width','height','radius'])if(out[key]!==undefined)out[key]*=key==='width'?rect.width:key==='height'?rect.height:Math.min(rect.width,rect.height);
 if(out.points)out.points=out.points.map(point=>({x:x(point.x),y:y(point.y)}));return out;
}
function targetGeometry(kind,args,rect,displays){
 const pad=5,r={x:rect.x-pad,y:rect.y-pad,width:rect.width+pad*2,height:rect.height+pad*2};
 if(['rectangle','spotlight'].includes(kind))return {...args,...r};
 if(kind==='circle')return {...args,x:rect.x+rect.width/2,y:rect.y+rect.height/2,radius:Math.hypot(rect.width,rect.height)/2+pad};
 if(kind==='text')return {...args,x:rect.x,y:rect.y+rect.height+8};
 if(kind==='underline')return {...args,x:rect.x,y:rect.y+rect.height+3,width:rect.width};
 if(kind==='path')return {...args,points:[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height},{x:r.x,y:r.y}]};
 if(kind==='arrow'){
  const display=displays.find(display=>intersects(rect,display.bounds))?.bounds;
  const left=!display||rect.x-65>=display.x;
  return {...args,x:left?rect.x-60:rect.x+rect.width+60,y:rect.y+rect.height/2-25,toX:left?rect.x:rect.x+rect.width,toY:rect.y+rect.height/2};
 }
 return {...args,x:rect.x,y:rect.y+rect.height,toX:rect.x+rect.width,toY:rect.y};
}
module.exports={validRect,intersects,physicalRectToDip,bounds,onDesktop,relativeGeometry,targetGeometry};
