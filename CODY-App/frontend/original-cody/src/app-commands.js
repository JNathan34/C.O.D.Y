'use strict';
const {commandText}=require('./command-text');
const aliases={firefox:'firefox','fire fox':'firefox','mozilla firefox':'firefox',plezy:'plezy',plex:'plezy',plezzy:'plezy',plexy:'plezy',chrome:'chrome','google chrome':'chrome',edge:'edge','microsoft edge':'edge',notepad:'notepad',paint:'paint',calculator:'calculator',calc:'calculator','file explorer':'file explorer',explorer:'file explorer',spotify:'spotify','spot of':'spotify','spot ify':'spotify',settings:'settings'};
Object.assign(aliases,{word:'word','microsoft word':'word','ms word':'word','word doc':'word','word document':'word',
  'windows explorer':'file explorer',discord:'discord',browser:'browser'});
function normalizeApp(value){const key=String(value||'').toLowerCase().trim().replace(/^(?:the|my) /,'').replace(/ (?:app|application)$/,'');return Object.hasOwn(aliases,key)?aliases[key]:null;}
function appTarget(value){
  const match=/^(.+?)\s+["“]([^"”]+)["”]$/.exec(value);
  const app=normalizeApp(match?.[1]??value);
  return app?{app,...(match?{title:match[2]}:{})}:null;
}
function openWindowName(value){
  if(typeof value!=='string')return null;
  const quoted=/^["“]([^"”\r\n]+)["”]$/.exec(value.trim());
  if(quoted)return quoted[1].length<=256?quoted[1]:null;
  const name=value.trim().replace(/^(?:the|my)\s+/i,'').replace(/\s+(?:app|application|window)$/i,'');
  if(!/^[\p{L}\p{N}][\p{L}\p{N} ._+&'()\-]{0,79}$/u.test(name)||
     /\b(?:and|then|please)\b|^(?:app|apps|window|windows|it|this|that|next|previous|last|another|current|some|an?)(?:\s|$)|\b(?:mode|theme|provider|model)$/i.test(name))
    return null;
  return name;
}
function windowOperation(operation,value){
  const target=appTarget(value);
  if(target)return {action:'window.manage',args:{...target,operation}};
  const windowName=openWindowName(value);
  return windowName?{action:'window.manage',args:{windowName,operation}}:null;
}
function parseAppCommand(input){
  const text=commandText(input,{preserveShow:true});
  const resize=/^resize (.+?) to (\d+) (?:by|x) (\d+)(?: pixels)?$/i.exec(text);
  if(resize){
    const target=appTarget(resize[1]);
    if(target)return {action:'window.manage',args:{...target,operation:'resize',width:Number(resize[2]),height:Number(resize[3])}};
  }
  const move=/^move (.+?) to (?:my |the )?(?:monitor|display|screen) (\d+|one|two|three|four)$/i.exec(text)
    || /^move (.+?) to (?:my |the )?(first|second|third|fourth) (?:monitor|display|screen)$/i.exec(text);
  if(move){
    const target=appTarget(move[1]),number=move[2].toLowerCase(),display=Number(number)||({one:1,two:2,three:3,four:4,first:1,second:2,third:3,fourth:4})[number];
    if(target&&display)return {action:'window.manage',args:{...target,operation:'move',display}};
  }
  const manage=/^(restore|minimi[sz]e|maximi[sz]e) (.+)$/i.exec(text);
  if(manage){
    const route=windowOperation(manage[1].toLowerCase().replace('ise','ize'),manage[2]);
    if(route)return route;
  }
  const front=/^bring (.+?) (?:to (?:the )?(?:front|foreground)|forward)$/i.exec(text);
  const focus=/^(?:focus(?: on)?|activate|(?:switch|go)(?: back)? to|(?:switch|change|set|move) (?:the )?(?:app |window )?focus to) (.+)$/i.exec(text);
  const status=/^is (.+?) (?:already )?open(?:\??\s*bring it to the front)?$/i.exec(text);
  if(front||focus||status){
    const name=(front||focus||status)[1];
    const indirect=/^(?:go to|focus on)\b/i.test(text)||Boolean(status);
    const scoped=appTarget(name)||/\b(?:app|application|window)$/i.test(name)||/^["“]/.test(name);
    const route=(!indirect||scoped)&&windowOperation(front||focus||/bring it/i.test(text)?'focus':'inspect',name);
    if(route)return route;
  }
  if(/^(?:(?:show|list)(?: me)? (?:the |my )?(?:open|running) (?:apps|applications|windows)|what (?:apps|applications|windows) are (?:open|running))$/i.test(text))
    return {action:'window.list',args:{}};
  if(/^(?:(?:switch|change|set|move) (?:the )?(?:app |window )?focus|switch (?:apps|applications|windows))$/i.test(text))
    return {action:'window-choose',args:{}};
  const newWindow=/^(?:open|launch|start) (?:a |another )?(?:new )?(?:window|instance|document) (?:of|in|for) (.+)$/i.exec(text)
    || /^(?:open|launch|start) (?:a new|another|new) (.+?) (?:window|instance|document)$/i.exec(text);
  if(newWindow){
    const app=normalizeApp(newWindow[1]);
    if(app)return {action:'app.open',args:{app,newWindow:true}};
  }
  const sides=/^(?:put|place|arrange|open) (.+?) on the (left|right) and (.+?) on the (left|right)(?: (?:in|at) (?:a )?(\d{1,2})[/:](\d{1,2})(?: split)?)?$/i.exec(text);
  if(sides&&sides[2].toLowerCase()!==sides[4].toLowerCase()){
    const targets=(sides[2].toLowerCase()==='left'?[sides[1],sides[3]]:[sides[3],sides[1]]).map(appTarget);
    if(targets.every(Boolean)&&new Set(targets.map(item=>item.app)).size===2){
      const titles=targets.map(item=>item.title??null);
      return {action:'app.split',args:{apps:targets.map(item=>item.app),...(titles.some(Boolean)?{titles}:{}),...(sides[5]?{ratio:Number(sides[5])/(Number(sides[5])+Number(sides[6]))}:{})}};
    }
  }
  const lower=text.toLowerCase();
  const pin=/^(?:pin (.+?)(?: (?:always )?on top)?|keep (.+?) (?:always )?on top|make (.+?) (?:always )?on top)$/.exec(lower);
  if(pin){const app=normalizeApp(pin[1]||pin[2]||pin[3]);if(app)return {action:'window.pin',args:{app,pinned:true}};}
  const unpin=/^(?:unpin (.+?)(?: (?:from )?(?:on top|the top|top))?|stop pinning (.+?)|stop keeping (.+?) on top|turn off always on top for (.+?))$/.exec(lower);
  if(unpin){const app=normalizeApp(unpin[1]||unpin[2]||unpin[3]||unpin[4]);if(app)return {action:'window.pin',args:{app,pinned:false}};}
  const single=/^(?:open|launch|start) (.+?)(?: for me)?$/i.exec(text),opened=appTarget(single?single[1]:text);
  if(opened&&(single||opened.app==='spotify'))return {action:'app.open',args:opened};
  const match=/^(?:(?:open|launch|start|put|show|arrange) (.+?) (?:in (?:a )?split[ -]?screen|(?:in |as )?split[ -]?screen|side[ -]by[ -]side|next to each other|in a grid)|(?:split[ -]?screen|side[ -]by[ -]side)(?: with)? (.+?)|open (.+?) and split the screen with (.+?))$/i.exec(text);
  if(!match)return null;
  const parts=match[3]?[match[3],match[4]]:(match[1]||match[2]).replace(/[“”]/g,'"')
    .split(/(?:\s+(?:and|with|plus)\s+|\s*&\s*|\s*,\s*(?:and\s+)?)(?=(?:[^"]*"[^"]*")*[^"]*$)/i);
  const targets=parts.map(appTarget);
  if(parts.length<2||parts.length>4||targets.some(item=>!item))return null;
  const apps=targets.map(item=>item.app),titles=targets.map(item=>item.title??null);
  if(new Set(apps).size!==apps.length)return null;
  return {action:'app.split',args:{apps,...(titles.some(Boolean)?{titles}:{})}};
}
module.exports={parseAppCommand,normalizeApp};
