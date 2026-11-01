'use strict';
const {randomUUID,createHash}=require('node:crypto');
// Adapted from the supplied original starter's normalized-coordinate mapping.
function mapCapturePoint(metadata,x,y,space='capture-normalized'){
 if(space==='capture-pixels'){x/=metadata.modelImageWidth;y/=metadata.modelImageHeight;}
 if(![x,y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid capture coordinates');
 const rect=metadata.desktopDipRect;return {x:rect.x+x*rect.width,y:rect.y+y*rect.height};
}
class CaptureRegistry{
 constructor({screen,now=Date.now}={}){this.screen=screen;this.now=now;this.entries=new Map();}
 signature(){return JSON.stringify(this.screen.getAllDisplays().map(d=>({id:String(d.id),bounds:d.bounds,scale:d.scaleFactor})));}
 record(source,{scopeId='gui',crop}={}){
  const displays=this.screen.getAllDisplays();
  const display=displays.find(d=>String(d.id)===String(source.display_id))||(displays.length===1?displays[0]:null);
  if(!display)throw Error('Cannot identify the captured display');
  const size=source.thumbnail.getSize();
  const region=crop||{x:0,y:0,width:size.width,height:size.height};
  if(!['x','y','width','height'].every(k=>Number.isInteger(region[k]))||region.x<0||region.y<0||region.width<1||region.height<1||region.x+region.width>size.width||region.y+region.height>size.height)throw Error('Invalid screenshot crop');
  const image=crop?source.thumbnail.crop(region):source.thumbnail;
  const bytes=image.toPNG();if(bytes.length>8_000_000)throw Error('Screenshot exceeds 8 MB');
  const rect=display.bounds;
  const metadata={captureId:'capture-'+randomUUID(),capturedAt:new Date(this.now()).toISOString(),modelImageWidth:region.width,modelImageHeight:region.height,sourcePixelSize:size,sourcePixelCrop:{left:region.x,top:region.y,width:region.width,height:region.height},desktopDipRect:{x:rect.x+region.x/size.width*rect.width,y:rect.y+region.y/size.height*rect.height,width:region.width/size.width*rect.width,height:region.height/size.height*rect.height},displayId:String(display.id),displayScaleFactor:display.scaleFactor,visionDelivered:false};
  metadata.imageSha256=createHash('sha256').update(bytes).digest('hex');
  this.entries.set(metadata.captureId,{metadata,bytes,scopeId,at:this.now(),signature:this.signature()});
  while(this.entries.size>4)this.entries.delete(this.entries.keys().next().value);
  return {metadata,image,bytes};
 }
 get(id,context={}){
  const entry=this.entries.get(id);
  if(!entry||this.now()-entry.at>30000||entry.signature!==this.signature()||(context.origin==='ai-chat'&&entry.scopeId!==context.scopeId))throw Error('Capture is stale; inspect the screen again');
  if(context.origin==='ai-chat'&&(!entry.metadata.visionDelivered||context.verifiedCaptureId!==id))throw Error('This screenshot has not been delivered through a verified vision transport; use an accessibility target');
  return entry.metadata;
 }
 forDelivery(id,scopeId){const metadata=this.get(id),entry=this.entries.get(id);if(entry.scopeId!==scopeId)throw Error('Capture belongs to another task');return {captureId:id,bytes:entry.bytes,metadata:{...metadata}};}
 markDelivered(id,scopeId,proof){const metadata=this.get(id),entry=this.entries.get(id);if(entry.scopeId!==scopeId||proof?.accepted!==true||proof.imageCount<1)throw Error('Image delivery was not verified');metadata.visionDelivered=true;metadata.deliveryConfirmedAt=new Date(this.now()).toISOString();}
 isDelivered(id,scopeId){try{return this.get(id,{origin:'ai-chat',scopeId,verifiedCaptureId:id}).visionDelivered===true;}catch{return false;}}
 clear(){this.entries.clear();}
}
module.exports={CaptureRegistry,mapCapturePoint};
