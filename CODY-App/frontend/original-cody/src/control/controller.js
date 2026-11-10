'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ACTIONS,DEFAULT_PERMISSIONS,normalizePermissions,availableActions,permissionError,needsApproval}=require('./policy');
const windows=require('./windows');
const fileEngine=require('./file-engine');
const devTools=require('./dev-tools');
const uiAutomation=require('./ui-automation');
const archive=require('./archive');
const {validateBrowserArgs}=require('./firefox-args');
const {compactBrowserObservation}=require('./browser-observation');
const {accessScope}=require('./access-scope');
const {validate:validateDrawing}=require('../annotations/schema');
const {validate:validateScene}=require('../visuals/schema');
const {splitMetadata}=require('../visuals/ledger');
const {splitApps,validateSplitApps,appPin}=require('./app-layout');
const {normalizeApp}=require('../app-commands');
const {validateSystemArgs,buildSystemScript}=require('./system-settings');
const {validateDiscordArgs,runDiscordCommand}=require('./discord');

function ensureArgs(action,args){
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Action arguments must be an object');
  const integer=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)throw Error(`Invalid ${label}`);return v;};
  const str=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`Invalid ${label}`);return v;};
  switch(action){
    case 'system.radio.set':case 'system.radio.status':case 'system.power.set':case 'system.power.status':case 'system.brightness.set':case 'system.brightness.status':case 'system.settings.open':return validateSystemArgs(action,args);
    case 'system.status': case 'window.list': case 'app.list':case 'process.list': case 'clipboard.read':case 'screen.list':return {};
    case 'screen.capture':{
      if(Object.keys(args).some(key=>!['includeAnnotations','displayId','crop'].includes(key)))throw Error('Invalid screenshot argument');
      if(args.includeAnnotations!==undefined&&typeof args.includeAnnotations!=='boolean')throw Error('Invalid screenshot annotation option');
      if(args.displayId!==undefined&&!['string','number'].includes(typeof args.displayId))throw Error('Invalid screenshot display');
      if(args.crop!==undefined&&(!args.crop||Object.keys(args.crop).sort().join(',')!=='height,width,x,y'||!['x','y','width','height'].every(key=>Number.isInteger(args.crop[key])&&args.crop[key]>=0&&args.crop[key]<=100000)))throw Error('Invalid screenshot crop');
      return {...args};
    }
    case 'app.open':return {app:str(args.app,60,'application').toLowerCase()};
    case 'app.split':return {apps:validateSplitApps(args.apps)};
    case 'text.proofread':if(args.target!==undefined&&(typeof args.target!=='string'||!/^[a-f0-9-]{36}$/i.test(args.target)))throw Error('Invalid text target');return args.target?{target:args.target}:{};
    case 'window.pin':{const app=normalizeApp(args.app);if(!app||typeof args.pinned!=='boolean')throw Error('Choose a supported app and pin state.');return {app,pinned:args.pinned};}
    case 'audio.set':return {level:integer(args.level,0,100,'volume')};
    case 'discord.voice':case 'discord.share':case 'discord.leave':return validateDiscordArgs(action,args);
    case 'spotify.control':if(!['play','pause','toggle','next','previous'].includes(args.command))throw Error('Invalid Spotify command');return {command:args.command};
    case 'media.control':{
      if(!['play','pause','toggle','next','previous','seek'].includes(args.command))throw Error('Invalid media command');
      const target=args.target;
      if(target!==undefined&&!['current','plezy'].includes(target))throw Error('Invalid media target');
      const result={command:args.command,...(target?{target}:{source:str(args.source,512,'media source')})};
      if(args.command==='seek'){if(!Number.isFinite(args.seconds)||args.seconds===0||Math.abs(args.seconds)>86400)throw Error('Invalid seek duration');result.seconds=args.seconds;}return result;
    }
    case 'plezy.play':return {title:str(args.title,180,'Plezy title')};
    case 'audio.mute':if(typeof args.muted!=='boolean')throw Error('Invalid mute value');return {muted:args.muted};
    case 'window.focus':case 'window.minimize':case 'window.maximize':case 'app.close':return {pid:integer(args.pid,1,2**31-1,'process id')};
    case 'keyboard.hotkey':{const name=str(args.hotkey,64,'hotkey').toLowerCase().replace(/\s+/g,'').replace(/control/g,'ctrl').replace(/command/g,'win').replace(/escape/g,'esc').replace(/return/g,'enter');if(!windows.HOTKEYS[name])throw Error('Invalid hotkey. Supported: '+Object.keys(windows.HOTKEYS).join(', '));return {hotkey:name};}
    case 'keyboard.type':return {text:str(args.text,1000,'keyboard text')};
    case 'mouse.move':return {x:integer(args.x,-32768,32767,'x'),y:integer(args.y,-32768,32767,'y')};
    case 'mouse.click':if(!['left','right','middle'].includes(args.button))throw Error('Invalid mouse button');return {button:args.button};
    case 'clipboard.write':return {text:str(args.text,4096,'clipboard text')};
    case 'files.list':return {path:args.path===undefined?'.':str(args.path,1024,'file path')};
    case 'files.read':return {path:str(args.path,1024,'file path')};
    case 'files.write':return {path:str(args.path,1024,'file path'),text:typeof args.text==='string'&&Buffer.byteLength(args.text,'utf8')<=131072?args.text:(()=>{throw Error('File contents must be text under 128 KiB')})()};
    default:
      if(action.startsWith('draw.')){const split=splitMetadata(args);return {...validateDrawing(action,split.args),...split.metadata};}
      if(/^(scene|model)\./.test(action)){const split=splitMetadata(args);return {...validateScene(action,split.args),...split.metadata};}
      if(action.startsWith('browser.'))return validateBrowserArgs(action,args);
      if(action==='archive.create'||action==='archive.extract')return {path:str(args.path,1024,'archive path'),destination:str(args.destination,1024,'destination')};
      if (/^(file\.|folder\.)/.test(action)) return fileEngine.validateArgs(action,args);
      if (action==='desktop.inspect') return {pid:Number.isInteger(args.pid)&&args.pid>0?args.pid:undefined};
      if (action==='desktop.click') return {pid:integer(args.pid,1,2**31-1,'pid'),name:str(args.name,120,'accessible name')};
      if (['terminal.run','code.check','code.test','code.build'].includes(action))return devTools.validate(action,args);
      throw Error('Action is not supported');
  }
}
function contained(root,file){
  const relative=path.relative(root,file);
  return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
}
function resolveControlledPath(root,userPath,{write=false}={}){
  if(typeof root!=='string'||!root)throw Error('Choose an approved working folder first');
  const realRoot=fs.realpathSync(root);
  if(!fs.statSync(realRoot).isDirectory())throw Error('Working folder unavailable');
  const candidate=path.resolve(realRoot,userPath);
  if(!contained(realRoot,candidate))throw Error('This path is outside the approved working folder');
  if(write){
    const parent=fs.realpathSync(path.dirname(candidate));
    if(!contained(realRoot,parent))throw Error('The file parent leads outside the working folder');
    if(fs.existsSync(candidate)){
      const actual=fs.realpathSync(candidate);
      if(!contained(realRoot,actual))throw Error('The file link leads outside the working folder');
      if(!fs.statSync(actual).isFile())throw Error('Can only edit text files');
      return actual;
    }
    return candidate;
  }
  const real=fs.realpathSync(candidate);
  if(!contained(realRoot,real))throw Error('The selected file leads outside the working folder');
  return real;
}
function actionSummary(action,args,context={}){
  const value=['terminal.run','code.test','code.build'].includes(action)?'This runs a project command/script in the approved working folder. Project scripts can perform additional OS actions: review and trust the project before allowing.\n'+Object.entries(args).map(([k,v])=>k+': '+String(v)).join(', '):
    action==='keyboard.type'?`Type this text into the currently focused window (review carefully):\n${args.text.slice(0,600)}${args.text.length>600?'…':''}`:
    action==='files.write'?`Write ${Buffer.byteLength(args.text,'utf8')} bytes to ${args.path}\nPreview: ${args.text.slice(0,240)}`:
    action==='clipboard.write'?`Replace clipboard with this text:\n${args.text.slice(0,240)}`:
    action==='screen.capture'?(context.origin==='ai-chat'&&context.deliverImage===true?'Capture your screen for the current ChatGPT visual request':'Capture your screen (image remains within C.O.D.Y until you share it)'):
    action==='clipboard.read'?'Read the current contents of your clipboard':
    Object.entries(args).map(([key,value])=>`${key}: ${String(value).slice(0,90)}`).join(', ');
  return `${ACTIONS[action].description}\n\n${value}`;
}
class ComputerController {
  constructor({readPermissions,writePermissions,getWorkingFolder,confirm,runner,clipboard,desktopCapturer,logAction,developerRunner,browserBridge,spotify,annotations,scene,captures,visualLedger}={}){
    this.annotations=annotations;
    Object.assign(this,{scene,captures,visualLedger});
    this.spotify=spotify;
    this.readPermissions=readPermissions||(()=>DEFAULT_PERMISSIONS);
    this.writePermissions=writePermissions||(()=>{throw Error('Settings unavailable')});
    this.getWorkingFolder=getWorkingFolder||(()=>null);
    this.confirm=confirm||(()=>false);
    this.runner=runner||windows.runPowerShell;
    this.clipboard=clipboard;
    this.desktopCapturer=desktopCapturer;
    this.logAction=logAction||(()=>{});this.developerRunner=developerRunner||devTools.execute;this.browserBridge=browserBridge;
  }
  permissions(){return normalizePermissions(this.readPermissions());}
  configure(change){const perms=normalizePermissions(this.readPermissions(),change);this.writePermissions(perms);if(!perms.enabled||!perms.annotations)this.annotations?.clearImmediate('computer controls disabled');if(!perms.enabled||!perms.visual3d)this.scene?.clearImmediate('computer controls disabled');if(!perms.enabled){this.captures?.clear();this.visualLedger?.begin('gui');}return perms;}
  async refreshAnnotationTarget(reference,cache=new Map()){
    const error=permissionError('desktop.inspect',this.permissions());if(error)throw Error(error);
    if(!cache.has(reference.pid))cache.set(reference.pid,this.runner(uiAutomation.inspect(reference.pid)).then(value=>JSON.parse(value)));
    const windows=(await cache.get(reference.pid)).filter(window=>window.pid===reference.pid);
    if(reference.window){const matches=windows.filter(window=>window.title===reference.title);if(matches.length===1)return matches[0].bounds;}
    else{
      const controls=windows.flatMap(window=>window.controls||[]).filter(control=>control.role===reference.role&&(reference.automationId?control.automationId===reference.automationId:control.name===reference.name)&&(!reference.name||control.name===reference.name));
      if(controls.length===1)return controls[0].bounds;
    }
    throw Error('The observed UI target moved or is ambiguous. Inspect the desktop again');
  }
  catalog(){return availableActions(this.permissions());}
  async execute(action,args={},context={origin:'gui'}){
    const e=permissionError(action,this.permissions());if(e)throw Error(e);
    let clean=ensureArgs(action,args);
    const scope=accessScope(this.permissions().level,this.getWorkingFolder(),action,clean);
    clean=scope.args;
    const policy=ACTIONS[action];
    if(!['gui','chat','ai-chat'].includes(context.origin))throw Error('Invalid action origin');
    if(policy.directOnly&&context.origin!=='chat')throw Error('Use a direct C.O.D.Y. command for Discord control.');
    if(context.origin==='ai-chat'&&context.verifiedUserIntent!==true)throw Error('AI-origin control requires a verified human request');
    if(context.origin==='chat' && policy.risk!=='low'&&!['full','custom'].includes(this.permissions().level))throw Error('This action requires the dedicated controls in the C.O.D.Y GUI');
    if(needsApproval(action,this.permissions(),context.origin,{args:clean,humanTask:context.humanTask||''})){
      // Profile is enforced here, not by the renderer or model-generated text.
      if(!await this.confirm({action,summary:actionSummary(action,clean,context)+(context.origin==='ai-chat'&&action==='screen.capture'&&context.deliverImage===true?'\n\nThis screenshot will be attached to the current ChatGPT request in the cloud for visual inspection.':context.origin==='ai-chat'&&(['file.read','files.read','desktop.inspect','clipboard.read'].includes(action))?'\n\nData from this action may be sent to ChatGPT in the cloud.':'')})){try{this.logAction({action,status:'denied',origin:context.origin});}catch{}return {cancelled:true};}
    }
    let result;
    try{this.logAction({action,status:'started',origin:context.origin});}catch{}
    try{
    if(action.startsWith('draw.')){
      if(!this.annotations)throw Error('Annotation overlay is unavailable');
      result=this.visualLedger&&action!=='draw.status'?await this.visualLedger.execute(action,clean,context,(args,ctx)=>this.annotations.execute(action,args,ctx)):await this.annotations.execute(action,clean,context);
    }else if(/^(scene|model)\./.test(action)){
      if(!this.scene)throw Error('renderer_unavailable: 3D visuals are unavailable');
      result=this.visualLedger&&action!=='scene.status'?await this.visualLedger.execute(action,clean,context,(args,ctx)=>this.scene.execute(action,args,ctx)):await this.scene.execute(action,clean,context);
    }else{
    switch(action){
      case 'system.status':result=await windows.systemStatus();break;
      case 'system.radio.set':case 'system.radio.status':case 'system.power.set':case 'system.power.status':case 'system.brightness.set':case 'system.brightness.status':case 'system.settings.open':{
        result=JSON.parse(await this.runner(buildSystemScript(action,clean)));
        if(!result||typeof result.message!=='string'||!result.message.trim())throw Error('Windows did not return a settings result.');
        break;
      }
      case 'app.open':result=await this.runner(windows.openApp(clean.app));break;
      case 'app.split':result=await splitApps(clean.apps,{runner:this.runner});break;
      case 'text.proofread':if(!this.proofread)throw Error('Spelling correction is unavailable.');result=await this.proofread(clean.target);break;
      case 'window.pin':result=await appPin(clean.app,clean.pinned,{runner:this.runner});break;
      case 'audio.set':result=this.nativeAudio?await this.nativeAudio.set(clean.level):await this.runner(windows.audioSet(clean.level));break;
      case 'discord.voice':case 'discord.share':case 'discord.leave':result=await runDiscordCommand(action,clean,{runner:this.runner,signal:context.signal});break;
      case 'spotify.control':if(!this.spotify)throw Error('Spotify media control is unavailable.');result=await this.spotify.command(clean.command);break;
      case 'media.control':if(!this.spotify)throw Error('Windows media control is unavailable.');result=await this.spotify.command(clean.command,{target:clean.target||'active',source:clean.source,seconds:clean.seconds});break;
      case 'plezy.play':if(!this.plezy)throw Error('Plezy control is unavailable.');result=await this.plezy.play(clean.title);break;
      case 'audio.mute':result=this.nativeAudio?await this.nativeAudio.mute(clean.muted):await this.runner(windows.audioMute(clean.muted));break;
      case 'window.list':case 'app.list':case 'process.list':{
        const raw=await this.runner(action==='process.list'?windows.processList:windows.windowList);
        const parsed=raw?JSON.parse(raw):[];
        result=Array.isArray(parsed)?parsed:parsed?[parsed]:[];break;
      }
      case 'window.focus':result=await this.runner(windows.focusWindow(clean.pid));break;
      case 'window.minimize':result=await this.runner(windows.showWindow(clean.pid,6));break;
      case 'window.maximize':result=await this.runner(windows.showWindow(clean.pid,3));break;
      case 'app.close':result=await this.runner(windows.closeApp(clean.pid));break;
      case 'keyboard.hotkey':result=await this.runner(windows.hotkey(clean.hotkey));break;
      case 'keyboard.type':result=await this.runner(windows.typeText(clean.text));break;
      case 'mouse.move':result=await this.runner(windows.mouseMove(clean.x,clean.y));break;
      case 'mouse.click':result=await this.runner(windows.mouseClick(clean.button));break;
      case 'clipboard.read':if(!this.clipboard)throw Error('Clipboard unavailable');result=this.clipboard.readText().slice(0,4096);break;
      case 'clipboard.write':if(!this.clipboard)throw Error('Clipboard unavailable');this.clipboard.writeText(clean.text);result='Clipboard updated';break;
      case 'screen.list':{
        const service=this.captures?.screen||this.annotations?.screen||this.scene?.screen;if(!service)throw Error('Display information is unavailable');
        result={primaryDisplayId:String(service.getPrimaryDisplay().id),displays:service.getAllDisplays().map(display=>({id:String(display.id),label:display.label||'Display',bounds:display.bounds,workArea:display.workArea||display.bounds,scaleFactor:display.scaleFactor}))};break;
      }
      case 'screen.capture':{
        if(!this.desktopCapturer)throw Error('Screen capture unavailable');
        const capture=()=>this.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1600,height:900}});
        const capture3d=()=>this.scene?.adapter?this.scene.adapter.withoutVisuals(capture,clean.includeAnnotations===true):capture();
        const sources=this.annotations?.overlay?await this.annotations.overlay.withoutAnnotations(capture3d,{includeAnnotations:clean.includeAnnotations===true}):await capture3d();
        if(!sources.length)throw Error('No screens detected');
        const source=clean.displayId===undefined?sources[0]:sources.find(source=>String(source.display_id)===String(clean.displayId));if(!source)throw Error('display_not_found: requested screen is not present');
        const recorded=this.captures?.record(source,{scopeId:context.scopeId,crop:clean.crop});
        const bytes=recorded?.bytes||source.thumbnail.toPNG();if(bytes.length>8_000_000)throw Error('Screenshot exceeds 8 MB');
        result={name:source.name,mimeType:'image/png',...(context.origin==='ai-chat'?{attachmentPending:context.deliverImage===true}:{dataUrl:'data:image/png;base64,'+bytes.toString('base64')}),...(recorded?{metadata:recorded.metadata}:{}),visionDelivered:false};break;
      }
      case 'files.list':{
        const dir=resolveControlledPath(scope.root,clean.path);
        if(!fs.statSync(dir).isDirectory())throw Error('Not a directory');
        result=fs.readdirSync(dir,{withFileTypes:true}).slice(0,100).map(x=>({name:x.name,kind:x.isDirectory()?'directory':x.isFile()?'file':'other'}));break;
      }
      case 'files.read':{
        const file=resolveControlledPath(scope.root,clean.path);
        if(!fs.statSync(file).isFile())throw Error('Not a file');
        if(fs.statSync(file).size>131072)throw Error('File exceeds 128 KiB');
        const bytes=fs.readFileSync(file);if(bytes.includes(0))throw Error('Binary files are not supported');
        result=bytes.toString('utf8');break;
      }
      case 'files.write':{
        const file=resolveControlledPath(scope.root,clean.path,{write:true});
        const temp=path.join(path.dirname(file),`.cody-${randomUUID()}.tmp`);
        try{
          fs.writeFileSync(temp,clean.text,{encoding:'utf8',flag:'wx',mode:0o600});
          fs.renameSync(temp,file);
        }finally{try{fs.unlinkSync(temp)}catch{}}
        result=`Saved ${path.basename(file)}`;break;
      }
      default:{
        if(action.startsWith('browser.')){
          if(!this.browserBridge)throw Error('Firefox bridge unavailable');
          const response=await this.browserBridge.execute(action,clean,context.signal);
          // Bounded observations only: do not accidentally feed huge pages or screenshots into ChatGPT.
          if(['browser.readText','browser.readComments'].includes(action)){
            result={data:response?.data?.result??null,pageState:response?.pageState??null};
          }else result=compactBrowserObservation(action,response);
          break;
        }
        if(action==='archive.create'||action==='archive.extract'){result=archive[action.split('.')[1]](scope.root,clean);break;}
        if(action.startsWith('file.')||action==='folder.create'){result=fileEngine.executeFile(scope.root,action,clean);if(this.permissions().level==='full'&&result&&typeof result==='object')result={...result,accessRoot:scope.root,...(result.backupId||result.id?{backupRoot:scope.root}:{})};break;}
        if(action==='desktop.inspect'){result=JSON.parse(await this.runner(uiAutomation.inspect(clean.pid)));if(this.annotations)result=this.annotations.observeDesktop(result);break;}
        if(action==='desktop.click'){result=await this.runner(uiAutomation.click(clean.pid,clean.name));break;}
        if(['terminal.run','code.check','code.test','code.build'].includes(action)){result=await this.developerRunner(scope.root,action,clean);break;}
        throw Error('Unsupported action');
      }
    }
    }
    try{this.logAction({action,status:'completed',origin:context.origin});}catch{}
    return {ok:true,action,result};
    }catch(e){try{this.logAction({action,status:'failed',origin:context.origin,error:String(e.message).slice(0,160)});}catch{}throw e;}
  }
}
module.exports={ComputerController,ensureArgs,resolveControlledPath,contained};
