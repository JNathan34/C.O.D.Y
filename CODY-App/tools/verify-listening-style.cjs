'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,overlay,engine,screen})=>{
 const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms)),emit=engine.emit,original={...overlay.cursorState};
 const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
 try{
  for(let i=0;i<300&&!await win.webContents.executeJavaScript('Boolean(window.CODYIsland?.integrationReady)');i++)await wait(100);
  if((await engine.request('drive-state')).active)throw Error('Active computer control; skip visual fixture');
  engine.emit=function(event,data,...args){if(event==='cursor-state'&&!data.fixture)return false;return emit.call(this,event,data,...args);};
  const display=screen.getPrimaryDisplay(),point=screen.dipToScreenPoint({x:display.bounds.x+100,y:display.bounds.y+100});
  engine.emit('cursor-state',{fixture:true,visible:true,phase:'Listening',level:.5,...point});
  for(let i=0;i<100&&!overlay.windows.get(display.id)?.controlReady;i++)await wait(50);await wait(900);
  const layer=overlay.windows.get(display.id),stats=await layer.webContents.executeJavaScript(`(()=>{const c=document.getElementById('ai-cursor'),ctx=c.getContext('2d'),data=ctx.getImageData(0,0,80,80).data;let left=80,right=0;for(let y=0;y<80;y++)for(let x=0;x<80;x++)if(data[(y*80+x)*4+3]>20){left=Math.min(left,x);right=Math.max(right,x);}return{phase:c.dataset.phase,opacity:getComputedStyle(c).opacity,circleEdge:ctx.getImageData(19,34,1,1).data[3],width:right-left+1,image:c.toDataURL().split(',')[1]};})()`);
  fs.writeFileSync(path.resolve(__dirname,'../reports/listening-bars.png'),Buffer.from(stats.image,'base64'));delete stats.image;
  check('listening uses larger bare bars with subtle transparency',stats.phase==='listening'&&stats.opacity==='0.96'&&stats.circleEdge<3&&stats.width>=24,stats);
  for(const phase of ['Processing','Idle']){engine.emit('cursor-state',{fixture:true,visible:true,phase,level:0,...point});await wait(800);const opacity=await layer.webContents.executeJavaScript(`getComputedStyle(document.getElementById('ai-cursor')).opacity`);check(phase+' keeps the same subtle transparency',opacity==='0.96');
   if(phase==='Processing'){
    const dots=await layer.webContents.executeJavaScript(`(()=>{const c=document.getElementById('ai-cursor'),ctx=c.getContext('2d'),row=ctx.getImageData(0,33,80,1).data;let groups=0,inside=false;for(let x=0;x<80;x++){const painted=row[x*4+3]>20;if(painted&&!inside)groups++;inside=painted;}return{groups,ringEdge:ctx.getImageData(34,19,1,1).data[3],image:c.toDataURL().split(',')[1]};})()`);
    fs.writeFileSync(path.resolve(__dirname,'../reports/thinking-dots.png'),Buffer.from(dots.image,'base64'));delete dots.image;check('thinking displays five separate loading dots without a circle',dots.groups===5&&dots.ringEdge<3,dots);
   }
   if(phase==='Idle'){
    const render=overlay.render;overlay.render=()=>{};
    try{
     const send=(x,y,boost=0)=>layer.webContents.send('control-visual-state',{accent:overlay.accent(),cursorColor:overlay.cursorColor(),scale:display.scaleFactor,width:display.bounds.width,height:display.bounds.height,glow:false,phase:'Idle',level:0,boost,cursor:{x,y}}),angle=()=>layer.webContents.executeJavaScript(`Number(document.getElementById('ai-cursor').dataset.rotation)`),distance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
     send(100,100);await wait(150);send(200,100);await wait(850);const right=await angle();check('cursor turns to point in its direction of travel',distance(right,Math.PI*.75)<.06,{right});
     send(200,200);await wait(850);const down=await angle();check('cursor smoothly turns when movement changes direction',distance(down,Math.PI*1.25)<.06,{down});
     await wait(350);const still=await angle();check('cursor holds its heading instead of spinning when stopped',distance(still,down)<.02,{down,still});
     const expected=[1,3,5].map(i=>Math.round(parseInt(overlay.cursorColor().slice(i,i+2),16)*.74)),outline=await layer.webContents.executeJavaScript(`(()=>{const pixels=document.getElementById('ai-cursor').getContext('2d').getImageData(0,0,80,80).data,expected=${JSON.stringify(expected)};let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>240&&expected.every((v,k)=>Math.abs(pixels[i+k]-v)<7))count++;return count;})()`);check('pointer has a thin outline in a darker shade of its selected colour',outline>5,{outlinePixels:outline,expected});
     send(200,200,1);await wait(150);const burst=await layer.webContents.executeJavaScript(`(()=>{const c=document.getElementById('ai-cursor'),pixels=c.getContext('2d').getImageData(22,4,25,14).data;return{boost:Number(c.dataset.boost),streakPixels:Array.from(pixels).filter((v,i)=>i%4===3&&v>20).length,image:c.toDataURL().split(',')[1]};})()`);fs.writeFileSync(path.resolve(__dirname,'../reports/cursor-boost.png'),Buffer.from(burst.image,'base64'));delete burst.image;check('boost draws a small burst of speed streaks behind the pointer',burst.boost===1&&burst.streakPixels>10,burst);
     send(200,200,0);await wait(100);check('speed streaks clear when the boost ends',await layer.webContents.executeJavaScript(`document.getElementById('ai-cursor').dataset.boost==='0'`));
    }finally{overlay.render=render;overlay.present();}
   }
  }
 }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
 finally{engine.emit=emit;engine.emit('cursor-state',original);fs.writeFileSync(path.resolve(__dirname,'../reports/listening-style-live.json'),JSON.stringify({passed:results.every(r=>r.passed),results},null,2));}
};
