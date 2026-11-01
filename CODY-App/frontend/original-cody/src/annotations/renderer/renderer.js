'use strict';
(()=>{
 const svg=document.getElementById('scene'),namespace='http://www.w3.org/2000/svg',nodes=new Map();let latest=0;
 function element(tag,attributes={}){const node=document.createElementNS(namespace,tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;}
 function path(shape){
  if(shape.kind==='path')return shape.points.map((point,index)=>(index?'L':'M')+point.x+' '+point.y).join(' ');
  let result=`M${shape.x} ${shape.y} `;
  if(shape.kind==='underline')return result+`L${shape.x+shape.width} ${shape.y}`;
  result+=shape.controlX!==undefined?`Q${shape.controlX} ${shape.controlY} ${shape.toX} ${shape.toY}`:`L${shape.toX} ${shape.toY}`;
  if(shape.kind==='arrow'){
   const angle=Math.atan2(shape.toY-shape.y,shape.toX-shape.x),size=Math.max(10,shape.strokeWidth*3.5);
   result+=` M${shape.toX-size*Math.cos(angle-.48)} ${shape.toY-size*Math.sin(angle-.48)} L${shape.toX} ${shape.toY} L${shape.toX-size*Math.cos(angle+.48)} ${shape.toY-size*Math.sin(angle+.48)}`;
  }return result;
 }
 function createShape(shape){
  const group=element('g',{'data-annotation-id':shape.id,class:'annotation'});
  if(shape.kind==='card'){
   group.setAttribute('transform', 'translate('+shape.x+' '+shape.y+')');
   const report=window.ClickyDraw.render({w:shape.width,h:shape.height,marks:structuredClone(shape.marks),layout:false},group,{width:shape.width});
   if(report.errors.length)throw Error('Visual card: '+report.errors.join('; '));
   group.classList.add('visual-card');
  }else if(shape.kind==='circle')group.append(element('circle',{cx:shape.x,cy:shape.y,r:shape.radius}));
  else if(shape.kind==='rectangle')group.append(element('rect',{x:shape.x,y:shape.y,width:shape.width,height:shape.height,rx:6}));
  else if(shape.kind==='text'){
   const text=element('text',{x:shape.x,y:shape.y+(shape.fontSize||16),'font-size':shape.fontSize||16,fill:shape.color,class:'caption'});
   for(const [index,line]of shape.text.split('\n').slice(0,12).entries()){const row=element('tspan',{x:shape.x,dy:index?'1.3em':0});row.textContent=line;text.append(row);}group.append(text);
  }else if(shape.kind==='spotlight'){
   const mask=element('mask',{id:'mask-'+shape.id,maskUnits:'userSpaceOnUse'});
   mask.append(element('rect',{...window.sceneDisplay,fill:'white'}),element('rect',{x:shape.x,y:shape.y,width:shape.width,height:shape.height,rx:8,fill:'black'}));
   const defs=element('defs');defs.append(mask);group.append(defs,element('rect',{...window.sceneDisplay,fill:'#00101f',opacity:.52,mask:'url(#mask-'+shape.id+')',class:'spotlight'}));
  }else group.append(element('path',{d:path(shape)}));
  if(!['text','spotlight','card'].includes(shape.kind)){const ink=group.firstElementChild;ink.setAttribute('class','ink');ink.setAttribute('pathLength','1');ink.setAttribute('stroke',shape.color);ink.setAttribute('stroke-width',shape.strokeWidth);}
  return group;
 }
 window.annotationOverlay.onScene(async message=>{
  const revision=message?.revision;latest=revision;
  try{
   if(!Number.isSafeInteger(revision)||!message.display?.bounds||!Array.isArray(message.shapes)||message.shapes.length>120)throw Error('Invalid annotation scene');
   const bounds=message.display.bounds;window.sceneDisplay=bounds;svg.setAttribute('viewBox',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
   const ids=new Set(message.shapes.map(shape=>shape.id));for(const [id,entry]of nodes)if(!ids.has(id)){entry.node.remove();nodes.delete(id);}
   for(const shape of message.shapes){
    const {removing,waitingForSpeech,paused,...drawing}=shape,key=JSON.stringify(drawing);let entry=nodes.get(shape.id);
    if(!entry||entry.key!==key){const node=createShape(shape);if(entry)entry.node.replaceWith(node);else svg.append(node);entry={node,key};nodes.set(shape.id,entry);}
    entry.node.style.setProperty('--opacity',shape.opacity);entry.node.style.setProperty('--glow',shape.glowIntensity*6+'px');entry.node.style.setProperty('--animation-ms',shape.animationMs+'ms');entry.node.classList.toggle('removing',!!removing);
    entry.node.classList.toggle('waiting-speech',!!waitingForSpeech);entry.node.classList.toggle('speech-paused',!!paused);
   }
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   if(latest!==revision)return;
   if(!svg.isConnected||svg.clientWidth<1||svg.clientHeight<1||[...nodes.values()].some(entry=>!entry.node.isConnected))throw Error('Annotation surface is not drawable');
   window.annotationOverlay.acknowledge({revision,ids:[...ids]});
  }catch(error){svg.replaceChildren();nodes.clear();window.annotationOverlay.acknowledge({revision,error:String(error.message)});}
 });
 window.annotationOverlay.ready();
})();
