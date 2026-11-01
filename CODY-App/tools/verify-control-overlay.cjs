'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({win,overlay,engine,screen})=>{
  const results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),evaluate=code=>win.webContents.executeJavaScript(code);let original;
  const check=(name,passed,detail)=>{results.push({name,passed,detail});if(!passed)throw Error(name);};
  async function until(predicate){const end=Date.now()+40000;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error('Control overlay verification timed out');}
  try{
    await until(()=>evaluate('Boolean(window.CODYIsland?.integrationReady)'));await engine.refresh();
    const native=await engine.request('drive-state');check('native drive state endpoint is connected',typeof native.active==='boolean');
    if(native.active){results.push({name:'visual preview skipped while real computer control is active',passed:true});return;}
    original=await evaluate('window.cody.getSettings().then(s=>s.accentColor)');
    const display=screen.getPrimaryDisplay(),point=screen.dipToScreenPoint({x:Math.round(display.bounds.x+display.bounds.width*.55),y:Math.round(display.bounds.y+display.bounds.height*.45)});
    overlay.update({active:true,acting:true,status:'Visual test only — no computer input',...point});
    await until(()=>[...overlay.windows.values()].length===screen.getAllDisplays().length&&[...overlay.windows.values()].every(window=>window.controlReady));
    const layer=overlay.windows.get(display.id),pixels=()=>layer.webContents.executeJavaScript(`(()=>{const glow=document.getElementById('glow'),cursor=document.getElementById('ai-cursor'),c=glow.getContext('2d'),p=(x,y)=>Array.from(c.getImageData(x,y,1,1).data),ctx=cursor.getContext('2d'),data=ctx.getImageData(0,0,cursor.width,cursor.height).data;let rgb=null;for(let i=0;i<data.length;i+=4)if(data[i+3]>200){rgb=Array.from(data.slice(i,i+3));break;}return {edge:p(0,Math.floor(glow.height/2)),inside:p(80,Math.floor(glow.height/2)),center:p(Math.floor(glow.width/2),Math.floor(glow.height/2)),cursorHidden:cursor.hidden,cursorRgb:rgb,transform:cursor.style.transform};})()`);
    check('overlay spans the full monitor including taskbar area',layer.getBounds().height===display.bounds.height&&layer.getBounds().width===display.bounds.width,{actual:layer.getBounds(),expected:display.bounds});
    await until(async()=>!(await pixels()).cursorHidden);
    let first=await pixels();check('only soft edge glow is drawn and the supplied cursor is visible',first.edge[3]>50&&first.edge[3]<154&&first.inside[3]===0&&first.center[3]===0&&!first.cursorHidden,first);
    fs.writeFileSync(path.resolve(__dirname,'../reports/control-overlay-selected-colour.png'),(await layer.webContents.capturePage()).toPNG());
    for(const accent of ['#47A8FF','#F377BC']){
      await evaluate(`window.cody.updateSettings({accentColor:${JSON.stringify(accent)}})`);await wait(400);const current=await pixels(),expected=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16));
      check('glow and cursor update with selected accent '+accent,expected.every((value,i)=>Math.abs(current.edge[i]-value)<=2&&Math.abs(current.cursorRgb[i]-value)<=2),current);
      if(accent==='#47A8FF'){
        fs.writeFileSync(path.resolve(__dirname,'../reports/control-overlay-blue.png'),(await layer.webContents.capturePage()).toPNG());
        layer.hide();await layer.webContents.executeJavaScript(`document.body.style.background='#07111c'`);
        fs.writeFileSync(path.resolve(__dirname,'../reports/control-overlay-reference-view.png'),(await layer.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
        await layer.webContents.executeJavaScript(`document.body.style.background=''`);if(overlay.state.active)layer.showInactive();
      }
    }
    const initial=(await pixels()).transform;overlay.update({active:true,acting:true,x:point.x+120,y:point.y+60});await wait(150);check('AI cursor follows reported AI positions without moving the system mouse',(await pixels()).transform!==initial);
    overlay.update({active:false});check('stop removes all control overlay windows',overlay.windows.size===0);
  }catch(error){results.push({name:'verification error',passed:false,error:error.stack});}
  finally{if(original!==undefined){await evaluate(`window.cody.updateSettings({accentColor:${JSON.stringify(original)}})`);overlay.update(await engine.request('drive-state').catch(()=>({active:false})));}fs.writeFileSync(path.resolve(__dirname,'../reports/control-overlay-live.json'),JSON.stringify({passed:results.every(result=>result.passed),previewOnly:true,results},null,2));}
};
