'use strict';
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {FloatingCursor}=require('./floating-cursor');
const {CursorFlight}=require('./cursor-flight');
const FALLBACK='#9D9DFF';
class ControlOverlay extends EventEmitter{
  constructor({BrowserWindow,screen,engine,getAccent=()=>FALLBACK,getCursorColor=getAccent,getCursorOptions=()=>({}),getDockPoint,getIslandWindow=()=>null}){
    super();Object.assign(this,{BrowserWindow,screen,engine,getAccent,getCursorColor,getCursorOptions,getDockPoint,getIslandWindow});this.windows=new Map();this.state={active:false};this.cursorState={visible:false};this.floating=new FloatingCursor();this.flight=null;this.flightPose=null;
    this.agentFlights=[];this.agentFlightTimers=new Set();this.agentLaunchSequence=0;
    this.onAgentLaunch=value=>this.launchAgent(value);engine.on('agent-launch',this.onAgentLaunch);
    this.onState=state=>this.update(state);this.onCursor=value=>{this.cursorState={target:value?.target||null,visible:value?.visible===true,message:String(value?.message||'').slice(0,2000),phase:['Listening','Processing','Responding','Idle'].includes(value?.phase)?value.phase:'Idle',level:Math.max(0,Math.min(1,Number(value?.level)||0)),x:Number.isFinite(value?.x)?value.x:null,y:Number.isFinite(value?.y)?value.y:null};this.present();};this.onOffline=()=>{this.nativeOrderReady=false;this.nativeOrderKey=null;this.cursorState={visible:false};this.update({active:false});};this.onDisplays=()=>{if(this.visible()){this.destroyWindows();this.render();}};
    engine.on('computer-control',this.onState);engine.on('offline',this.onOffline);
    engine.on('cursor-state',this.onCursor);
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,this.onDisplays);
    // Visible renderers drive movement from their monitor's compositor clock.
    // The slow watchdog only bootstraps or recovers when there is no frame source.
    this.lastFrameAt=0;this.followTimer=setInterval(()=>{if(Date.now()-this.lastFrameAt>250)this.follow();this.keepOnTop();},100);this.followTimer.unref();this.follow();
  }
  attachIslandAbove(owner){
    const island=this.getIslandWindow();if(!island||island.isDestroyed()||owner.isDestroyed())return;
    const bounds=island.getBounds(),display=this.screen.getDisplayNearestPoint?.({x:bounds.x+bounds.width/2,y:bounds.y+16});
    if(display&&this.windows.get(display.id)!==owner)return;
    if(island.getParentWindow()!==owner)island.setParentWindow(owner);
  }
  detachIsland(){const island=this.getIslandWindow();if(island&&!island.isDestroyed()&&[...this.windows.values()].includes(island.getParentWindow()))island.setParentWindow(null);}
  nativeHandle(win){
    if(!win||win.isDestroyed()||typeof win.getNativeWindowHandle!=='function')return '0';
    const value=win.getNativeWindowHandle();return value.length>=8?value.readBigUInt64LE(0).toString():String(value.readUInt32LE(0));
  }
  syncNativeOrder(){
    if(typeof this.engine.request!=='function'||this.engine.connected===false)return;
    const handles=[...this.windows.values()].filter(win=>!win.isDestroyed()&&win.isVisible()).map(win=>this.nativeHandle(win)).filter(value=>value!=='0');
    const islandHandle=this.nativeHandle(this.getIslandWindow()),key=JSON.stringify([handles,islandHandle]);this.nativeOrderDesired=key;
    if(this.nativeOrderPending||key===this.nativeOrderKey)return;
    this.nativeOrderPending=true;this.nativeOrderReady=false;this.nativeOrderKey=key;
    void this.engine.request('control-overlay-order',{clientPid:process.pid,handles,islandHandle}).then(value=>{
      if(this.nativeOrderDesired===key)this.nativeOrderReady=value.eventDriven===true&&value.registered===handles.length;
    }).catch(error=>{if(this.nativeOrderDesired===key){this.nativeOrderKey=null;this.nativeOrderReady=false;}if(!this.orderWarning){this.orderWarning=true;this.emit('diagnostic','Overlay ordering: '+error.message);}}).finally(()=>{this.nativeOrderPending=false;if(this.nativeOrderDesired!==key)this.syncNativeOrder();});
  }
  keepOnTop(){
    if(this.closed)return;this.syncNativeOrder();
    const now=Date.now();if(now-(this.lastRaisedAt||0)<500)return;this.lastRaisedAt=now;
    for(const win of this.windows.values())if(!win.isDestroyed()&&win.isVisible()){
      this.attachIslandAbove(win);
      // Native window events maintain the group without repeatedly lifting the
      // glow over the island. Keep Electron's watchdog for startup/recovery.
      if(!this.nativeOrderReady){win.setAlwaysOnTop(true,'screen-saver');win.moveTop();}
    }
  }
  follow(){
    if(this.closed)return;
    const old=this.floating.point,wasDetached=this.floating.detached,oldBoost=this.floating.boost;
    const point=this.screen.getCursorScreenPoint?.();if(!point)return;
    // Computer control owns its pointer; physical movement must never cancel it.
    if(this.state.active){this.flight=null;this.flightPose=null;return;}
    const next=this.floating.update(point,this.getCursorOptions());
    const dock=this.getDockPoint?.();
    if(dock&&Boolean(old)!==Boolean(next))this.flight=new CursorFlight({kind:next?'launch':'return',from:this.flightPose?.point||(next?dock:old),to:next||dock,startScale:this.flightPose?.scale,startOpacity:this.flightPose?.opacity});
    const moving=Boolean(this.flight);
    if(this.flight){this.flightPose=this.flight.sample(Date.now(),this.flight.kind==='launch'?next||dock:dock);if(this.flightPose.done){this.flight=null;this.flightPose=null;}}
    if(moving||oldBoost!==this.floating.boost||Boolean(old)!==Boolean(next)||old&&next&&(old.x!==next.x||old.y!==next.y)||wasDetached!==this.floating.detached)this.present();
  }
  preferencesChanged(){this.follow();this.present();}
  launchAgent(value){
    if(this.closed||typeof value?.id!=='string'||value.id.length>200||this.agentFlights.some(f=>f.id===value.id))return;
    const start=this.floating.point||this.screen.screenToDipPoint({x:Math.round(Number(value.x)||0),y:Math.round(Number(value.y)||0)}),display=this.screen.getPrimaryDisplay?.()||this.screen.getAllDisplays()[0];
    const end=this.getDockPoint?.()||{x:display.bounds.x+display.bounds.width/2,y:display.bounds.y+16};
    const filters=['hue-rotate(60deg)','hue-rotate(190deg)','hue-rotate(115deg)','hue-rotate(155deg)','hue-rotate(215deg)','hue-rotate(-70deg)','hue-rotate(-30deg)','hue-rotate(85deg)'];
    const flight={id:value.id,from:start,to:end,filter:filters[this.agentLaunchSequence++%filters.length],startedAt:Date.now()};this.agentFlights.push(flight);this.present();
    const timer=setTimeout(()=>{this.agentFlightTimers.delete(timer);this.agentFlights=this.agentFlights.filter(f=>f!==flight);this.present();},1400);timer.unref?.();this.agentFlightTimers.add(timer);
  }
  accent(){const value=this.getAccent();return /^#[\da-f]{6}$/i.test(value)?value:FALLBACK;}
  cursorColor(){const value=this.getCursorColor();return /^#[\da-f]{6}$/i.test(value)?value:this.accent();}
  update(state){
    this.state={active:state?.active===true,systemInput:state?.systemInput===true,acting:state?.acting===true,status:String(state?.status||'').slice(0,500),x:Number.isFinite(state?.x)?state.x:null,y:Number.isFinite(state?.y)?state.y:null};
    this.present();this.emit('change',this.state);
  }
  visible(){return Boolean(this.cursorState.target)||this.agentFlights.length>0||this.state.active||Boolean(this.flight)||!this.getCursorOptions().hideFloatingCursor&&(Boolean(this.floating.point)||this.cursorState.visible);}
  present(){if(this.visible())this.render();else this.destroyWindows();}
  render(){
    if(!this.visible()||this.closed)return;
    const source=this.state.active?this.state:this.cursorState;
    const point=!this.state.active&&(this.flightPose?.point||this.floating.point)?this.flightPose?.point||this.floating.point:source.x!==null&&source.y!==null?this.screen.screenToDipPoint({x:Math.round(source.x),y:Math.round(source.y)}):null;
    for(const display of this.screen.getAllDisplays()){
      let win=this.windows.get(display.id);
      if(!win||win.isDestroyed()){
        win=new this.BrowserWindow({x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:display.bounds.height,show:false,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,focusable:false,skipTaskbar:true,resizable:false,movable:false,enableLargerThanScreen:true,webPreferences:{preload:path.join(__dirname,'control-overlay/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
        this.windows.set(display.id,win);this.attachIslandAbove(win);win.controlReady=false;
        win.setIgnoreMouseEvents(true);win.setAlwaysOnTop(true,'screen-saver');win.setContentProtection(false);
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
        win.webContents.ipc?.on('control-visual-frame',event=>{
          if(this.closed||win.isDestroyed()||event.senderFrame!==win.webContents.mainFrame)return;
          const pointer=this.screen.getCursorScreenPoint?.(),location=this.state.active&&this.state.x!==null&&this.state.y!==null?this.screen.screenToDipPoint({x:this.state.x,y:this.state.y}):this.flightPose?.point||this.floating.point||pointer,activeDisplay=location?this.screen.getDisplayNearestPoint?.(location):null;
          if(activeDisplay&&activeDisplay.id!==display.id)return;
          this.lastFrameAt=Date.now();this.follow();
        });
        win.on('closed',()=>{if(this.windows.get(display.id)===win)this.windows.delete(display.id);});
        win.webContents.once('did-finish-load',()=>{if(win.isDestroyed())return;win.controlReady=true;if(this.visible())this.render();});
        win.loadFile(path.join(__dirname,'control-overlay/index.html')).catch(error=>this.emit('diagnostic',error.message));
      }
      if(!win.controlReady)continue;
      this.flight?.begin();
      const b=display.bounds,target=this.targetForDisplay(display),inside=!(this.state.active&&this.state.systemInput)&&(!this.getCursorOptions().hideFloatingCursor||this.state.active)&&point&&point.x>=b.x&&point.y>=b.y&&point.x<b.x+b.width&&point.y<b.y+b.height;
      const geometry=[b.x,b.y,b.width,b.height].join(':');if(win.controlGeometry!==geometry){win.setBounds(b,false);win.controlGeometry=geometry;}
      win.webContents.send('control-visual-state',{target,agentFlights:this.agentFlights.map(f=>({...f,from:{x:f.from.x-b.x,y:f.from.y-b.y},to:{x:f.to.x-b.x,y:f.to.y-b.y}})),accent:this.accent(),cursorColor:this.cursorColor(),scale:display.scaleFactor,width:b.width,height:b.height,glow:this.state.active,boost:!this.state.active&&!this.flight?this.floating.boost:0,cursorOpacity:this.flightPose?.opacity??1,cursorScale:this.flightPose?.scale??1,pointerOnly:this.state.active,phase:this.state.active||this.flight?'Idle':this.cursorState.phase||'Idle',message:this.state.active?'':this.cursorState.message||'',level:this.cursorState.level||0,cursor:inside?{x:point.x-b.x,y:point.y-b.y}:null});
      if(!win.isVisible())win.showInactive();
    }
    this.syncNativeOrder();
  }
  targetForDisplay(display){
    const ring=this.cursorState.target;if(!ring||![ring.x,ring.y,ring.radius].every(Number.isFinite)||ring.radius<=0)return null;
    const point=this.screen.screenToDipPoint({x:Math.round(ring.x),y:Math.round(ring.y)}),b=display.bounds;
    const frame=ring.frame;let box;
    if(frame&&[frame.x,frame.y,frame.width,frame.height].every(Number.isFinite)&&frame.width>0&&frame.height>0){
      const start=this.screen.screenToDipPoint({x:Math.round(frame.x),y:Math.round(frame.y)});
      box={x:start.x-b.x,y:start.y-b.y,width:frame.width/display.scaleFactor,height:frame.height/display.scaleFactor};
    }else{const radius=ring.radius/display.scaleFactor;box={x:point.x-b.x-radius,y:point.y-b.y-radius,width:radius*2,height:radius*2};}
    return {...box,rounded:!frame,label:String(ring.label||'').slice(0,200)};
  }
  destroyWindows(){this.detachIsland();for(const win of this.windows.values())if(!win.isDestroyed())win.destroy();this.windows.clear();this.syncNativeOrder();}
  close(){this.closed=true;this.engine.off('agent-launch',this.onAgentLaunch);for(const timer of this.agentFlightTimers)clearTimeout(timer);this.agentFlightTimers.clear();clearInterval(this.followTimer);this.engine.off('computer-control',this.onState);this.engine.off('cursor-state',this.onCursor);this.engine.off('offline',this.onOffline);for(const event of ['display-added','display-removed','display-metrics-changed'])this.screen.off(event,this.onDisplays);this.destroyWindows();}
}
module.exports={ControlOverlay};


