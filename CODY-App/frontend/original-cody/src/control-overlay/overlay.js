'use strict';
(()=>{
  const glow=document.getElementById('glow'),cursor=document.getElementById('ai-cursor'),image=new Image();
  let last=null,glowKey='',cursorColour='',frame=null,listen=0,loading=0,previous=performance.now(),lastPoint=null,heading=0,targetHeading=0;
  const tinted=document.createElement('canvas'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const seenFlights=new Set();
  function agentFlight(flight){
    if(seenFlights.has(flight.id))return;seenFlights.add(flight.id);if(seenFlights.size>256)seenFlights.delete(seenFlights.values().next().value);
    const duration=reduced.matches?250:1100,elapsed=Date.now()-flight.startedAt;if(elapsed>=duration)return;
    const mascot=document.createElement('img');mascot.className='agent-flight-mascot';mascot.src='../../assets/brand/cody-256.png';mascot.alt='';mascot.style.filter=flight.filter;document.body.append(mascot);
    const frames=[];for(let i=0;i<=30;i++){const t=i/30,p=t*t*(3-2*t),a=1-p,s=flight.from,e=flight.to;
      const x=reduced.matches?e.x:a*a*a*s.x+3*a*a*p*(s.x+35)+3*a*p*p*(e.x-35)+p*p*p*e.x;
      const y=reduced.matches?e.y:a*a*a*s.y+3*a*a*p*(s.y-90)+3*a*p*p*(e.y+65)+p*p*p*e.y;
      frames.push({offset:t,transform:`translate(${x-20}px,${y-20}px) rotate(${Math.sin(p*Math.PI)*12}deg) scale(${.85+.15*Math.sin(p*Math.PI)-.4*Math.pow(p,4)})`,opacity:t<.1?t*10:t>.8?(1-t)*5:1});
    }
    const animation=mascot.animate(frames,{duration,fill:'forwards'});animation.currentTime=Math.max(0,elapsed);animation.onfinish=animation.oncancel=()=>mascot.remove();
  }
  // Same vector silhouette as cursor.svg, outlined once in the cached colour layer.
  const pointerOutline=new Path2D('M8 5.6c-1.7-.7-3.4.8-3 2.6l7.8 32.2c.6 2.5 3.9 2.8 4.9.4l6.1-14.1 15-5.3c2.5-.9 2.6-4.3.2-5.3Z');
  // Geometry and Gaussian falloff match Computer Control Design/OverlayCore.cs v5.
  function drawGlow(width,height,accent){
    glow.width=width;glow.height=height;const context=glow.getContext('2d');
    const rgb=[1,3,5].map(start=>parseInt(accent.slice(start,start+2),16)),depth=Math.min(72,Math.floor(Math.min(width,height)/2));
    function strip(left,top,w,h){
      if(w<=0||h<=0)return;const pixels=context.createImageData(w,h),data=pixels.data;
      const cx=width/2,cy=height/2,bx=cx+14,by=cy+14,radius=64;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const qx=Math.abs(left+x+.5-cx)-(bx-radius),qy=Math.abs(top+y+.5-cy)-(by-radius);
        const distance=Math.abs(Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-radius);
        if(distance>68)continue;const alpha=Math.round(154*Math.exp(-distance*distance/(2*19*19)));if(alpha<1)continue;
        const index=(y*w+x)*4;data[index]=rgb[0];data[index+1]=rgb[1];data[index+2]=rgb[2];data[index+3]=alpha;
      }
      context.putImageData(pixels,left,top);
    }
    strip(0,0,width,depth);strip(0,height-depth,width,depth);strip(0,depth,depth,height-2*depth);strip(width-depth,depth,depth,height-2*depth);
  }
  const target=document.createElement('div');target.id='guided-target';target.hidden=true;document.body.append(target);
  function render(state){
    const box=state.target;target.hidden=!box;
    if(box){Object.assign(target.style,{left:(box.x-5)+'px',top:(box.y-5)+'px',width:(box.width+10)+'px',height:(box.height+10)+'px',borderColor:state.cursorColor||state.accent,borderRadius:box.rounded?'50%':'9px'});target.setAttribute('aria-label',box.label||'Suggested control');}

    for(const flight of state.agentFlights||[])agentFlight(flight);
    const bubble=document.getElementById('agent-message');bubble.hidden=!state.message||!state.cursor;
    bubble.textContent=state.message||'';
    if(!bubble.hidden){const w=bubble.offsetWidth,h=bubble.offsetHeight;bubble.style.left=Math.max(8,Math.min(state.width-w-8,state.cursor.x+30))+'px';bubble.style.top=Math.max(8,Math.min(state.height-h-8,state.cursor.y+28))+'px';}
    if(state.pointerOnly){listen=0;loading=0;}
    last=state;const scale=state.scale||1,key=[state.width,state.height,scale,state.accent].join(':'),color=state.cursorColor||state.accent;
    glow.hidden=state.glow===false;
    if(!glow.hidden&&key!==glowKey){drawGlow(Math.round(state.width*scale),Math.round(state.height*scale),state.accent);glowKey=key;}
    cursor.hidden=!state.cursor||!image.complete||!image.naturalWidth;
    if(cursor.hidden){lastPoint=null;return;}
    if(lastPoint){const dx=state.cursor.x-lastPoint.x,dy=state.cursor.y-lastPoint.y;if(dx*dx+dy*dy>.09)targetHeading=Math.atan2(dy,dx)+Math.PI*.75;}
    lastPoint={...state.cursor};
    if(cursorColour!==color){
      tinted.width=image.naturalWidth;tinted.height=image.naturalHeight;const context=tinted.getContext('2d');context.drawImage(image,0,0);context.globalCompositeOperation='source-in';context.fillStyle=color;context.fillRect(0,0,tinted.width,tinted.height);context.globalCompositeOperation='source-over';cursorColour=color;
      context.strokeStyle='#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*.74).toString(16).padStart(2,'0')).join('');context.lineWidth=1.25;context.lineJoin='round';context.stroke(pointerOutline);
    }
    if(cursor.width!==80){cursor.width=80;cursor.height=80;}
    cursor.style.width=(80/scale)+'px';cursor.style.height=(80/scale)+'px';
    cursor.dataset.phase=state.phase==='Listening'?'listening':state.phase==='Processing'?'loading':'pointer';
    if(frame===null){previous=performance.now();frame=requestAnimationFrame(animate);}
  }
  function animate(now){
    frame=null;if(!last||cursor.hidden)return;
    const scale=last.scale||1;cursor.style.opacity=String(.96*(last.cursorOpacity??1));cursor.style.transformOrigin=`${34/scale}px ${34/scale}px`;
    cursor.style.transform=`translate(${last.cursor.x-16/scale}px,${last.cursor.y-16/scale}px) scale(${last.cursorScale??1})`;
    const dt=Math.min(80,now-previous);previous=now;const ease=reduced.matches?1:1-Math.exp(-dt/95),targetListen=last.phase==='Listening'?1:0,targetLoad=last.phase==='Processing'?1:0;
    listen+=(targetListen-listen)*ease;loading+=(targetLoad-loading)*ease;
    cursor.dataset.morph=`${Math.round(listen*100)},${Math.round(loading*100)}`;
    const morph=Math.min(1,listen+loading),ctx=cursor.getContext('2d');ctx.clearRect(0,0,80,80);ctx.save();ctx.translate(34,34);
    const turn=Math.atan2(Math.sin(targetHeading-heading),Math.cos(targetHeading-heading));
    heading+=Math.abs(turn)<.001?turn:turn*(reduced.matches?1:1-Math.exp(-dt/60));cursor.dataset.rotation=String(heading);
    const boost=reduced.matches?0:Math.max(0,Math.min(1,last.boost||0));cursor.dataset.boost=String(boost);
    if(boost>.001&&morph<.999){ctx.save();ctx.rotate(heading-Math.PI*.75);ctx.globalAlpha=boost*(1-morph)*.65;ctx.strokeStyle=last.cursorColor||last.accent;ctx.lineWidth=2;ctx.lineCap='round';for(let i=-1;i<=1;i++){const length=7+3*Math.sin(now/45+i);ctx.beginPath();ctx.moveTo(-19,i*7);ctx.lineTo(-19-length,i*7);ctx.stroke();}ctx.restore();}
    if(morph<.999){ctx.save();ctx.globalAlpha=1-morph;ctx.rotate(heading+morph*.7);ctx.scale(1-morph*.55,1-morph*.55);ctx.drawImage(tinted,-24,-24,48,48);ctx.restore();}
    if(morph>.001){ctx.save();ctx.globalAlpha=morph;ctx.scale(.4+morph*.6,.4+morph*.6);ctx.strokeStyle=last.cursorColor||last.accent;ctx.fillStyle=last.cursorColor||last.accent;ctx.shadowColor=last.cursorColor||last.accent;ctx.shadowBlur=0;ctx.lineWidth=2.5;ctx.lineCap='round';
      if(loading>.001){ctx.save();for(let i=0;i<5;i++){const pulse=reduced.matches?1:(1+Math.cos((now+i*150)/1020*Math.PI*2))/2;ctx.globalAlpha=loading*(.35+.65*pulse);ctx.beginPath();ctx.arc((i-2)*7,-2*pulse,2+1.2*pulse,0,Math.PI*2);ctx.fill();}ctx.restore();}
      if(listen>.02){ctx.save();ctx.scale(1.2,1.2);ctx.globalAlpha=listen;const level=Math.min(1,(last.level||0)*7);for(let i=0;i<4;i++){const h=5+level*(8+8*Math.abs(Math.sin(now/140+i)));ctx.beginPath();ctx.roundRect(-9+i*6,-h/2,3,h,2);ctx.fill();}ctx.restore();}
      ctx.restore();
    }ctx.restore();
    if(!reduced.matches&&(targetListen||targetLoad||boost>.001)||Math.abs(turn)>.001||Math.abs(listen-targetListen)>.001||Math.abs(loading-targetLoad)>.001)frame=requestAnimationFrame(animate);
  }
  const timing=window.CODYCursorTiming={frames:0,intervals:[]};let previousFrame=null;
  function monitorFrame(now){if(previousFrame!==null){timing.intervals.push(now-previousFrame);if(timing.intervals.length>180)timing.intervals.shift();}previousFrame=now;timing.frames++;window.controlVisuals.frame();requestAnimationFrame(monitorFrame);}
  requestAnimationFrame(monitorFrame);
  image.onload=()=>{if(last)render(last);};image.src='cursor.svg';window.controlVisuals.onState(render);
})();
