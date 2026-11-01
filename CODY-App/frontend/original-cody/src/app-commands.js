'use strict';
const {commandText}=require('./command-text');
const aliases={firefox:'firefox','fire fox':'firefox','mozilla firefox':'firefox',plezy:'plezy',plex:'plezy',plezzy:'plezy',plexy:'plezy',chrome:'chrome','google chrome':'chrome',edge:'edge','microsoft edge':'edge',notepad:'notepad',paint:'paint',calculator:'calculator',calc:'calculator','file explorer':'file explorer',explorer:'file explorer',spotify:'spotify','spot of':'spotify','spot ify':'spotify',settings:'settings'};
function normalizeApp(value){return aliases[String(value||'').toLowerCase().trim().replace(/^(?:the|my) /,'').replace(/ (?:app|application)$/,'')]||null;}
function parseAppCommand(input){
  const text=commandText(input,{preserveShow:true}).toLowerCase();
  const pin=/^(?:pin (.+?)(?: (?:always )?on top)?|keep (.+?) (?:always )?on top|make (.+?) (?:always )?on top)$/.exec(text);
  if(pin){const app=normalizeApp(pin[1]||pin[2]||pin[3]);if(app)return {action:'window.pin',args:{app,pinned:true}};}
  const unpin=/^(?:unpin (.+?)(?: (?:from )?(?:on top|the top|top))?|stop pinning (.+?)|stop keeping (.+?) on top|turn off always on top for (.+?))$/.exec(text);
  if(unpin){const app=normalizeApp(unpin[1]||unpin[2]||unpin[3]||unpin[4]);if(app)return {action:'window.pin',args:{app,pinned:false}};}
  const single=/^(?:open|launch|start) (.+?)(?: for me)?$/.exec(text),app=normalizeApp(single?single[1]:text);
  if(app&&(single||app==='spotify'))return {action:'app.open',args:{app}};
  const match=/^(?:(?:open|launch|start|put|show) (.+?) (?:in (?:a )?split[ -]?screen|(?:in |as )?split[ -]?screen|side[ -]by[ -]side|next to each other)|(?:split[ -]?screen|side[ -]by[ -]side)(?: with)? (.+?))$/.exec(text);
  if(!match)return null;
  const parts=(match[1]||match[2]).split(/\s+(?:and|with|plus)\s+|\s*&\s*|\s*,\s*/);
  if(parts.length!==2)return null;const apps=parts.map(normalizeApp);
  if(apps.some(app=>!app)||apps[0]===apps[1])return null;
  return {action:'app.split',args:{apps}};
}
module.exports={parseAppCommand,normalizeApp};
